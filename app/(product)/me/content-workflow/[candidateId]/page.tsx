import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CandidateReviewWorkbench, createDrizzleContentAcquisitionRepository, getCandidateReview } from "@/src/modules/content-acquisition";
import { contentWorkflowPublishers } from "@/src/modules/content-acquisition/publishers/runtime-registry";
import { isContentWorkflowOwner } from "@/src/shared/auth/content-workflow-owner";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export const metadata: Metadata = { title: "审核内容候选" };
type Props = Readonly<{ params: Promise<{ candidateId: string }> }>;

function CandidateUnavailable() {
  return <main className="page-stack candidate-review"><header className="page-header"><div><p className="eyebrow">仅所有者</p><h1>候选暂不可用</h1><p>没有读取或修改任何审核数据。请稍后重试。</p></div></header><Link href="/me/content-workflow">返回内容工作流</Link></main>;
}

export default async function CandidateReviewPage({ params }: Props) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fme%2Fcontent-workflow");
  if (!isContentWorkflowOwner(user.id)) notFound();
  if (!process.env.DATABASE_URL) return <CandidateUnavailable />;
  const { candidateId } = await params;
  let detail;
  try {
    detail = await getCandidateReview(createDrizzleContentAcquisitionRepository(getDatabase()), { ownerUserId: user.id, candidateId, publishers: contentWorkflowPublishers });
  } catch {
    return <CandidateUnavailable />;
  }
  if (!detail) notFound();
  return <CandidateReviewWorkbench initialData={detail} />;
}
