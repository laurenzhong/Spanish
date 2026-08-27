import type { Metadata } from "next";

import { GenerateStoryForm } from "./generate-story-form";

export const metadata: Metadata = { title: "Generate Story · 阅读" };

export default function GenerateStoryPage() {
  return (
    <div className="page-stack read-generate-page">
      <GenerateStoryForm />
    </div>
  );
}
