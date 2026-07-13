/**
 * The CodeMirror editor itself: creation/teardown and the accessors the
 * privileged side drives it with (value, selection, scroll, history).
 *
 * Highlighting uses @lezer/highlight's classHighlighter, which tags tokens
 * with `tok-*` classes; the colors live in styles/editor.css so they can
 * follow the note-editor's light/dark theme variables.
 */
import { EditorView, keymap, highlightActiveLine } from "@codemirror/view";
import { EditorState, EditorSelection, Transaction } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyField,
  historyKeymap,
  indentWithTab,
  redo as redoCommand,
  undo as undoCommand,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import {
  search,
  searchKeymap,
  highlightSelectionMatches,
} from "@codemirror/search";
import { classHighlighter, tagHighlighter, tags } from "@lezer/highlight";
import type { MagicKeyOptions, MarkdownEditorCallbacks } from "./types";
import { zNodeField } from "./zNodes";
import {
  actionPopups,
  magicKeyManagers,
  previewManagers,
  resizeObservers,
  views,
} from "./registries";
import { tryOrRetryNextTick } from "../shared/utils";
import { PreviewManager } from "./preview";
import { ActionPopupManager } from "./actionPopup";
import { MagicKeyManager } from "./magicKey";
import { allowScrollChange, guardScrollReset } from "./scrollGuard";
import { applyCommand } from "./commands";

/**
 * classHighlighter covers code-ish tokens (strings, keywords, comments in
 * embedded HTML), but misses several markdown-specific tags — monospace
 * (inline code / code blocks), strikethrough, quote, and the *_/#/> marks
 * (processingInstruction). This adds tok-* classes for those, matching the
 * naming scheme so styles/editor.css styles both from one place.
 */
const markdownTagHighlighter = tagHighlighter([
  { tag: tags.monospace, class: "tok-monospace" },
  { tag: tags.strikethrough, class: "tok-strikethrough" },
  { tag: tags.quote, class: "tok-quote" },
  { tag: tags.contentSeparator, class: "tok-contentSeparator" },
  { tag: tags.processingInstruction, class: "tok-processingInstruction" },
  { tag: tags.escape, class: "tok-escape" },
]);

/**
 * Build the editor in `container`.
 *
 * @param stateJSON Serialized state from getStateJSON(); restores the undo
 *   history when the markdown mode is re-entered.
 * @param optionsJSON JSON { magicKey?: boolean, magicKeyShortcut?: boolean }
 *   (primitives only cross the chrome/content boundary safely).
 */
