import type { Metadata } from "next";

import { SurfaceState } from "@/src/shared/ui/surface-state";

export const metadata: Metadata = {
  title: "练习准备",
};

export default function PracticePlaceholderPage() {
  return (
    <div className="page-stack">
      <header className="page-header page-header--simple">
        <div>
          <p className="eyebrow">表达练习</p>
          <h1>训练准备中</h1>
        </div>
      </header>
      <SurfaceState
        description="训练闭环会在后续任务接入；当前壳层已保留可恢复的进入位置。"
        state="empty"
      />
    </div>
  );
}
