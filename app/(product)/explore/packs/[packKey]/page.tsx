import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getContentPack } from "@/src/modules/content/application";
import { BundleContentPackRepository } from "@/src/modules/content/repositories";
import { ContentPackExperience } from "@/src/modules/content/ui/content-pack-experience";

type ContentPackPageProps = Readonly<{
  params: Promise<{ packKey: string }>;
}>;

export const metadata: Metadata = {
  title: "沉浸内容包",
};

export default async function ContentPackPage({ params }: ContentPackPageProps) {
  const { packKey } = await params;
  const result = await getContentPack(new BundleContentPackRepository(), packKey, {
    allowDraft: process.env.NODE_ENV !== "production",
  });

  if (result.status !== "found") notFound();
  return <ContentPackExperience pack={result.pack} />;
}