export function create(
  container: HTMLElement,
  initialValue: string,
  callbacks: MarkdownEditorCallbacks = {},
  stateJSON?: string,
  optionsJSON?: string,
) {
  destroy(container);
  let magicKeyOptions: MagicKeyOptions = {};
  try {
    const parsed = (optionsJSON && JSON.parse(optionsJSON)) || {};
    magicKeyOptions = {
      enable: !!parsed.magicKey,
      enableShortcut: !!parsed.magicKeyShortcut,
    };
  } catch (e) {
    console.error(e);
  }
  const extensions = [
    history(),
    EditorView.lineWrapping,
    highlightActiveLine(),
    keymap.of([
      {
        key: "Mod-s",
        run: () => {
          try {
            callbacks.onSave?.();
          } catch (e) {
            console.error(e);
          }
          return true;
        },
      },
      {
        key: "Mod-b",
        run: () => {
          applyCommand(container, "bold");
          return true;
        },
      },
      {
        key: "Mod-i",
        run: () => {
          applyCommand(container, "italic");
          return true;
        },
      },
      {
        key: "Mod-/",
        run: () => {
          const palette = magicKeyManagers.get(container);
          if (!palette?.options.enableShortcut) {
            return false;
          }
          palette.toggle();
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
    // Find/replace panel at the top, like the note editor's findbar
    search({ top: true }),
    highlightSelectionMatches(),
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(classHighlighter),
    syntaxHighlighting(markdownTagHighlighter),
    zNodeField,
    // Pasting rich content (copied note content in particular) converts it
    // to markdown instead of falling back to the plain-text flavor, and the
    // files flavor (a screenshot, an image file copied from the file system)
    // goes through the same converter as data-URI images, which imports
    // them into the note; plain-only pastes keep CodeMirror's default
    // behavior.
    EditorView.domEventHandlers({
      paste: (event) => {
        const clipboardData = event.clipboardData;
        const convertPaste = callbacks.convertPaste;
        if (!clipboardData || !convertPaste) {
          return false;
        }
        const insertConverted = (md: string) => {
          if (typeof md !== "string" || !md) {
            return;
          }
          tryOrRetryNextTick(() => {
            const view = views.get(container);
            if (!view) {
              return;
            }
            view.dispatch({
              ...view.state.replaceSelection(md),
              scrollIntoView: true,
            });
          });
        };
        const html = clipboardData.getData("text/html");
        if (html?.trim()) {
          const plain = clipboardData.getData("text/plain") || "";
          event.preventDefault();
          try {
            convertPaste(html, plain, insertConverted);
          } catch (e) {
            console.error(e);
          }
          return true;
        }
        const imageFiles = Array.from(clipboardData.files || []).filter(
          (file) => file.type.startsWith("image/"),
        );
        if (!imageFiles.length) {
          return false;
        }
        event.preventDefault();
        Promise.all(
          imageFiles.map(
            (file) =>
              new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
              }),
          ),
        )
          .then((urls) => {
            const imageHTML = urls
              .map((url) => `<p><img src="${url}"/></p>`)
              .join("");
            convertPaste(imageHTML, "", insertConverted);
          })
          .catch(console.error);
        return true;
      },
    }),
    EditorView.contentAttributes.of({ spellcheck: "false" }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        previewManagers.get(container)?.close();
        actionPopups.get(container)?.close();
        magicKeyManagers.get(container)?.handleDocChange(update);
        try {
          callbacks.onChange?.();
        } catch (e) {
          console.error(e);
        }
      }
    }),
  ];
  // A restored state carries the undo history of the previous markdown-mode
  // session. Its doc may be stale (saving normalizes the note, which shifts
  // the regenerated markdown); it is diffed up to date below.
  let restored: EditorState | undefined;
  if (stateJSON) {
    try {
      restored = EditorState.fromJSON(
        JSON.parse(stateJSON),
        { extensions },
        { history: historyField },
      );
    } catch (e) {
      console.error(e);
    }
  }
  const view = new EditorView({
    state: restored || EditorState.create({ doc: initialValue, extensions }),
    parent: container,
  });
  views.set(container, view);
  previewManagers.set(
    container,
    new PreviewManager(container, view, callbacks),
  );
  actionPopups.set(
    container,
    new ActionPopupManager(container, view, callbacks),
  );
  magicKeyManagers.set(
    container,
    new MagicKeyManager(container, view, callbacks, magicKeyOptions),
  );
  guardScrollReset(container, view);
  if (restored) {
    const oldText = view.state.doc.toString();
    if (oldText !== initialValue) {
      // Not an edit, so not an undoable step; the history maps its stored
      // changes through this correction.
      view.dispatch({
        changes: diffReplace(oldText, initialValue),
        annotations: Transaction.addToHistory.of(false),
      });
    }
  }
  return true;
}

/**
 * The serialized editor state (doc + selection + undo history). Feed it back
 * into create() to keep the undo history across markdown-mode toggles.
 */
export function getStateJSON(container: HTMLElement) {
  const view = views.get(container);
  if (!view) {
    return undefined;
  }
  try {
    return JSON.stringify(view.state.toJSON({ history: historyField }));
  } catch (e) {
    console.error(e);
    return undefined;
  }
}

export function undo(container: HTMLElement) {
  const view = views.get(container);
  if (!view) {
    return false;
  }
  try {
    return undoCommand(view);
  } catch (e) {
    console.error(e);
    return false;
  }
}

