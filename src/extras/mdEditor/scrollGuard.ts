/**
 * Guard against environment-driven scroll resets.
 */
import type { EditorView } from "@codemirror/view";
import { resizeObservers } from "./registries";

/** Tracked scroll state of one editor container. */
interface ScrollGuardState {
  stable: number;
  allowUntil: number;
  hidden: boolean;
}

const scrollGuards = new WeakMap<HTMLElement, ScrollGuardState>();

/** Let the next programmatic scroll through the reset guard. */
export function allowScrollChange(container: HTMLElement, stable?: number) {
  const guard = scrollGuards.get(container);
  if (guard) {
    guard.allowUntil = Date.now() + 500;
    if (typeof stable === "number") {
      guard.stable = stable;
    }
  }
}

/**
 * The editor's environment occasionally resets the scroll position to 0
 * behind CodeMirror's back — observed after note saves, when the hosting
 * pane refreshes and heights are re-measured, and when the scroller is
 * hidden (Gecko zeroes hidden scrollers). Track the last stable position
 * and put it back when a reset arrives that no user gesture or editor API
 * call explains.
 */
export function guardScrollReset(container: HTMLElement, view: EditorView) {
  const guard: ScrollGuardState = {
    stable: 0,
    allowUntil: 0,
    hidden: view.scrollDOM.offsetHeight === 0,
  };
  scrollGuards.set(container, guard);

  const markUser = () => {
    guard.allowUntil = Date.now() + 800;
  };
  for (const type of ["wheel", "touchstart", "mousedown", "keydown"]) {
    view.scrollDOM.addEventListener(type, markUser, { passive: true });
  }

  view.scrollDOM.addEventListener(
    "scroll",
    () => {
      if (guard.hidden || view.scrollDOM.offsetHeight === 0) {
        return;
      }
      const top = view.scrollDOM.scrollTop;
      const allowed = Date.now() <= guard.allowUntil;
      if (top <= 1 && guard.stable > 100 && !allowed) {
        // Unexpected jump to the top; restore the last stable position.
        view.scrollDOM.scrollTop = guard.stable;
        return;
      }
      if (allowed) {
        // One-shot: the allowance covers the intended scroll only, so a
        // stray reset arriving right after it is still caught. User
        // gestures re-arm it on every event.
        guard.allowUntil = 0;
      }
      guard.stable = top;
    },
    { passive: true },
  );

  const observer = new ResizeObserver(() => {
    if (view.scrollDOM.offsetHeight === 0) {
      guard.hidden = true;
    } else if (guard.hidden) {
      guard.hidden = false;
      if (
        guard.stable > 0 &&
        Math.abs(view.scrollDOM.scrollTop - guard.stable) > 1
      ) {
        view.scrollDOM.scrollTop = guard.stable;
      }
    }
  });
  observer.observe(view.scrollDOM);
  resizeObservers.set(container, observer);
}
