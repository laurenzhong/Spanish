"use client";

import { useEffect, useState } from "react";

type Candidate = Readonly<{
  candidateKey: string;
  subjectType: string;
  subjectId: string;
  strongestSignal: string;
  signalCount: number;
  reviewAction: { kind: string };
}>;

type Report = Readonly<{
  id: string;
  status: "generated" | "insufficient_data" | "failed";
  summary: string;
  coverage: { observationCount: number; eligibleObservationCount: number; excludedObservationCount: number; eventTypeCounts: Record<string, number>; sourceModuleCounts: Record<string, number> };
  candidates: readonly Candidate[];
}>;

export function DailyLearningReport() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/profile/daily-learning-report", { credentials: "include" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("report")))
      .then((payload: { data?: { report?: Report } }) => { if (active) setReport(payload.data?.report ?? null); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);

  async function feedback(candidateKey: string, value: "mastered" | "not_relevant" | "review_again") {
    if (!report) return;
    await fetch(`/api/v1/profile/daily-learning-report/${report.id}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ candidateKey, feedback: value, dedupeKey: `${candidateKey}:${value}` }),
    });
    if (value !== "review_again") setReport({ ...report, candidates: report.candidates.filter((candidate) => candidate.candidateKey !== candidateKey) });
  }

  return (
    <section className="profile-overview-panel" aria-labelledby="daily-learning-report-title">
      <div className="profile-overview-panel__header">
        <div><p className="eyebrow">今日复习</p><h2 id="daily-learning-report-title">学习轨迹笔记</h2></div>
      </div>
      {error ? <p role="status">今日报告暂时无法读取。</p> : !report ? <p role="status">正在整理最近的学习轨迹…</p> : (
        <>
          <p className="profile-report__summary">{report.summary}</p>
          <p className="profile-report__coverage">{report.coverage.eligibleObservationCount} 条可用线索 · {report.coverage.observationCount} 条记录</p>
          {report.status === "insufficient_data" && report.coverage.observationCount > 0 ? (
            <>
              <p className="profile-report__muted">{report.coverage.excludedObservationCount} 条记录暂未关联到可复习内容。</p>
            </>
          ) : null}
          {report.status === "insufficient_data" ? <p className="profile-report__muted">继续使用内容或词句考察，积累可解释的复习线索。</p> : null}
          <div className="profile-overview-panel__grid">
            {report.candidates.map((candidate) => (
              <article key={candidate.candidateKey}>
                <strong>{candidate.subjectId}</strong>
                <p>{candidate.signalCount} 个学习线索</p>
                <div className="profile-report__actions">
                  <button type="button" onClick={() => void feedback(candidate.candidateKey, "review_again")}>继续复习</button>
                  <details className="profile-report__more">
                    <summary>调整</summary>
                    <div>
                      <button type="button" onClick={() => void feedback(candidate.candidateKey, "mastered")}>已掌握</button>
                      <button type="button" onClick={() => void feedback(candidate.candidateKey, "not_relevant")}>不相关</button>
                    </div>
                  </details>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