export function redo(container: HTMLElement) {
  const view = views.get(container);
  if (!view) {
    return false;
  }
  try {
    return redoCommand(view);
  } catch (e) {
    console.error(e);
    return false;
  }
}

export function getValue(container: HTMLElement) {
  return views.get(container)?.state.doc.toString();
}

/**
 * Smallest single change turning oldText into newText (common prefix/suffix
 * trimmed). Dispatching this instead of a whole-document replace lets
 * CodeMirror map the selection and its scroll anchor through the change, so
 * the view doesn't jump.
 */
function diffReplace(oldText: string, newText: string) {
  let start = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (start < minLen && oldText[start] === newText[start]) {
    start++;
  }
  let endOld = oldText.length;
  let endNew = newText.length;
  while (
    endOld > start &&
    endNew > start &&
    oldText[endOld - 1] === newText[endNew - 1]
  ) {
    endOld--;
    endNew--;
  }
  return { from: start, to: endOld, insert: newText.slice(start, endNew) };
}

export function setValue(
  container: HTMLElement,
  value: string,
  keepView = false,
) {
  tryOrRetryNextTick(() => {
    const view = views.get(container);
    if (!view) {
      return;
    }
    const oldText = view.state.doc.toString();
    if (oldText === value) {
      return;
    }
    // The default selection/scroll mapping through the minimal change is
    // what keeps the view in place; keepView needs no extra handling.
    view.dispatch({ changes: diffReplace(oldText, value) });
    if (!keepView) {
      view.dispatch({ selection: EditorSelection.cursor(0) });
    }
  });
}

export function focus(container: HTMLElement) {
  tryOrRetryNextTick(() => {
    views.get(container)?.focus();
  });
}

export function getCursor(container: HTMLElement) {
  return views.get(container)?.state.selection.main.head;
}

export function setCursor(container: HTMLElement, pos: number) {
  setSelection(container, pos, pos);
}

export function getSelection(container: HTMLElement) {
  const view = views.get(container);
  if (!view) {
    return undefined;
  }
  const { anchor, head } = view.state.selection.main;
  return { anchor, head };
}

export function setSelection(
  container: HTMLElement,
  anchor: number,
  head = anchor,
  scrollIntoView = true,
) {
  tryOrRetryNextTick(() => {
    const view = views.get(container);
    if (!view) {
      return;
    }
    if (scrollIntoView) {
      allowScrollChange(container);
    }
    const max = view.state.doc.length;
    const anchorPos = Math.max(0, Math.min(anchor, max));
    const headPos = Math.max(0, Math.min(head, max));
    view.dispatch({
      selection: EditorSelection.single(anchorPos, headPos),
      effects: scrollIntoView
        ? EditorView.scrollIntoView(headPos, { y: "center" })
        : undefined,
    });
  });
}

export function getScroll(container: HTMLElement) {
  return views.get(container)?.scrollDOM.scrollTop;
}

export function setScroll(container: HTMLElement, top: number) {
  tryOrRetryNextTick(() => {
    const view = views.get(container);
    if (!view) {
      return;
    }
    allowScrollChange(container, top);
    view.scrollDOM.scrollTop = top;
    // A freshly created view may not have measured its content height yet,
    // in which case the assignment above is clamped; re-apply after the
    // measure.
    view.requestMeasure({
      read: () => null,
      write: () => {
        view.scrollDOM.scrollTop = top;
      },
    });
  });
}

/** Tear down the editor and every per-container manager. */
export function destroy(container: HTMLElement) {
  previewManagers.get(container)?.destroy();
  previewManagers.delete(container);
  actionPopups.get(container)?.destroy();
  actionPopups.delete(container);
  magicKeyManagers.get(container)?.destroy();
  magicKeyManagers.delete(container);
  resizeObservers.get(container)?.disconnect();
  resizeObservers.delete(container);
  views.get(container)?.destroy();
  views.delete(container);
}
