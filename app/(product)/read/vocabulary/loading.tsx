import "./vocabulary-shelf.css";

import { VocabularyShelfSkeleton } from "./vocabulary-shelf-skeleton";

/**
 * The vocabulary loading state, scoped to the page rather than the viewport.
 *
 * The section navigation is not rendered here: it belongs to
 * `app/(product)/read/layout.tsx` now, so it is already on screen above this
 * fallback and stays there while the shelf's data loads.
 */
export default function VocabularyLoading() {
  return <VocabularyShelfSkeleton />;
}
