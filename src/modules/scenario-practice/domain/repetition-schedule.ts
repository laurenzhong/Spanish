export type ScenarioRepetitionResult = "contextual-success" | "needs-work" | "technical-failure";

export type ScenarioRepetitionItem = Readonly<{
  id: string;
  userId: string;
  sourceSessionId: string;
  intervalStep: 0 | 1 | 2 | 3;
  intervalDays: 0 | 1 | 3 | 7;
  dueAt: Date;
  status: "pending" | "completed";
  expressionSnapshot: readonly string[];
  goalSnapshot: string;
  variantRequirements: readonly Readonly<{ kind: string; value?: string }>[];
  idempotencyKey: string;
  completionKey: string | null;
  completedAt: Date | null;
  result: ScenarioRepetitionResult | null;
}>;

const intervals = [0, 1, 3, 7] as const;

export function createRepetitionSchedule(input: Readonly<{
  userId: string;
  sourceSessionId: string;
  baseIdempotencyKey: string;
  expressionSnapshot: readonly string[];
  goalSnapshot: string;
  variantRequirements: readonly Readonly<{ kind: string; value?: string }>[];
  now: () => Date;
  makeId: (step: 0 | 1 | 2 | 3) => string;
}>): readonly ScenarioRepetitionItem[] {
  const baseTime = input.now().getTime();
  return intervals.map((days, index) => ({
    id: input.makeId(index as 0 | 1 | 2 | 3),
    userId: input.userId,
    sourceSessionId: input.sourceSessionId,
    intervalStep: index as 0 | 1 | 2 | 3,
    intervalDays: days,
    dueAt: new Date(baseTime + days * 24 * 60 * 60 * 1_000),
    status: "pending" as const,
    expressionSnapshot: [...input.expressionSnapshot],
    goalSnapshot: input.goalSnapshot,
    variantRequirements: input.variantRequirements.map((requirement) => ({ ...requirement })),
    idempotencyKey: `${input.baseIdempotencyKey}:${days}`,
    completionKey: null,
    completedAt: null,
    result: null,
  }));
}

export function completeRepetitionItem(
  item: ScenarioRepetitionItem,
  input: Readonly<{
    completionKey: string;
    completedAt: Date;
    result: ScenarioRepetitionResult;
  }>,
): Readonly<{
  item: ScenarioRepetitionItem;
  alreadyCompleted: boolean;
  conflict?: "SCENARIO_TURN_CONFLICT";
}> {
  if (item.status === "completed") {
    return item.completionKey === input.completionKey
      ? { item, alreadyCompleted: true }
      : { item, alreadyCompleted: true, conflict: "SCENARIO_TURN_CONFLICT" };
  }
  return {
    alreadyCompleted: false,
    item: {
      ...item,
      status: "completed",
      completionKey: input.completionKey,
      completedAt: input.completedAt,
      result: input.result,
    },
  };
}
