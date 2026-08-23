export type LocalizedContentText = Readonly<Record<string, string>>;

export type ContentPackSegment = Readonly<{
  id: string;
  position: number;
  text: string;
  translations: LocalizedContentText;
  chunks: readonly Readonly<{
    kind: "sense_group" | "target" | "connector";
    stressed: boolean;
    text: string;
  }>[];
}>;

export type ContentPackActivity = Readonly<{
  id: string;
  position: number;
  segmentPosition: number | null;
  activityType: "listening" | "shadowing" | "reading" | "typing" | "speaking" | "transfer";
  modality: "speech" | "typing" | "listening" | "reading";
  instructions: LocalizedContentText;
  configuration: Readonly<Record<string, unknown>>;
}>;

export type ContentPackProjection = Readonly<{
  id: string;
  stableKey: string;
  version: number;
  title: LocalizedContentText;
  summary: LocalizedContentText;
  cefr: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  status: "draft" | "published" | "unavailable";
  segments: readonly ContentPackSegment[];
  activities: readonly ContentPackActivity[];
}>;

export const contentPackErrorCodes = ["content-pack-invalid"] as const;
export type ContentPackErrorCode = (typeof contentPackErrorCodes)[number];

export class ContentPackError extends Error {
  readonly code: ContentPackErrorCode;

  constructor(code: ContentPackErrorCode, message: string) {
    super(message);
    this.name = "ContentPackError";
    this.code = code;
  }
}

type RawContentPack = Readonly<{
  stableKey: string;
  version: number;
  title: LocalizedContentText;
  summary: LocalizedContentText;
  cefr: ContentPackProjection["cefr"];
  status: "draft" | "review" | "approved" | "published" | "archived";
  segments: readonly Omit<ContentPackSegment, "id">[];
  activities: readonly (Omit<ContentPackActivity, "id" | "segmentPosition"> & {
    segmentPosition?: number | null;
  })[];
}>;

function assertPositions(values: readonly { position: number }[], label: string): void {
  const positions = values.map((value) => value.position).sort((left, right) => left - right);
  if (positions.some((position, index) => position !== index)) {
    throw new ContentPackError("content-pack-invalid", `${label} positions must be unique and contiguous.`);
  }
}

export function projectContentPack(raw: RawContentPack): ContentPackProjection {
  if (!raw.stableKey.trim() || raw.version < 1 || raw.segments.length === 0 || raw.activities.length === 0) {
    throw new ContentPackError("content-pack-invalid", "Content pack metadata is incomplete.");
  }

  assertPositions(raw.segments, "Segment");
  assertPositions(raw.activities, "Activity");

  const segments = [...raw.segments]
    .sort((left, right) => left.position - right.position)
    .map((segment) => ({ ...segment, id: `${raw.stableKey}@${raw.version}:segment:${segment.position}` }));
  const segmentPositions = new Set(segments.map((segment) => segment.position));
  const activities = [...raw.activities]
    .sort((left, right) => left.position - right.position)
    .map((activity) => {
      if (activity.segmentPosition !== null && activity.segmentPosition !== undefined && !segmentPositions.has(activity.segmentPosition)) {
        throw new ContentPackError("content-pack-invalid", `Activity ${activity.position} references an unknown segment.`);
      }
      return {
        ...activity,
        id: `${raw.stableKey}@${raw.version}:activity:${activity.position}`,
        segmentPosition: activity.segmentPosition ?? null,
      };
    });

  return {
    id: `${raw.stableKey}@${raw.version}`,
    stableKey: raw.stableKey,
    version: raw.version,
    title: raw.title,
    summary: raw.summary,
    cefr: raw.cefr,
    status: raw.status === "published" ? "published" : raw.status === "draft" ? "draft" : "unavailable",
    segments,
    activities,
  };
}

export function isContentPackAvailable(pack: ContentPackProjection, allowDraft = false): boolean {
  return pack.status === "published" || (allowDraft && pack.status === "draft");
}
