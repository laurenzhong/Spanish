import type { ReactNode } from "react";

import "./read-shell.css";

import { ReadSectionNavHost } from "./read-section-nav-host";

/**
 * The reading section's own shell.
 *
 * The navigation used to be rendered by each page. That is what made it vanish:
 * a route transition inside `/read/*` renders a loading state before the
 * destination page resolves, and a navigation that only exists inside a page is
 * not there to be rendered. A section navigation belongs to the section layout,
 * so it is mounted here once and stays on screen through shelf transitions and
 * loading states. Article routes omit it in the host: readers have their own toolbar.
 *
 * The container lives here for the same reason. It is the row that stacks the
 * navigation above the content, and no single page can own it any more; pages
 * now return their own content only. Article readers and the private story
 * generator share this container, with route-specific navigation in the host.
 */
export default function ReadSectionLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="page-stack read-page">
      <ReadSectionNavHost />
      {children}
    </div>
  );
}
