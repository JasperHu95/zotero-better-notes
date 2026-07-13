/**
 * Markdown source editor with syntax highlighting for the Better Notes
 * markdown mode, injected into the note-editor iframe on demand.
 *
 * Self-contained CodeMirror 6 bundle: it never touches the note-editor's
 * ProseMirror classes, so it is safe next to the native editor (foreign
 * ProseMirror objects are not — see editor/plugins.ts).
 *
 * This entry only assembles the public API; the implementation lives in
 * ./mdEditor/ (editor core, formatting commands, chip decorations and
 * popups, magic-key palette, scroll guard).
 */
import {
  create,
  destroy,
  focus,
  getCursor,
  getScroll,
  getSelection,
  getStateJSON,
  getValue,
  redo,
  setCursor,
  setScroll,
  setSelection,
  setValue,
  undo,
} from "./mdEditor/editor";
import { applyCommand, insertText } from "./mdEditor/commands";

export const BetterNotesMarkdownEditor = {
  create,
  getValue,
  setValue,
  getStateJSON,
  undo,
  redo,
  focus,
  getCursor,
  setCursor,
  getSelection,
  setSelection,
  getScroll,
  setScroll,
  applyCommand,
  insertText,
  destroy,
};

// @ts-ignore - exposed for the privileged side (modules/editor/markdownMode.ts)
window.BetterNotesMarkdownEditor = BetterNotesMarkdownEditor;
