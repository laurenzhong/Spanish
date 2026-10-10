"use client";

import { SlideableNavigation } from "@/src/shared/ui/slideable-navigation";

/**
 * The public home header navigation. It is a header, not a tab strip: no
 * destination is "current", so the underline rests on the first item and only
 * travels while the pointer or keyboard is inside the navigation. The CTA stays
 * a separate pill and is deliberately not part of the underline group.
 *
 * The first two destinations are hidden on phone widths by the landing
 * stylesheet; `SlideableNavigation` measures only the visible items.
 */
const destinations = [
  { key: "how-it-works", label: "产品方式", href: "#how-it-works" },
  { key: "read", label: "阅读", href: "/login?next=%2Fread" },
  { key: "login", label: "登录", href: "/login" },
];

export function PublicHomeNavigation() {
  return (
    <SlideableNavigation
      className="landing-nav__links"
      label="公开页面导航"
      items={destinations}
      indicatorClassName="landing-nav__indicator"
    />
  );
}
