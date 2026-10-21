import type { Metadata } from "next";
import Link from "next/link";

import { mediaSeriesKeySchema } from "@/src/modules/media/schemas/media-series";
import { MediaSeriesPage } from "@/src/modules/media/ui/media-series-page";

export const metadata: Metadata = { title: "媒体系列" };

export default async function SeriesPage({ params }: Readonly<{ params: Promise<{ seriesKey: string }> }>) {
  const parsed = mediaSeriesKeySchema.safeParse((await params).seriesKey);
  if (!parsed.success) return <section className="media-detail media-detail--empty" role="status"><h1>系列暂不可用</h1><Link href="/learn">返回学习资料库</Link></section>;
  return <MediaSeriesPage key={parsed.data} seriesKey={parsed.data} />;
}
