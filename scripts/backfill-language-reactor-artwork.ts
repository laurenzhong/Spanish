import "dotenv/config";

import { randomUUID } from "node:crypto";
import { and, eq, max } from "drizzle-orm";

import * as schema from "../src/shared/db/schema";
import { createDatabaseConnection } from "../src/shared/db/client";

type CandidateMetadata = Readonly<{
  videoDraft?: Readonly<{ platformVideoId?: string; title?: string }>;
  podcastDraft?: Readonly<{ episodeGuid?: string; title?: string; sourceName?: string }>;
}>;

function videoArtwork(videoId: string, title: string) {
  return { url: `https://img.youtube.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`, alt: title.slice(0, 300), source: "youtube" as const, width: 320, height: 180 };
}

async function podcastArtwork(programName: string, alt: string) {
  if (!programName.trim()) return null;
  try {
    const response = await fetch(`https://itunes.apple.com/search?entity=podcast&limit=5&term=${encodeURIComponent(programName)}`, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const body = await response.json() as { results?: Array<{ collectionName?: string; artworkUrl600?: string; artworkUrl100?: string }> };
    const match = body.results?.find((entry) => entry.collectionName?.toLowerCase().includes(programName.toLowerCase())) ?? body.results?.[0];
    const url = match?.artworkUrl600 ?? match?.artworkUrl100;
    if (!url || !url.startsWith("https://")) return null;
    return { url, alt: alt.slice(0, 300), source: "podcast-feed" as const, width: 600, height: 600 };
  } catch {
    return null;
  }
}

type LanguageReactorPodcastDoc = Readonly<{ diocoDocId: string; audioFileURL?: string }>;

async function languageReactorPodcastDocs() {
  try {
    const response = await fetch("https://api-cdn.dioco.io/base_media_getMediaDocs_5", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        userEmail: null, diocoToken: null, translationLang_G: "zh-CN", freq95: { min: 0, max: 100_000 }, lang_G: "es",
        filters: { mediaTab: "TAB_PODCASTS" }, pinnedDiocoPlaylistIds: [], selectedDiocoPlaylistId: "t_pd_mix_es",
        diocoPlaylistId: "t_pd_mix_es", forceIncludeDiocoDocId: null, offset: 0, limit: 100,
      }),
    });
    if (!response.ok) return new Map<string, LanguageReactorPodcastDoc>();
    const body = await response.json() as { data?: { docs_metadata?: LanguageReactorPodcastDoc[] } };
    return new Map((body.data?.docs_metadata ?? []).map((doc) => [doc.diocoDocId, doc]));
  } catch {
    return new Map<string, LanguageReactorPodcastDoc>();
  }
}

function tokenExpiry(url: string): Date | null {
  try {
    const parsed = new URL(url);
    const expires = parsed.searchParams.get("Expires") ?? parsed.searchParams.get("expires");
    const token = parsed.searchParams.get("download-token")?.split("_", 1)[0];
    const seconds = Number(expires ?? token);
    return Number.isSafeInteger(seconds) && seconds > 0 ? new Date(seconds * 1_000) : null;
  } catch {
    return null;
  }
}

async function refreshedPodcastAsset(doc: LanguageReactorPodcastDoc | undefined) {
  if (!doc?.audioFileURL) return null;
  try {
    let response = await fetch(doc.audioFileURL, { method: "HEAD" });
    const initialHost = new URL(response.url || doc.audioFileURL).hostname.toLowerCase();
    if (response.status === 410 && initialHost === "ztnr.rtve.es") {
      response = await fetch(doc.audioFileURL, { headers: { range: "bytes=0-1" } });
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "";
    const host = new URL(response.url || doc.audioFileURL).hostname.toLowerCase();
    const allowedHosts = new Set(["traffic.libsyn.com", "content.libsyn.com", "ztnr.rtve.es", "rtve-mediavod-lote3.rtve.es"]);
    if (!response.ok || !allowedHosts.has(host) || !contentType.startsWith("audio/")) return null;
    const contentLength = Number(response.headers.get("content-length") ?? /\/([0-9]+)$/u.exec(response.headers.get("content-range") ?? "")?.[1]);
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0) return null;
    const expiresAt = tokenExpiry(response.url) ?? new Date(Date.now() + 24 * 3_600_000);
    if (expiresAt.getTime() <= Date.now()) return null;
    return { url: response.url, contentType, contentLength, expiresAt };
  } catch {
    return null;
  }
}

function needsPodcastRefresh(url: string): boolean {
  const expiry = tokenExpiry(url);
  return !expiry || expiry.getTime() <= Date.now() + 5 * 60_000;
}

