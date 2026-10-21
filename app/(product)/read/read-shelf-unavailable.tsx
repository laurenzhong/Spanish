"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function ReadShelfUnavailable() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <section className="surface-state read-empty" role="alert" aria-labelledby="read-shelf-unavailable-title" aria-busy={pending}>
      <h2 id="read-shelf-unavailable-title">文章暂时无法读取</h2>
      <p>请检查网络连接后重试。</p>
      <button
        className="secondary-action"
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {pending ? "正在重试…" : "重试"}
      </button>
    </section>
  );
}
