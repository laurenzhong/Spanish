import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createDrizzleScenarioPracticeRepository, listDueScenarioRepetitions } from "@/src/modules/scenario-practice";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export const metadata: Metadata = { title: "到期复现" };

export default async function DueRepetitionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Flearn%2Frepetitions");
  const items = process.env.DATABASE_URL ? await listDueScenarioRepetitions(createDrizzleScenarioPracticeRepository(getDatabase()), user.id).catch(() => []) : [];
  return <main className="scenario-history page-stack"><header className="page-header"><div><p className="eyebrow">间隔复现</p><h1>今天到期的场景</h1><p>换一个条件，再完成同一沟通目标。</p></div><a href="/learn">返回学习页</a></header>{items.length ? <ol className="scenario-history__list">{items.map((item) => <li key={item.id}><article><div><small>{item.intervalDays === 0 ? "当天复现" : `${item.intervalDays} 天复现`}</small><h2>{item.goalSnapshot}</h2><p>{item.expressionSnapshot[0]}</p></div><a className="primary-action" href={`/learn/repetitions/${encodeURIComponent(item.id)}`}>查看任务</a></article></li>)}</ol> : <section className="empty-state"><h2>今天没有到期复现</h2><p>你可以继续当前学习，或去探索新场景。</p><a className="primary-action" href="/learn">查看下一动作</a></section>}</main>;
}
