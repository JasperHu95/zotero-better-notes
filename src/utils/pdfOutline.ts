import { waitUtilAsync } from "./wait";

/** A node in a PDF's outline (bookmark / table-of-contents) tree. */
interface PdfOutlineNode {
  title: string;
  /** 1-based depth; top-level outline entries are level 1. */
  level: number;
  children: PdfOutlineNode[];
}

/**
 * Structural shape shared by pdf.js outline nodes (`getOutline()`): we only
 * rely on `.title` and the recursive `.items`, so a minimal structural type
 * keeps `normalize` decoupled from the exact pdfjs `OutlineNode` definition.
 */
interface OutlineLike {
  title: string;
  items?: OutlineLike[];
}

const PDF_CONTENT_TYPE = "application/pdf";
/** H1 belongs to the note title, so generated content tops out at H6. */
const MAX_HEADING_LEVEL = 6;

export {
  getPdfOutline,
  outlineToMarkdown,
  outlineToHtml,
  resolvePdfAttachment,
  getPdfHeadings,
};
export type { PdfOutlineNode };

/**
 * Convenience: resolve the PDF for an item (or a note's parent), read its
 * outline, and return ready-to-insert Markdown headings.
 *
 * @returns Markdown headings (`## …` …), or `""` if there is no PDF / no outline.
 */
async function getPdfHeadings(
  item: Zotero.Item,
  startLevel: number = 2,
): Promise<string> {
  const attachment = await resolvePdfAttachment(item);
  if (!attachment) {
    return "";
  }
  const outline = await getPdfOutline(attachment);
  if (!outline) {
    return "";
  }
  return outlineToMarkdown(outline, startLevel);
}

/**
 * Resolve the best PDF attachment for a library item, or the parent of a note.
 * @returns the PDF attachment item, or `null` if there is no PDF.
 */
async function resolvePdfAttachment(
  item: Zotero.Item,
): Promise<Zotero.Item | null> {
  if (!item) {
    return null;
  }
  const source = item.isNote() ? item.parentItem : item;
  if (!source) {
    return null;
  }
  const attachments = await source.getBestAttachments();
  return (
    attachments.find((a) => a.attachmentContentType === PDF_CONTENT_TYPE) ??
    null
  );
}

/**
 * Read a PDF attachment's outline (chapter/section bookmarks) as a tree.
 *
 * Reuses an already-open reader when one exists; otherwise opens the PDF in a
 * non-focusing background tab, reads the outline, then closes it.
 *
 * @returns the outline tree, or `null` if the item is not a PDF / has no outline.
 */
async function getPdfOutline(
  attachmentItem: Zotero.Item,
): Promise<PdfOutlineNode[] | null> {
  if (
    !attachmentItem?.isAttachment() ||
    attachmentItem.attachmentContentType !== PDF_CONTENT_TYPE
  ) {
    return null;
  }

  // @ts-ignore - _readers is the reader registry; present at runtime, not typed.
  const openReaders: _ZoteroTypes.ReaderInstance[] = Zotero.Reader._readers;
  const existing = openReaders.find((r) => r._item.id === attachmentItem.id);
  if (existing) {
    return readOutlineFromReader(existing);
  }

  const opened = await Zotero.Reader.open(attachmentItem.id, undefined, {
    openInBackground: true,
  });
  if (!opened) {
    return null;
  }
  try {
    return await readOutlineFromReader(opened);
  } finally {
    // @ts-ignore - close() exists on reader instances (Zotero reader.js + tests).
    opened.close();
  }
}

