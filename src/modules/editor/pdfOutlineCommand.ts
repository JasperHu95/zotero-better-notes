import { config } from "../../../package.json";
import { insert } from "../../utils/editor";
import { showHint } from "../../utils/hint";
import { getString } from "../../utils/locale";
import { registerMagicKeyCommand } from "./magicKey";

const COMMAND_ID = `${config.addonRef}.insertPdfOutlineHeadings`;

/**
 * Insert the parent PDF's chapter headings into the editor at the cursor.
 *
 * Distinct hints for "no PDF" vs "PDF has no outline" so the user knows what
 * to do next.
 */
async function insertPdfHeadingsIntoEditor(
  editor: Zotero.EditorInstance,
): Promise<void> {
  const noteItem = editor._item;
  if (!noteItem?.isNote() || !noteItem.parentItem) {
    showHint(getString("pdfOutline-noPdf"));
    return;
  }

  const attachment = await addon.api.note.resolvePdfAttachment(noteItem);
  if (!attachment) {
    showHint(getString("pdfOutline-noPdf"));
    return;
  }

  const outline = await addon.api.note.getPdfOutline(attachment);
  if (!outline) {
    showHint(getString("pdfOutline-noOutline"));
    return;
  }

  if (addon.api.editor.isMarkdownMode(editor)) {
    // Markdown mode (CodeMirror): append Markdown headings (each followed by a
    // blank line) to the Markdown source.
    const markdown = addon.api.note.outlineToMarkdown(outline);
    const source = addon.api.editor.getMarkdownSource(editor) ?? "";
    addon.api.editor.setMarkdownSource(editor, source + "\n" + markdown);
  } else {
    // Rich-text mode: insert HTML headings, each followed by an empty paragraph
    // so there is room to take notes underneath.
    const html = addon.api.note.outlineToHtml(outline);
    insert(editor, html, "cursor");
  }
}

/**
 * Register the "Insert PDF chapter headings" Magic Key command.
 * Idempotent: registerMagicKeyCommand ignores duplicate IDs.
 *
 * No icon: the palette renders a text-only entry, and the title is localized
 * (via getString) to Zotero's current UI language.
 */
function registerPdfOutlineMagicKeyCommand(): void {
  registerMagicKeyCommand({
    id: COMMAND_ID,
    title: getString("menuEditor-insertPdfOutline"),
    searchParts: ["pdf", "outline", "chapter", "headings"],
    handler: (editor) => {
      void insertPdfHeadingsIntoEditor(editor).catch((e) =>
        Zotero.logError(e as Error),
      );
    },
    enabled: (editor) =>
      Boolean(editor._item?.isNote() && editor._item.parentItem),
  });
}

export { insertPdfHeadingsIntoEditor, registerPdfOutlineMagicKeyCommand };
