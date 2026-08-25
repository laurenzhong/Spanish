export const introductionReasonCodes = [
  "shared-interest",
  "content-connection",
  "life-context",
] as const;

export type IntroductionReasonCode = (typeof introductionReasonCodes)[number];

export type IntroductionCandidate = Readonly<{
  userId: string;
  sourceCharacterKey: string;
  sourceCharacterVersion: number;
  targetCharacterKey: string;
  targetCharacterVersion: number;
  recentMessages?: readonly Readonly<{ role: "user" | "character"; content: string }>[];
  contentEvent?: Readonly<{ packKey: string; relation: "shared-interest" | "life-context" }>;
  userInterests?: readonly string[];
}>;

export type IntroductionOffer = Readonly<{
  offerKey: string;
  userId: string;
  sourceCharacterKey: string;
  sourceCharacterVersion: number;
  targetCharacterKey: string;
  targetCharacterVersion: number;
  reasonCode: IntroductionReasonCode;
  reasonText: string;
  status: "pending" | "accepted" | "declined" | "expired";
}>;

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("es-ES");
}

const interestPattern = /\b(?:foto|fotografia|fotografía|comida|cafe|café|musica|música|cine|libro|viaje|paseo)\b/iu;
const lifePattern = /\b(?:trabajo|universidad|estudio|mudanza|mudanza|familia|casa|alquiler|vecino|barrio|rutina)\b/iu;

function reasonFor(input: IntroductionCandidate): Readonly<{ code: IntroductionReasonCode; text: string }> | null {
  const latestUserText = [...(input.recentMessages ?? [])]
    .reverse()
    .find((message) => message.role === "user")?.content ?? "";
  const text = normalized(latestUserText);
  if (input.contentEvent) {
    return input.contentEvent.relation === "shared-interest"
      ? { code: "content-connection", text: "你们刚聊到的内容，和这位好友正在关注的主题正好相连。" }
      : { code: "life-context", text: "你刚提到的生活话题，让认识一位有相近经历的好友变得自然。" };
  }
  if (interestPattern.test(text) || (input.userInterests ?? []).length > 0) {
    return { code: "shared-interest", text: "你们刚好有一个共同感兴趣的话题，介绍会很自然。" };
  }
  if (lifePattern.test(text)) {
    return { code: "life-context", text: "你刚提到的生活情境，和这位好友的关系背景有真实连接。" };
  }
  return null;
}

export function buildIntroductionOffer(input: IntroductionCandidate): IntroductionOffer | null {
  if (input.sourceCharacterKey !== "lucia" || input.sourceCharacterVersion !== 1) return null;
  if (!["mateo", "ines"].includes(input.targetCharacterKey) || input.targetCharacterVersion !== 1) return null;
  const reason = reasonFor(input);
  if (!reason) return null;
  const offerKey = `intro-${stableHash([
    input.userId,
    input.sourceCharacterKey,
    input.targetCharacterKey,
    reason.code,
    normalized(input.contentEvent?.packKey ?? ""),
    normalized([...input.recentMessages ?? []].map((message) => message.content).join("|")),
  ].join("|"))}`;
  return {
    offerKey,
    userId: input.userId,
    sourceCharacterKey: input.sourceCharacterKey,
    sourceCharacterVersion: input.sourceCharacterVersion,
    targetCharacterKey: input.targetCharacterKey,
    targetCharacterVersion: input.targetCharacterVersion,
    reasonCode: reason.code,
    reasonText: reason.text,
    status: "pending",
  };
}

export type IntroductionTransition = "accept" | "decline" | "expire";

export function transitionIntroduction(
  offer: Pick<IntroductionOffer, "status">,
  transition: IntroductionTransition,
): Exclude<IntroductionOffer["status"], "pending"> {
  if (offer.status !== "pending") {
    throw new Error("INTRODUCTION_ALREADY_RESOLVED");
  }
  return transition === "accept" ? "accepted" : transition === "decline" ? "declined" : "expired";
}
