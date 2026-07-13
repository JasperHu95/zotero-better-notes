/**
 * Per-container registries: each markdown editor is keyed by the container
 * element it was created in. Kept in one module (with type-only imports of
 * the manager classes) so the managers can reference each other's registry
 * without runtime import cycles.
 */
import type { EditorView } from "@codemirror/view";
import type { PreviewManager } from "./preview";
import type { ActionPopupManager } from "./actionPopup";
import type { MagicKeyManager } from "./magicKey";

export const views = new WeakMap<HTMLElement, EditorView>();
export const previewManagers = new WeakMap<HTMLElement, PreviewManager>();
export const actionPopups = new WeakMap<HTMLElement, ActionPopupManager>();
export const magicKeyManagers = new WeakMap<HTMLElement, MagicKeyManager>();
export const resizeObservers = new WeakMap<HTMLElement, ResizeObserver>();
