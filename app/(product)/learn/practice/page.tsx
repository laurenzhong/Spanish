import type { Metadata } from "next";

import { FakeTrainingLoop } from "@/src/modules/training/ui/fake-training-loop";
import { getCurrentUser } from "@/src/shared/auth/server";

export const metadata: Metadata = {
  title: "表达练习",
};

export default async function PracticePage() {
  const user = await getCurrentUser();
  return <FakeTrainingLoop userId={user?.id ?? "local-user"} />;
}
