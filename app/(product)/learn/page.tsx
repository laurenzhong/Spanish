import type { Metadata } from "next";

import { LearnPageContent } from "./learn-page-content";

export const metadata: Metadata = {
  title: "学习",
};

export default function LearnPage() {
  return <LearnPageContent />;
}
