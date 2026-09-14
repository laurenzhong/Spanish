"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import type { CandidateReviewDimension, CandidateReviewStatus } from "../domain";

type Review = Readonly<{
  dimension: CandidateReviewDimension;
  status: CandidateReviewStatus;
  candidateRevision: number;
  notes: string | null;
  reviewerReference: string | null;
}>;

export type CandidateReviewWorkbenchData = Readonly<{
  candidate: Readonly<{
    id: string;
    title: string;
    normalizedUrl: string;
    contentType: "article" | "video" | "podcast";
    language: string;
    contentHash: string | null;
    metadata: Readonly<Record<string, unknown>>;
    status: string;
    rightsStatus: string;
    revision: number;
    publicationStatus: "draft" | "published" | "archived";
  }>;
  source: Readonly<{ displayName: string; rightsStatus: string }>;
  reviews: readonly Review[];
  artifacts: readonly Readonly<{ id: string; artifactType: string; status: string; byteSize: number; contentHash: string | null }>[];
  attempts: readonly Readonly<{ id: string; jobType: string; status: string; estimatedCostMicros: number; errorCode: string | null }>[];
  publisherAvailable: boolean;
}>;

const dimensions = [
  ["content-es-ES", "西语内容审核"],
  ["teaching-zh-CN", "中文教学审核"],
  ["structure", "结构校验"],
] as const;

export function CandidateReviewWorkbench({ initialData }: Readonly<{ initialData: CandidateReviewWorkbenchData }>) {
  const [data, setData] = useState(initialData);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const currentReviews = useMemo(() => data.reviews.filter((review) => review.candidateRevision === data.candidate.revision), [data]);
  const allApproved = dimensions.every(([dimension]) => currentReviews.some((review) => review.dimension === dimension && review.status === "approved"));
  const publishable = data.candidate.status === "review_ready" && data.candidate.rightsStatus === "verified" && Boolean(data.candidate.contentHash) && allApproved && data.candidate.publicationStatus === "draft" && data.publisherAvailable;

  async function mutate(path: string, body: Record<string, unknown>) {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/internal/content-workflow/candidates/${encodeURIComponent(data.candidate.id)}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "操作失败，请重试。");
      const refreshed = await fetch(`/api/v1/internal/content-workflow/candidates/${encodeURIComponent(data.candidate.id)}`, { cache: "no-store" });
      const refreshedPayload = await refreshed.json() as { data?: { candidate?: CandidateReviewWorkbenchData } };
      if (refreshedPayload.data?.candidate) setData(refreshedPayload.data.candidate);
      setMessage("已保存。当前版本的审核记录已更新。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="page-stack candidate-review">
      <header className="candidate-review__header">
        <Link href="/me/content-workflow" aria-label="返回内容工作流">←</Link>
        <div><p className="eyebrow">{data.candidate.contentType} · revision {data.candidate.revision}</p><h1>{data.candidate.title}</h1><p>{data.source.displayName} · {data.candidate.language} · {data.candidate.status}</p></div>
        <span>{data.candidate.publicationStatus}</span>
      </header>

      <div className="candidate-review__layout">
        <section className="candidate-review__preview" aria-labelledby="candidate-preview-title">
          <h2 id="candidate-preview-title">来源与候选预览</h2>
          <a href={data.candidate.normalizedUrl} target="_blank" rel="noreferrer">打开原始来源 ↗</a>
          <dl><div><dt>权利状态</dt><dd>{data.candidate.rightsStatus}</dd></div><div><dt>内容哈希</dt><dd><code>{data.candidate.contentHash ?? "尚未生成"}</code></dd></div></dl>
          <details open><summary>结构化候选数据</summary><pre>{JSON.stringify(data.candidate.metadata, null, 2)}</pre></details>
          <h3>处理产物</h3>
          {data.artifacts.length ? <ul>{data.artifacts.map((artifact) => <li key={artifact.id}>{artifact.artifactType} · {artifact.status} · {artifact.byteSize} bytes</li>)}</ul> : <p>尚无处理产物。</p>}
          <h3>处理记录</h3>
          {data.attempts.length ? <ul>{data.attempts.map((attempt) => <li key={attempt.id}>{attempt.jobType} · {attempt.status}{attempt.errorCode ? ` · ${attempt.errorCode}` : ""}</li>)}</ul> : <p>尚无处理记录。</p>}
        </section>

        <aside className="candidate-review__controls" aria-labelledby="candidate-review-title">
          <h2 id="candidate-review-title">审核门禁</h2>
          <p>审核身份：Codex AI（所有者授权），不是人工母语者或教学专家签字。</p>
          <label htmlFor="review-notes">审核备注</label>
          <textarea id="review-notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={4000} placeholder="记录判断依据或需要修改的内容" />
          {dimensions.map(([dimension, label]) => {
            const review = currentReviews.find((item) => item.dimension === dimension);
            return <section className="candidate-review__gate" key={dimension}><div><strong>{label}</strong><span>{review?.status ?? "pending"}</span></div>{review?.notes ? <p>{review.notes}</p> : null}<div><button disabled={pending} onClick={() => void mutate("reviews", { expectedRevision: data.candidate.revision, dimension, status: "approved", notes: notes || null })}>批准</button><button disabled={pending || !notes.trim()} onClick={() => void mutate("reviews", { expectedRevision: data.candidate.revision, dimension, status: "changes_requested", notes })}>请求修改</button><button disabled={pending || !notes.trim()} onClick={() => void mutate("reviews", { expectedRevision: data.candidate.revision, dimension, status: "rejected", notes })}>拒绝</button></div></section>;
          })}
          <button className="secondary-action" disabled={pending || !notes.trim() || data.candidate.publicationStatus !== "draft"} onClick={() => void mutate("reprocess", { expectedRevision: data.candidate.revision, notes })}>按备注重新处理</button>
          {data.candidate.publicationStatus === "published" ? <button className="danger-action" disabled={pending || !data.publisherAvailable} onClick={() => void mutate("archive", { expectedRevision: data.candidate.revision })}>撤下内容</button> : <button className="primary-action" disabled={pending || !publishable} onClick={() => void mutate("publish", { expectedRevision: data.candidate.revision, expectedContentHash: data.candidate.contentHash })}>显式发布</button>}
          {!data.publisherAvailable ? <p role="status">当前内容类型尚无正式 publisher；发布与撤下保持禁用。</p> : null}
          {message ? <p role="status">{message}</p> : null}
        </aside>
      </div>
    </main>
  );
}
