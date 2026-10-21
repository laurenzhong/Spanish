import { ReadShelfSkeleton } from "./read-shelf-skeleton";

/**
 * Route-level fallback for `/read`. It renders the shelf skeleton the page uses
 * as its own Suspense fallback, plus the page's screen-reader title — so nothing
 * is guessed and nothing moves when the real page replaces it.
 *
 * The reading navigation is not rendered here: it belongs to
 * `app/(product)/read/layout.tsx`, which is already mounted above this fallback,
 * and a second copy would animate the underline twice.
 */
export default function ReadLoading() {
  return (
    <>
      <h1 className="sr-only">阅读</h1>
      <ReadShelfSkeleton />
    </>
  );
}
