"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeletePersonalScenarioButton({ scenarioKey }: Readonly<{ scenarioKey: string }>) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "confirm" | "deleting" | "error">("idle");
  async function remove() {
    setState("deleting");
    try {
      const response = await fetch(`/api/v1/scenarios/${encodeURIComponent(scenarioKey)}`, { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error("DELETE_FAILED");
      router.replace("/explore"); router.refresh();
    } catch { setState("error"); }
  }
  if (state !== "confirm" && state !== "deleting") return <button type="button" className="scenario-delete-personal" onClick={() => setState("confirm")}>{state === "error" ? "删除失败，重试" : "删除私人场景"}</button>;
  return <div className="scenario-delete-confirm" role="group" aria-label="确认删除私人场景"><span>删除后不会再出现在场景库中。</span><button type="button" disabled={state === "deleting"} onClick={() => void remove()}>{state === "deleting" ? "正在删除…" : "确认删除"}</button><button type="button" disabled={state === "deleting"} onClick={() => setState("idle")}>取消</button></div>;
}