async function readOutlineFromReader(
  reader: _ZoteroTypes.ReaderInstance,
): Promise<PdfOutlineNode[] | null> {
  // `_primaryView` is a `PDFView | EPUBView | SnapshotView` union; only the PDF
  // view carries `_iframeWindow.PDFViewerApplication`. The item was validated
  // as a PDF above, so narrowing to PDFView is sound.
  const getDoc = (): _ZoteroTypes.Reader.PDFDocumentProxy | undefined => {
    const view = reader._primaryView as _ZoteroTypes.Reader.PDFView | undefined;
    return view?._iframeWindow?.PDFViewerApplication?.pdfDocument;
  };
  try {
    await waitUtilAsync(() => Boolean(getDoc()), 200, 15000);
  } catch (_e) {
    // The PDF viewer never became ready (corrupt file, slow load, etc.).
    return null;
  }

  const view = reader._primaryView as _ZoteroTypes.Reader.PDFView | undefined;
  const app = view?._iframeWindow?.PDFViewerApplication;
  if (!app) {
    return null;
  }
  const pdfDocument = app.pdfDocument;
  if (!pdfDocument) {
    return null;
  }
  // Finish any lingering viewer initialization (the wait above already saw a
  // pdfDocument, so this resolves immediately in practice).
  await app.initializedPromise;

  // Zotero's customized pdf.js exposes `getOutline2` — the reader's own
  // sidebar uses exactly this call (zotero/reader src/pdf/pdf-view.js). Fall
  // back to upstream `getOutline`. Both return nodes with `.title`/`.items`.
  const doc = pdfDocument as _ZoteroTypes.Reader.PDFDocumentProxy & {
    getOutline2?: () => Promise<OutlineLike[] | null>;
  };
  const raw = (await doc.getOutline2?.()) ?? (await doc.getOutline());
  if (!raw || !raw.length) {
    return null;
  }
  return raw.map((node) => normalize(node as OutlineLike, 1));
}

function normalize(raw: OutlineLike, level: number): PdfOutlineNode {
  return {
    title: cleanTitle(raw.title ?? ""),
    level,
    children: (raw.items ?? []).map((child) => normalize(child, level + 1)),
  };
}

/**
 * Strip control characters, zero-width characters, and collapse/trim whitespace
 * from an outline title. PDF outline titles occasionally carry BOMs, soft
 * hyphens, or stray control bytes that render as "garbage" symbols.
 */
function cleanTitle(title: string): string {
  return title
    // eslint-disable-next-line no-control-regex -- stripping control bytes is the intent
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Render an outline tree as Markdown headings.
 *
 * Top-level entries become `##` (the note title owns `#`); nested entries
 * descend to `###`, `####`, … capped at `######` (H6). A blank line follows
 * each heading so there is room to take notes underneath.
 */
function outlineToMarkdown(
  outline: PdfOutlineNode[],
  startLevel: number = 2,
): string {
  const lines: string[] = [];
  const walk = (nodes: PdfOutlineNode[]) => {
    for (const node of nodes) {
      const level = Math.min(startLevel + node.level - 1, MAX_HEADING_LEVEL);
      lines.push(`${"#".repeat(level)} ${node.title}`);
      walk(node.children);
    }
  };
  walk(outline);
  // Blank line after every heading → space to write notes beneath each.
  return lines.map((line) => `${line}\n`).join("\n");
}

/**
 * Render an outline tree as HTML headings, each followed by an empty paragraph
 * so the user can take notes directly under it. Used when inserting into the
 * rich-text (ProseMirror) editor, where Markdown blank lines would not produce
 * visible space.
 */
function outlineToHtml(
  outline: PdfOutlineNode[],
  startLevel: number = 2,
): string {
  const parts: string[] = [];
  const walk = (nodes: PdfOutlineNode[]) => {
    for (const node of nodes) {
      const level = Math.min(startLevel + node.level - 1, MAX_HEADING_LEVEL);
      parts.push(`<h${level}>${escapeHtml(node.title)}</h${level}><p></p>`);
      walk(node.children);
    }
  };
  walk(outline);
  return parts.join("");
}

/** Escape text so it is safe to embed as heading content in the note editor. */
function escapeHtml(text: string): string {
  const el = document.createElement("div");
  el.textContent = text;
  return el.innerHTML;
}
