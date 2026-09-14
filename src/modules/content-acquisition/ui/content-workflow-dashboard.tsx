import type {
  AcquisitionRunRecord,
  ContentCandidateRecord,
  ContentSourceRecord,
} from "../repositories";

type Props = Readonly<{
  sources: readonly ContentSourceRecord[];
  runs: readonly AcquisitionRunRecord[];
  candidates: readonly ContentCandidateRecord[];
}>;

const typeLabel = { article: "文章", video: "视频", podcast: "播客" } as const;

export function ContentWorkflowDashboard({ sources, runs, candidates }: Props) {
  return (
    <main className="page-stack content-workflow">
      <header className="page-header page-header--simple">
        <div>
          <p className="eyebrow">仅所有者</p>
          <h1>内容工作流</h1>
          <p>自动化只生成候选。审核、批准和发布是彼此独立的显式操作。</p>
        </div>
      </header>

      <section className="content-workflow__summary" aria-label="工作流摘要">
        <div><strong>{candidates.length}</strong><span>最近候选</span></div>
        <div><strong>{candidates.filter((item) => item.status === "review_ready").length}</strong><span>等待审核</span></div>
        <div><strong>{sources.filter((item) => item.enabled).length}</strong><span>启用来源</span></div>
        <div><strong>{runs.filter((item) => item.status === "failed").length}</strong><span>失败运行</span></div>
      </section>

      <section className="content-workflow__panel" aria-labelledby="candidate-list-title">
        <div className="section-heading"><div><p className="eyebrow">候选库</p><h2 id="candidate-list-title">等待你的判断</h2></div></div>
        {candidates.length ? (
          <ol className="content-workflow__candidate-list">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <a href={`/me/content-workflow/${encodeURIComponent(candidate.id)}`}>
                  <span className="content-workflow__type">{typeLabel[candidate.contentType]}</span>
                  <span><strong>{candidate.title}</strong><small>{candidate.status} · 权 {candidate.rightsStatus} · revision {candidate.revision}</small></span>
                  <span>{candidate.publicationStatus === "draft" ? "查看审核" : candidate.publicationStatus === "published" ? "已发布" : "已撤下"}</span>
                </a>
              </li>
            ))}
          </ol>
        ) : <p className="content-workflow__empty">候选库为空。自动采集任务运行后，新候选会出现在这里。</p>}
      </section>

      <div className="content-workflow__columns">
        <section className="content-workflow__panel" aria-labelledby="source-list-title">
          <h2 id="source-list-title">来源</h2>
          {sources.length ? <ul>{sources.map((source) => <li key={source.id}><strong>{source.displayName}</strong><span>{source.sourceKind} · {source.enabled ? "启用" : "停用"} · {source.rightsStatus}</span></li>)}</ul> : <p>尚未注册来源。</p>}
        </section>
        <section className="content-workflow__panel" aria-labelledby="run-list-title">
          <h2 id="run-list-title">最近运行</h2>
          {runs.length ? <ul>{runs.slice(0, 8).map((run) => <li key={run.id}><strong>{run.status}</strong><span>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(run.startedAt)} · 新增 {run.insertedCount}</span></li>)}</ul> : <p>尚无采集运行。</p>}
        </section>
      </div>
    </main>
  );
}
