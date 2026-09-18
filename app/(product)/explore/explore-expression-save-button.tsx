"use client";

import { useRef, useState } from "react";

import type { ExploreExpressionSaveSource } from "@/src/modules/explore/domain/explore-library";

function BookmarkIcon({ filled }: Readonly<{ filled: boolean }>) {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 4.5h10v15l-5-3.2-5 3.2z" fill={filled ? "currentColor" : "none"} /></svg>;
}

export function ExploreExpressionSaveButton({ expressionText, initiallySaved, source }: Readonly<{
  expressionText: string;
  initiallySaved: boolean;
  source?: ExploreExpressionSaveSource;
}>) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(initiallySaved ? "saved" : "idle");
  const clientSaveId = useRef(`explore-save-${crypto.randomUUID()}`);

  async function save() {
    if (!source || state === "saving" || state === "saved") return;
    setState("saving");
    try {
      const response = await fetch("/api/v1/expressions/saved", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientSaveId: clientSaveId.current, source }),
      });
      if (!response.ok) throw new Error("SAVE_FAILED");
      setState("saved");
    } catch {
      setState("error");
    }
  }

  const label = state === "saving" ? "正在收藏" : state === "saved" ? "已收藏" : state === "error" ? "重试收藏" : "收藏表达";
  return (
    <button
      type="button"
      className="explore-expression-save"
      aria-label={`${label}：${expressionText}`}
      aria-pressed={state === "saved"}
      disabled={!source || state === "saving" || state === "saved"}
      onClick={() => void save()}
    >
      <BookmarkIcon filled={state === "saved"} />
    </button>
  );
}
