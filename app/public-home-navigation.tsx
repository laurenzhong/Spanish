"use client";

import { SlideableNavigation } from "@/src/shared/ui/slideable-navigation";

/**
 * The public home header navigation. It is a header, not a tab strip: every
 * destination points somewhere else, so no item is "current" and the underline
 * stays out of the way until the pointer or keyboard is inside the navigation.
 * (`restingIndicator="hidden"`; a resting underline on a header reads as a
 * current-page marker for a page nobody is on — on phone widths the only
 * visible item is 登录, which made the header look like the login page.) The
 * CTA stays a separate pill and is deliberately not part of the underline
 * group.
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
      restingIndicator="hidden"
    />
  );
}
