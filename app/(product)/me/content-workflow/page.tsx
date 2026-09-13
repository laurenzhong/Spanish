import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ContentWorkflowDashboard, createDrizzleContentAcquisitionRepository, listAcquisitionRuns, listAcquisitionSources, listCandidates } from "@/src/modules/content-acquisition";
import { isContentWorkflowOwner } from "@/src/shared/auth/content-workflow-owner";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export const metadata: Metadata = { title: "内容工作流" };

function WorkflowUnavailable() {
  return <main className="page-stack content-workflow"><header className="page-header"><div><p className="eyebrow">仅所有者</p><h1>内容工作流</h1><p>数据库未配置或暂时不可用，候选工作流尚未读取任何数据。</p></div></header></main>;
}

export default async function ContentWorkflowPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fme%2Fcontent-workflow");
  if (!isContentWorkflowOwner(user.id)) notFound();
  if (!process.env.DATABASE_URL) return <WorkflowUnavailable />;
  let workflowData;
  try {
    const repository = createDrizzleContentAcquisitionRepository(getDatabase());
    workflowData = await Promise.all([
      listAcquisitionSources(repository, user.id),
      listAcquisitionRuns(repository, { ownerUserId: user.id, limit: 20 }),
      listCandidates(repository, { ownerUserId: user.id, limit: 100 }),
    ]);
  } catch {
    return <WorkflowUnavailable />;
  }
  return <ContentWorkflowDashboard sources={workflowData[0]} runs={workflowData[1]} candidates={workflowData[2]} />;
}
