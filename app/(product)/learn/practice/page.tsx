import type { Metadata } from "next";

import { FakeTrainingLoop } from "@/src/modules/training/ui/fake-training-loop";

export const metadata: Metadata = {
  title: "表达练习",
};

export default function PracticePage() {
  return <FakeTrainingLoop />;
}
