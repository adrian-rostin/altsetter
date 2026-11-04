/**
 * Runs a DOM update as a View Transition: the browser snapshots the page, `update` changes and
 * renders it synchronously, then every element whose view-transition-name exists in both states
 * animates from its old to its new position and size.
 *
 * Without browser support, or when the user prefers reduced motion, the update runs instantly.
 * The returned promise resolves once the animation (if any) has finished.
 */
export function runViewTransition(update: () => void): Promise<void> {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!('startViewTransition' in document) || reduceMotion) {
    update();
    return Promise.resolve();
  }
  return document.startViewTransition(update).finished.catch(() => undefined);
}
