/**
 * Small helpers shared across the content-side bundles.
 */

/**
 * Run an operation now, retrying once on the next tick if it throws — for
 * calls that can collide with a busy cycle in the callee (e.g. CodeMirror
 * rejects updates while an update or measure is in progress, and our calls
 * come from the privileged side at arbitrary times). The operation must
 * read the current state itself so a retry works on fresh data.
 */
export function tryOrRetryNextTick(op: () => void) {
  try {
    op();
  } catch (e) {
    setTimeout(() => {
      try {
        op();
      } catch (err) {
        console.error(err);
      }
    }, 0);
  }
}
