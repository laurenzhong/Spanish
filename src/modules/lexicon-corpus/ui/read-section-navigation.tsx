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

export function ReadSectionNavigation({ active }: Readonly<{ active: ReadSectionKey }>) {
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
