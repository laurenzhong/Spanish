import type { Metadata } from "next";
import { Suspense } from "react";

import { mediaStableKeySchema } from "@/src/modules/media/schemas";

import MediaDetailLoading from "./loading";
import { MediaDetailContent, UnavailableDetail } from "./media-detail-content";

export const metadata: Metadata = { title: "媒体学习" };

type Context = Readonly<{
  params: Promise<{ stableKey: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}>;

export default async function MediaDetailPage({ params, searchParams }: Context) {
  let stableKey: string;
  try {
    stableKey = mediaStableKeySchema.parse(decodeURIComponent((await params).stableKey));
  } catch {
    return <UnavailableDetail />;
  }
  // Only the route param is awaited above: authentication, the media read and
  // the searchParams await all live inside the Suspense boundary, so a direct
  // visit streams the same detail skeleton as a client navigation.
  //
  // Next.js typed routes reject extra exports from a page module, so the
  // data-rendering half lives in the sibling `media-detail-content` module.
  return (
    <Suspense fallback={<MediaDetailLoading />}>
      <MediaDetailContent searchParams={searchParams} stableKey={stableKey} />
    </Suspense>
  );
}
