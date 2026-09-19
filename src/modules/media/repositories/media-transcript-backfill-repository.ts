import type { DraftMediaSegment } from "../domain";

export type MediaTranscriptBackfillReviewDimension = "content-es-ES" | "teaching-zh-CN" | "structure";
export type MediaTranscriptBackfillReviewStatus = "pending" | "approved" | "changes_requested" | "rejected";

export type MediaTranscriptBackfillRecord = Readonly<{
  id: string;
  mediaStableKey: string;
  mediaVersionId: string;
  mediaItemId: string;
  sourceVersion: number;
  audioHash: string;
  segments: readonly DraftMediaSegment[];
  provider: string;
  modelVersion: string;
  lowConfidence: boolean;
  translationFailedCount: number;
  status: "draft" | "approved" | "published" | "rejected";
  publishedVersion: number | null;
  reviews: Readonly<Record<MediaTranscriptBackfillReviewDimension, MediaTranscriptBackfillReviewStatus>>;
}>;

export type MediaTranscriptBackfillRepository = Readonly<{
  createTranscriptBackfill(input: Readonly<{
    id: string;
    mediaStableKey: string;
    mediaVersionId: string;
    mediaItemId: string;
    sourceVersion: number;
    audioHash: string;
    segments: readonly DraftMediaSegment[];
    provider: string;
    modelVersion: string;
    lowConfidence: boolean;
    translationFailedCount: number;
    createdAt: Date;
  }>): Promise<MediaTranscriptBackfillRecord>;
  replaceTranscriptBackfillDraft?(input: Readonly<{
    mediaStableKey: string;
    mediaVersionId: string;
    mediaItemId: string;
    sourceVersion: number;
    audioHash: string;
    segments: readonly DraftMediaSegment[];
    provider: string;
    modelVersion: string;
    lowConfidence: boolean;
    translationFailedCount: number;
    updatedAt: Date;
  }>): Promise<MediaTranscriptBackfillRecord>;
  reviewTranscriptBackfill(input: Readonly<{
    backfillId: string;
    dimension: MediaTranscriptBackfillReviewDimension;
    status: Exclude<MediaTranscriptBackfillReviewStatus, "pending">;
    reviewerReference: string;
    notes: string | null;
    reviewedAt: Date;
  }>): Promise<MediaTranscriptBackfillRecord>;
  updateTranscriptBackfillTranslations?(input: Readonly<{
    backfillId: string;
    segments: readonly DraftMediaSegment[];
    translationFailedCount: number;
    updatedAt: Date;
  }>): Promise<MediaTranscriptBackfillRecord>;
  publishTranscriptBackfill(input: Readonly<{
    backfillId: string;
    expectedReviews: readonly MediaTranscriptBackfillReviewDimension[];
    publishedAt: Date;
  }>): Promise<Readonly<{ stableKey: string; version: number }>>;
}>;
