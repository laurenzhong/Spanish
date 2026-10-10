import Link from "next/link";

import { SlideableNavigation } from "@/src/shared/ui/slideable-navigation";

/**
 * The single reading-area navigation. Content libraries come first, the
 * personal shelf last, so the leftmost entries are the public entry points.
 * New destinations must be added to this one list; do not stack a second
 * navigation row with its own styling.
 *
 * The accent underline that slides between items is shared with every other
 * slideable navigation; only the section styling lives here.
 */
const destinations = [
  { key: "articles", label: "文章", href: "/read" },
  { key: "vocabulary", label: "词汇", href: "/read/vocabulary" },
  { key: "phrases", label: "短语", href: "/read/phrases" },
  { key: "corpus", label: "语料", href: "/read/corpus" },
  { key: "saved-items", label: "已保存", href: "/read/saved-items" },
] as const;

export type ReadSectionKey = (typeof destinations)[number]["key"];

type ReadSectionNavigationProps = Readonly<{ active: ReadSectionKey }>;

/**
 * The interactive navigation. The underline is measured and moved on the
 * client, so it needs JavaScript; the resting state falls back to the active
 * item's own underline.
 */
export function ReadSectionNavigation({ active }: ReadSectionNavigationProps) {
  return (
    <SlideableNavigation
      className="read-section-navigation"
      label="阅读内容类型"
      activeKey={active}
      items={destinations.map(({ key, label, href }) => ({ key, label, href, current: key === active }))}
      indicatorClassName="read-section-navigation__indicator"
    />
  );
}

/**
 * The same destinations, rendered without the measured underline.
 *
 * The route-level loading fallback (`app/(product)/read/loading.tsx`) uses this
 * so the tabs a reader sees while the shelf data loads are the real
 * destinations at the real sizes instead of a guessed placeholder. It is
 * deliberately not the interactive component: the fallback is replaced by the
 * page shell a moment later, and mounting the measuring indicator twice would
 * animate the underline in twice.
 */
export function StaticReadSectionNavigation({ active }: ReadSectionNavigationProps) {
  return (
    <nav className="read-section-navigation" aria-label="阅读内容类型">
      {destinations.map(({ key, label, href }) => (
        <Link key={key} href={href} aria-current={key === active ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
