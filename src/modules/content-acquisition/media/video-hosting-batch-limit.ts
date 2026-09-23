export function getMediaVideoHostingBatchLimit(dailyLimit: number, publishedToday: number, canaryOnly: boolean): number {
  if (canaryOnly) return 1;
  return Math.max(0, dailyLimit - publishedToday);
}
