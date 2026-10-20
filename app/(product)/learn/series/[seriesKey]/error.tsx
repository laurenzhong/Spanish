"use client";

import Link from "next/link";

export default function MediaSeriesError({ reset }: Readonly<{ reset: () => void }>) {
  return <section className="media-detail media-detail--empty" role="alert"><h1>暂时无法读取系列</h1><button className="media-player-retry" onClick={reset} type="button">重试</button><Link href="/learn">返回学习资料库</Link></section>;
}
