/**
 * Shared types for the markdown-mode editor bundle.
 */

/** The Zotero node kinds rendered as atomic chips in the source view. */
export type ZNodeKind = "citation" | "annotation" | "notelink" | "image";

/** Magic-key palette switches, from the privileged side's preferences. */
export interface MagicKeyOptions {
  enable?: boolean;
  enableShortcut?: boolean;
}

/**
 * Callbacks into the privileged side, passed to create() via cloneInto.
 * Data crossing the chrome/content boundary must be primitives, so
 * structured payloads travel as JSON strings in both directions.
 */
export interface MarkdownEditorCallbacks {
  /** Called on every document change (used for the debounced note save). */
  onChange?: () => void;
  /** Called on Mod-S (used to force an immediate note save). */
  onSave?: () => void;
  /**
   * Provides the hover-preview HTML for a Zotero node chip, like the
   * rich-text editor's link preview.
   */
  getPreview?: (
    kind: ZNodeKind,
    raw: string,
    setContent: (html: string) => void,
  ) => void;
  /** Opens a link clicked inside a preview popup. */
  openURL?: (url: string) => void;
  /**
   * Provides the buttons for a chip's click popup (the note editor's
   * citation/highlight/image popups). Neighbor chips are passed along for
   * the annotation-citation pair rules.
   */
  getNodeActions?: (
    kind: ZNodeKind,
    raw: string,
    neighborsJSON: string,
    setActions: (actionsJSON: string) => void,
  ) => void;
  /**
   * Runs a chip popup action. applyEdit replaces the chip's markdown
   * source; trimBefore also removes the whitespace separating it from the
   * previous chip (the note editor's "hide citation" removes the pair gap).
   */
  onNodeAction?: (
    id: string,
    kind: ZNodeKind,
    raw: string,
    applyEdit: (newText: string, trimBefore?: boolean) => void,
  ) => void;
  /**
   * Provides the privileged part of the magic-key palette as JSON:
   * { openAttachment: boolean, custom: [{ id, title, icon?, searchParts }] }.
   */
  getMagicCommands?: (setCommands: (commandsJSON: string) => void) => void;
  /** Runs a privileged magic-key command (insertTemplate, copyLineLink, ...). */
  onMagicCommand?: (id: string) => void;
  /**
   * Converts pasted HTML (e.g. copied note content) to markdown, importing
   * note-specific data such as embedded images into the target note.
   * Called with the plain-text flavor as a fallback.
   */
  convertPaste?: (
    html: string,
    plain: string,
    setResult: (md: string) => void,
  ) => void;
}
