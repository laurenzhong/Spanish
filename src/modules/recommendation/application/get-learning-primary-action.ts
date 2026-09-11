export type DueRepetitionActionInput = Readonly<{
  id: string;
  goalSnapshot: string;
  dueAt: string;
}>;

export type LearningPrimaryAction = Readonly<{
  kind: "resume" | "due-repetition" | "first-practice";
  label: string;
  title: string;
  reason: string;
  href: string;
}>;

export function getLearningPrimaryAction(input: Readonly<{
  hasStableBreakpoint: boolean;
  dueRepetition?: DueRepetitionActionInput | null;
  practiceHref?: string;
  practiceTitle?: string;
  practiceReason?: string;
}>): LearningPrimaryAction {
  const practiceHref = input.practiceHref ?? "/learn/practice";
  if (input.hasStableBreakpoint) return {
    kind: "resume", label: "继续学习", title: input.practiceTitle ?? "继续上次练习",
    reason: input.practiceReason ?? "从上次保存的稳定断点继续。", href: practiceHref,
  };
  if (input.dueRepetition) return {
    kind: "due-repetition", label: "开始到期复现", title: input.dueRepetition.goalSnapshot,
    reason: "这项场景已经到期；现在换一个条件复现，能验证是否真正迁移。",
    href: `/learn/repetitions/${encodeURIComponent(input.dueRepetition.id)}`,
  };
  return {
    kind: "first-practice", label: "开始第一次练习", title: input.practiceTitle ?? "从一句真实表达开始",
    reason: input.practiceReason ?? "完成第一次练习，建立可靠的学习断点。", href: practiceHref,
  };
}
