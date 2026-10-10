import { StaticReadSectionNavigation } from "@/src/modules/lexicon-corpus";

import { ReadShelfSkeleton } from "./read-shelf-skeleton";

/**
 * Route-level fallback for `/read`. It renders the page's static shell exactly
 * — same wrapper, same reading navigation (without the measured underline; see
 * `StaticReadSectionNavigation`) and the same shelf skeleton the page uses as
 * its own Suspense fallback — so nothing is guessed and nothing moves when the
 * real page replaces it.
 */
export default function ReadLoading() {
  return (
    <div className="page-stack read-page">
      <h1 className="sr-only">阅读</h1>
      <StaticReadSectionNavigation active="articles" />
      <ReadShelfSkeleton />
    </div>
  );
}
