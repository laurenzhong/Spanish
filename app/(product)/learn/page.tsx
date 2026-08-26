import type { Metadata } from "next";

import { getCurrentUser } from "@/src/shared/auth/server";

import { LearnPageContent } from "./learn-page-content";

export const metadata: Metadata = {
  title: "学习",
};

export default async function LearnPage() {
  const user = await getCurrentUser();
  return <LearnPageContent userId={user?.id ?? "local-user"} />;
}