async function main() {
  const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required.");
  const connection = createDatabaseConnection(connectionString);
  let updated = 0;
  try {
    const podcastDocs = await languageReactorPodcastDocs();
    const rows = await connection.db
      .select({ item: schema.mediaItems, version: schema.mediaVersions, candidate: schema.contentCandidates })
      .from(schema.mediaItems)
      .innerJoin(schema.mediaVersions, and(eq(schema.mediaVersions.mediaItemId, schema.mediaItems.id), eq(schema.mediaVersions.version, schema.mediaItems.currentVersion!)))
      .leftJoin(schema.contentCandidates, eq(schema.contentCandidates.id, schema.mediaVersions.acquisitionCandidateId))
      .where(eq(schema.mediaVersions.status, "published"));

    for (const row of rows) {
      const metadata = (row.candidate?.metadata ?? {}) as CandidateMetadata;
      const currentAssets = await connection.db.select().from(schema.mediaAssets).where(eq(schema.mediaAssets.mediaVersionId, row.version.id));
      const currentAsset = currentAssets[0];
      const videoId = metadata.videoDraft?.platformVideoId ?? row.version.platformSourceId;
      const artwork = row.item.kind === "video"
        ? (videoId && (!row.version.artworkUrl || row.version.artworkUrl.endsWith("/maxresdefault.jpg")) ? videoArtwork(videoId, row.version.title) : null)
        : (!row.version.artworkUrl ? await podcastArtwork(row.version.sourceName, row.version.sourceName) : null);
      const podcastDocId = metadata.podcastDraft?.episodeGuid ?? row.version.platformSourceId;
      const refreshedAsset = row.item.kind === "podcast" && currentAsset && needsPodcastRefresh(currentAsset.playbackUrl)
        ? await refreshedPodcastAsset(podcastDocs.get(podcastDocId ?? ""))
        : null;
      if (!artwork && !refreshedAsset) continue;

      await connection.db.transaction(async (tx) => {
        const [latest] = await tx.select({ value: max(schema.mediaVersions.version) }).from(schema.mediaVersions).where(eq(schema.mediaVersions.mediaItemId, row.item.id));
        const nextVersion = Number(latest?.value ?? row.version.version) + 1;
        const [created] = await tx.insert(schema.mediaVersions).values({
          mediaItemId: row.item.id,
          version: nextVersion,
          locale: row.version.locale,
          title: row.version.title,
          summary: row.version.summary,
          sourceName: row.version.sourceName,
          sourceUrl: row.version.sourceUrl,
          platformSourceId: row.version.platformSourceId,
          sourceChannelId: row.version.sourceChannelId,
          sourceFeedUrl: row.version.sourceFeedUrl,
          enclosureUrlHash: row.version.enclosureUrlHash,
          language: row.version.language,
          region: row.version.region,
          cefr: row.version.cefr,
          topics: row.version.topics,
          durationMs: row.version.durationMs,
          publicationDate: row.version.publicationDate,
          curatedAt: new Date(),
          publishedAt: row.version.publishedAt,
          contentHash: row.version.contentHash,
          status: "published",
          license: row.version.license,
          attribution: row.version.attribution,
          licenseEvidence: row.version.licenseEvidence,
          copyrightStatus: row.version.copyrightStatus,
          fetchedAt: null,
          changeReason: "Artwork backfill for the owner-authorized Language Reactor media.",
          reviewNotes: "Published artwork-only revision; prior media version remains immutable.",
          artworkUrl: artwork?.url ?? row.version.artworkUrl,
          artworkAlt: artwork?.alt ?? row.version.artworkAlt,
          artworkSource: artwork?.source ?? row.version.artworkSource,
          artworkWidth: artwork?.width ?? row.version.artworkWidth,
          artworkHeight: artwork?.height ?? row.version.artworkHeight,
          artworkExpiresAt: null,
        }).returning({ id: schema.mediaVersions.id });
        if (!created) throw new Error("MEDIA_ARTWORK_BACKFILL_FAILED");
        const assets = await tx.select().from(schema.mediaAssets).where(eq(schema.mediaAssets.mediaVersionId, row.version.id));
        if (assets.length > 0) await tx.insert(schema.mediaAssets).values(assets.map((asset) => ({ mediaVersionId: created.id, kind: asset.kind, providerKey: refreshedAsset ? "language-reactor" : asset.providerKey, playbackUrl: refreshedAsset?.url ?? asset.playbackUrl, playbackExpiresAt: refreshedAsset?.expiresAt ?? asset.playbackExpiresAt, mimeType: refreshedAsset?.contentType ?? asset.mimeType, availability: asset.availability })));
        const segments = await tx.select().from(schema.mediaSegments).where(eq(schema.mediaSegments.mediaVersionId, row.version.id));
        if (segments.length > 0) await tx.insert(schema.mediaSegments).values(segments.map((segment) => ({ mediaVersionId: created.id, segmentIndex: segment.segmentIndex, startMs: segment.startMs, endMs: segment.endMs, speaker: segment.speaker, sourceText: segment.sourceText, translation: segment.translation, confidence: segment.confidence, sourceKind: segment.sourceKind, reviewStatus: segment.reviewStatus })));
        const progress = await tx.select().from(schema.userMediaProgress).where(eq(schema.userMediaProgress.mediaVersionId, row.version.id));
        if (progress.length > 0) await tx.insert(schema.userMediaProgress).values(progress.map((entry) => ({ userId: entry.userId, mediaVersionId: created.id, lastPositionMs: entry.lastPositionMs, lastSegmentIndex: entry.lastSegmentIndex, status: entry.status, revision: entry.revision, lastOpenedAt: entry.lastOpenedAt, updatedAt: entry.updatedAt })));
        const reviews = await tx.select().from(schema.contentReviews).where(and(eq(schema.contentReviews.entityType, "media"), eq(schema.contentReviews.entityId, row.version.id)));
        if (reviews.length > 0) await tx.insert(schema.contentReviews).values(reviews.map((review) => ({ id: randomUUID(), entityType: "media" as const, entityId: created.id, locale: review.locale, status: review.status, reviewerReference: review.reviewerReference, notes: review.notes, reviewedAt: review.reviewedAt })));
        await tx.update(schema.mediaItems).set({ currentVersion: nextVersion, updatedAt: new Date() }).where(eq(schema.mediaItems.id, row.item.id));
      });
      updated += 1;
    }
    process.stdout.write(JSON.stringify({ updated }) + "\n");
  } finally {
    await connection.client.end();
  }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Artwork backfill failed."}\n`); process.exitCode = 1; });
