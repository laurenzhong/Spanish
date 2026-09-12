"use client";

import { useRef, useState } from "react";

export function SaveExpressionButton({ expressionKey, expressionText, version }: Readonly<{ expressionKey: string; expressionText: string; version: number }>) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const clientSaveId = useRef(`save-${crypto.randomUUID()}`);
  async function save() {
    if (state === "saving" || state === "saved") return;
    setState("saving");
    try {
      const response = await fetch("/api/v1/expressions/saved", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientSaveId: clientSaveId.current, source: { sourceType: "formal-expression", expressionKey, version } }) });
      if (!response.ok) throw new Error("SAVE_FAILED");
      setState("saved");
    } catch { setState("error"); }
  }
  const label = state === "saving" ? "正在收藏" : state === "saved" ? "已收藏" : state === "error" ? "重试收藏" : "收藏表达";
  return <button type="button" className="scenario-expression-save" aria-label={`${label}：${expressionText}`} aria-pressed={state === "saved"} disabled={state === "saving" || state === "saved"} onClick={() => void save()}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 4.5h10v15l-5-3.2-5 3.2z" fill={state === "saved" ? "currentColor" : "none"} /></svg></button>;
}
