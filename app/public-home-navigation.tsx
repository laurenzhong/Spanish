"use client";

import { SlideableNavigation } from "@/src/shared/ui/slideable-navigation";

// These secondary links appear on wider screens. The learning link is a
// separate button in the header so it remains visible on phones.
const destinations = [
  { key: "how-it-works", label: "产品方式", href: "#how-it-works" },
  { key: "read", label: "阅读", href: "/login?next=%2Fread" },
];

export function PublicHomeNavigation() {
  return (
    <SlideableNavigation
      className="landing-nav__links"
      label="公开页面导航"
      items={destinations}
      indicatorClassName="landing-nav__indicator"
      restingIndicator="hidden"
      documentNavigation
    />
  );
}
