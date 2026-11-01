import type { RelationshipKind } from "./relationship-state";

export type RelationshipCompletionCandidate = Readonly<{
  kind: Extract<RelationshipKind, "explicit_friend_boundary" | "contact_stop" | "voluntary_personal_anchor" | "mutual_conversation_welcome" | "user_continuity_return" | "user_trust_or_value" | "shared_positive_exchange" | "explicit_romantic_openness" | "explicit_romantic_confirmation" | "user_romantic_declaration" | "character_interest_signal" | "character_relationship_proposal" | "character_romantic_acceptance">;
  certainty: "explicit" | "supported";
  sourceMessageIds: readonly string[];
  relatedSourceMessageIds?: readonly string[];
  sourceRole: "user" | "assistant";
  boundary?: Readonly<{ scope: "romance" | "contact"; target: string }>;
}>;

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("es-ES").replace(/\s+/gu, " ").trim();
}

/** Compatibility wrapper that keeps the original boundary-only extraction API. */
export function extractExplicitRelationshipBoundaries(input: Readonly<{ text: string; userMessageId: string }>): readonly RelationshipCompletionCandidate[] {
  return extractRelationshipCandidates(input).filter((candidate) => candidate.kind === "explicit_friend_boundary" || candidate.kind === "contact_stop");
}

/**
 * Extracts a small, conservative set of relationship evidence. These phrases
 * are explicit enough to be durable; ordinary warmth, generic disclosure and
 * message count remain excluded. Assistant signals are still subject to
 * repository-side relationship admission.
 */
export function extractRelationshipCandidates(input: Readonly<{ text: string; userMessageId?: string; messageId?: string; role?: "user" | "assistant" }>): readonly RelationshipCompletionCandidate[] {
  const messageId = input.messageId ?? input.userMessageId;
  const role = input.role ?? "user";
  if (!input.text.trim() || !messageId) return [];
  const text = normalized(input.text);
  const candidates: RelationshipCompletionCandidate[] = [];
  if (/(?:^|\b)(?:solo|solamente)(?:\s+quiero)?\s+(?:amigos|amigas|amistad)(?:\b|$)/u.test(text) || /\b(?:only friends|just friends)\b/u.test(text) || /只做朋友|只想做朋友|只是朋友/u.test(input.text)) {
    candidates.push({ kind: "explicit_friend_boundary", certainty: "explicit", sourceMessageIds: [messageId], sourceRole: "user", boundary: { scope: "romance", target: "all" } });
  }
  if (/(?:no me escribas|no me contactes|no quiero que me escribas|deja de escribirme|stop contacting me|dont contact me)/u.test(text) || /不要联系我|别联系我|不要再给我发消息/u.test(input.text)) {
    candidates.push({ kind: "contact_stop", certainty: "explicit", sourceMessageIds: [messageId], sourceRole: "user", boundary: { scope: "contact", target: "all" } });
  }
  if (role === "user" && /(?:quiero algo mas que amistad|quiero algo más que amistad|me gustas|siento algo por ti|quiero estar contigo|me gustaria conocerte de otra manera|me gustaría conocerte de otra manera)/u.test(text)) {
    candidates.push({ kind: "user_romantic_declaration", certainty: "explicit", sourceMessageIds: [messageId], sourceRole: "user" });
  }
  if (role === "user" && /(?:si, quiero que seamos algo|sí, quiero que seamos algo|quiero que estemos juntos|acepto estar contigo|acepto intentarlo contigo|acepto lo que me propones|quiero ser tu pareja|quiero intentarlo contigo)/u.test(text)) {
    candidates.push({ kind: "explicit_romantic_confirmation", certainty: "explicit", sourceMessageIds: [messageId], sourceRole: "user" });
  }
  if (/(?:me gusta hablar contigo|me alegra (?:poder )?hablar contigo|me encanta hablar contigo|me gusta charlar contigo|me hace bien hablar contigo|me hace (?:mas )?ilusion hablar contigo|quiero conocerte mejor)/u.test(text)) {
    candidates.push({ kind: "mutual_conversation_welcome", certainty: "explicit", sourceMessageIds: [messageId], sourceRole: "user" });
  }
  if (/(?:he vuelto|vuelvo|ya estoy aqui|ya estoy aquí|volvi|volví|aqui estoy|aquí estoy|de vuelta)/u.test(text)) {
    candidates.push({ kind: "user_continuity_return", certainty: "explicit", sourceMessageIds: [messageId], sourceRole: "user" });
  }
  if (/(?:confio en ti|confío en ti|puedo confiar en ti|me ayudas mucho|te valoro mucho|eres importante para mi|eres importante para mí)/u.test(text)) {
    candidates.push({ kind: "user_trust_or_value", certainty: "explicit", sourceMessageIds: [messageId], sourceRole: "user" });
  }
  const deliberateAnchor = /(?:mi familia|mi trabajo|mi casa|mi salud|mi miedo|mi problema|mi historia)\b/iu.test(text)
    && /(?:quiero contarte|te cuento|necesito contarte|quiero compartir)/u.test(text);
  const selfIntroductionAnchor = /\b(?:hola|buenas)\b/iu.test(text)
    && /\b(?:soy|trabajo|vivo|me gusta|me encanta)\b/iu.test(text)
    && text.length >= 18;
  if (deliberateAnchor || selfIntroductionAnchor) {
    candidates.push({ kind: "voluntary_personal_anchor", certainty: "supported", sourceMessageIds: [messageId], sourceRole: "user" });
  }
  if (role === "assistant" && /(?:me gustas|siento algo especial por ti|me atraes|me importas de una manera especial)/u.test(text)) {
    candidates.push({ kind: "character_interest_signal", certainty: "explicit", sourceMessageIds: [messageId], sourceRole: "assistant" });
  }
  if (role === "assistant" && /(?:quiero que seamos algo mas|quiero que seamos algo más|quiero que intentemos una relacion|quiero que intentemos una relación|quiero intentar una relacion|quiero intentar una relación|me gustaria que fueramos algo mas|me gustaría que fuéramos algo más|me gustaria intentar algo contigo|me gustaría intentar algo contigo)/u.test(text)) {
    candidates.push({ kind: "character_relationship_proposal", certainty: "explicit", sourceMessageIds: [messageId], sourceRole: "assistant" });
  }
  if (role === "user" && /(?:me siento muy bien contigo|disfruto nuestras conversaciones|me hace feliz compartir esto contigo)/u.test(text)) {
    candidates.push({ kind: "shared_positive_exchange", certainty: "explicit", sourceMessageIds: [messageId], sourceRole: "user" });
  }
  return candidates;
}
