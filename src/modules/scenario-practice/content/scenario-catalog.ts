import scenarioPracticeBundle from "@/content/bundles/scenario-practice-alpha-v2.json";
import { validateContentBundle } from "@/src/modules/content/import";

type LocalizedText = Readonly<Record<string, string>>;

export type ScenarioPracticeExpression = Readonly<{
  stableKey: string;
  text: string;
  translation: string;
  communicativeIntent: string;
  variants: readonly string[];
}>;

export type ScenarioPracticeTask = Readonly<{
  position: number;
  goalKey: string;
  prompt: string;
  successCriteria: Readonly<Record<string, unknown>>;
  targetExpressionKeys: readonly string[];
  hints: Readonly<{
    level1: string;
    level2: string;
    level3: string;
  }>;
}>;

export type ScenarioPracticeCondition = Readonly<{
  stableKey: string;
  afterUserTurns: number;
  prompt: string;
  characterLine: string;
}>;

export type ScenarioPracticeDetail = Readonly<{
  stableKey: string;
  version: number;
  title: string;
  description: string;
  setting: string;
  relationshipType: string;
  cefr: string;
  status: "draft" | "review" | "approved" | "published" | "archived";
  temporaryCharacter: Readonly<{
    displayName: string;
    role: string;
    locale: string;
    tone: string;
  }>;
  openingLine: string;
  openingContext: string;
  recommendedTurnCount: number;
  fictionalContext: boolean;
  conditions: readonly ScenarioPracticeCondition[];
  tasks: readonly ScenarioPracticeTask[];
  expressions: readonly ScenarioPracticeExpression[];
}>;

const content = validateContentBundle(scenarioPracticeBundle);

function localized(value: LocalizedText, locale: string, fallbackLocale: string): string {
  return value[locale] ?? value[fallbackLocale] ?? Object.values(value)[0] ?? "";
}

function toDetail(scenario: (typeof content.scenarios)[number]): ScenarioPracticeDetail | null {
  const practice = scenario.practice;

  if (!practice) {
    return null;
  }

  const expressionKeys = new Set(scenario.tasks.flatMap((task) => task.targetExpressionKeys));
  const expressions = content.expressions
    .filter((expression) => expressionKeys.has(expression.stableKey))
    .map((expression) => ({
      stableKey: expression.stableKey,
      text: expression.text,
      translation: localized(expression.translations, "zh-CN", content.bundle.nativeLanguage),
      communicativeIntent: localized(expression.communicativeIntent, "zh-CN", content.bundle.nativeLanguage),
      variants: expression.variants
        .toSorted((left, right) => left.position - right.position)
        .map((variant) => variant.text),
    }));

  return {
    stableKey: scenario.stableKey,
    version: scenario.version,
    title: localized(scenario.title, "zh-CN", content.bundle.nativeLanguage),
    description: localized(scenario.description, "zh-CN", content.bundle.nativeLanguage),
    setting: scenario.setting,
    relationshipType: scenario.relationshipType,
    cefr: scenario.cefr,
    status: scenario.status,
    temporaryCharacter: practice.temporaryCharacter,
    openingLine: localized(practice.openingLine, practice.temporaryCharacter.locale, content.bundle.defaultLocale),
    openingContext: localized(practice.openingLine, "zh-CN", content.bundle.nativeLanguage),
    recommendedTurnCount: practice.recommendedTurnCount,
    fictionalContext: practice.fictionalContext,
    conditions: practice.conditions.map((condition) => ({
      stableKey: condition.stableKey,
      afterUserTurns: condition.afterUserTurns,
      prompt: localized(condition.prompt, "zh-CN", content.bundle.nativeLanguage),
      characterLine: localized(condition.prompt, practice.temporaryCharacter.locale, content.bundle.defaultLocale),
    })),
    tasks: scenario.tasks
      .toSorted((left, right) => left.position - right.position)
      .map((task) => ({
        position: task.position,
        goalKey: task.goalKey,
        prompt: localized(task.prompt, "zh-CN", content.bundle.nativeLanguage),
        successCriteria: task.successCriteria,
        targetExpressionKeys: task.targetExpressionKeys,
        hints: {
          level1: localized(task.prompts.level1, "zh-CN", content.bundle.nativeLanguage),
          level2: localized(task.prompts.level2, "zh-CN", content.bundle.nativeLanguage),
          level3: localized(task.prompts.level3, "zh-CN", content.bundle.nativeLanguage),
        },
      })),
    expressions,
  };
}

const details = content.scenarios.flatMap((scenario) => {
  const detail = toDetail(scenario);
  return detail ? [detail] : [];
});

export function listScenarioPracticeDetails(): readonly ScenarioPracticeDetail[] {
  return details;
}

export function getScenarioPracticeDetail(stableKey: string): ScenarioPracticeDetail | null {
  return details.find((scenario) => scenario.stableKey === stableKey) ?? null;
}
