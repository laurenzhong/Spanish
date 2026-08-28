import type { LocalizedContentText } from "@/src/modules/content/domain";

export const exploreCardStatuses = ["published", "in_progress", "draft", "unavailable"] as const;
export type ExploreCardStatus = (typeof exploreCardStatuses)[number];

export const exploreSkillTypes = ["listen", "read", "speak", "write"] as const;
export type ExploreSkill = (typeof exploreSkillTypes)[number];

export type ExploreGoalRecord = Readonly<{
  stableKey: string;
  title: LocalizedContentText;
  description: LocalizedContentText;
  position: number;
  status: "draft" | "review" | "approved" | "published" | "archived";
  expressionCount: number;
}>;

export type ExploreContentPackRecord = Readonly<{
  id: string;
  stableKey: string;
  version: number;
  title: LocalizedContentText;
  summary: LocalizedContentText;
  cefr: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  sourceTitle: string | null;
  copyrightStatus: "unverified" | "cleared" | "restricted";
  status: "draft" | "published" | "unavailable";
  skills: readonly ExploreSkill[];
  activityCount: number;
  updatedAt: string | null;
}>;

export type ExplorePackProgress = Readonly<{
  completedSteps: number;
  totalSteps: number;
}>;

export type ExploreUserPackState = Readonly<{
  saved: boolean;
  progress?: ExplorePackProgress;
}>;

export type ExploreUserState = Readonly<{
  status: "available" | "unavailable";
  packs: Readonly<Record<string, ExploreUserPackState>>;
}>;

export type ExploreGoalDto = Readonly<{
  key: string;
  title: string;
  description: string;
  position: number;
  status: "draft" | "published";
  expressionCount: number;
}>;

export type ExploreCardDto = Readonly<{
  id: string;
  stableKey: string;
  title: string;
  summary: string;
  level: ExploreContentPackRecord["cefr"];
  skills: readonly ExploreSkill[];
  durationLabel: string;
  status: ExploreCardStatus;
  version: string;
  updatedAt: string | null;
  route?: string;
  progress?: ExplorePackProgress;
  saved?: boolean;
  source?: Readonly<{
    title: string;
    copyrightStatus: ExploreContentPackRecord["copyrightStatus"];
  }>;
}>;

export type ExploreDashboardDto = Readonly<{
  goals: readonly ExploreGoalDto[];
  packs: readonly ExploreCardDto[];
  resume: readonly ExploreCardDto[];
  userState: ExploreUserState["status"];
}>;

export type ExploreRepository = Readonly<{
  listGoals(): Promise<readonly ExploreGoalRecord[]>;
  listContentPacks(): Promise<readonly ExploreContentPackRecord[]>;
}>;

export type ExploreUserStateRepository = Readonly<{
  getForUser(userId: string): Promise<ExploreUserState>;
}>;

export class ExploreDashboardError extends Error {
  readonly code = "explore-dashboard-unavailable" as const;

  constructor(message = "Explore dashboard is unavailable.") {
    super(message);
    this.name = "ExploreDashboardError";
  }
}

function localized(value: LocalizedContentText, locale: string, fallbackLocale = "zh-CN"): string {
  return value[locale] ?? value[fallbackLocale] ?? Object.values(value)[0] ?? "";
}

export function toExploreCard(
  record: ExploreContentPackRecord,
  userState: ExploreUserState["packs"][string] | undefined,
): ExploreCardDto {
  const progress = userState?.progress;
  const inProgress = Boolean(progress && progress.completedSteps > 0 && progress.completedSteps < progress.totalSteps);
  const status: ExploreCardStatus = record.status === "published"
    ? inProgress
      ? "in_progress"
      : "published"
    : record.status;
  const canOpen = status === "published" || status === "in_progress";

  return {
    id: record.id,
    stableKey: record.stableKey,
    title: localized(record.title, "zh-CN"),
    summary: localized(record.summary, "zh-CN"),
    level: record.cefr,
    skills: record.skills,
    durationLabel: `约 ${Math.max(4, record.activityCount)} 分钟`,
    status,
    version: `v${record.version}`,
    updatedAt: record.updatedAt,
    ...(canOpen ? { route: `/explore/packs/${encodeURIComponent(record.stableKey)}` } : {}),
    ...(progress ? { progress } : {}),
    ...(userState ? { saved: userState.saved } : {}),
    ...(record.sourceTitle
      ? { source: { title: record.sourceTitle, copyrightStatus: record.copyrightStatus } }
      : {}),
  };
}

export async function getExploreDashboard(
  repository: ExploreRepository,
  userId: string,
  userStateRepository: ExploreUserStateRepository,
): Promise<ExploreDashboardDto> {
  if (!userId.trim()) throw new ExploreDashboardError("A user id is required.");

  const [goalRecords, packRecords, userState] = await Promise.all([
    repository.listGoals(),
    repository.listContentPacks(),
    userStateRepository.getForUser(userId),
  ]);

  const goals = [...goalRecords]
    .sort((left, right) => left.position - right.position)
    .map((goal) => ({
      key: goal.stableKey,
      title: localized(goal.title, "zh-CN"),
      description: localized(goal.description, "zh-CN"),
      position: goal.position,
      status: goal.status === "published" ? "published" as const : "draft" as const,
      expressionCount: goal.expressionCount,
    }));
  const packs = [...packRecords]
    .sort((left, right) => left.stableKey.localeCompare(right.stableKey) || left.version - right.version)
    .map((pack) => toExploreCard(pack, userState.packs[pack.id]));
  const resume = packs.filter((pack) => pack.status === "in_progress");

  return { goals, packs, resume, userState: userState.status };
}

