import { planReply, type ReplyPlan } from "../domain/reply-plan";
import type { ReplyContext } from "./build-reply-context";

export type CharacterReplyResult = Readonly<{
  plan: ReplyPlan;
  text: string;
}>;

export class ReplyGenerationAbortedError extends Error {
  constructor() {
    super("REPLY_GENERATION_ABORTED");
    this.name = "ReplyGenerationAbortedError";
  }
}

function ensureActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ReplyGenerationAbortedError();
}

function renderReply(context: ReplyContext, plan: ReplyPlan): string {
  const text = context.userMessage.trim();
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES");

  if (plan.intent === "identity-disclosure") {
    return "Soy un personaje de IA, y me gusta hablar contigo con honestidad. ¿Qué te gustaría contarme?";
  }
  if (
    context.openCommitments.some((commitment) => commitment.owner === "user" && commitment.status === "returned")
    && /\b(?:ya\s+(?:he\s+)?vuelto|ya\s+volvi|he\s+vuelto|estoy\s+de\s+vuelta|ya\s+termine|he\s+terminado)\b/iu.test(normalized)
  ) {
    return "Qué bien verte de vuelta 😊 ¿Qué tal ha ido la tarde haciendo fotos por el puerto?";
  }
  if (/\b(?:como estas|cómo estás|que tal estas|qué tal estás|como te va|cómo te va)\b/iu.test(normalized)) {
    return "Estoy bien, gracias. Me alegra leerte; ¿y tú, cómo estás?";
  }
  if (/^(?:hola|hey|buenas|que tal|qué tal|como va|cómo va)\b/iu.test(normalized)) {
    return "¡Hola! Qué alegría leerte. Yo estoy bien; ¿cómo va todo por tu lado?";
  }
  if (/\b(?:comida|comer|cafe|café|cocina|sabor)\b/iu.test(normalized)) {
    return context.character.characterKey === "mateo"
      ? "La comida y la música siempre se cruzan en mis planes. ¿Qué sabor o canción te ha acompañado últimamente?"
      : "La comida siempre da para una buena charla. ¿Qué sabor te apetece descubrir hoy?";
  }
  if (/\b(?:madrid|foto|fotografia|fotografía|paseo|ciudad)\b/iu.test(normalized)) {
    if (context.character.characterKey === "mateo") return "Me gusta salir con la cámara y escuchar cómo cambia una ciudad. ¿Qué escena o sonido te llamó la atención?";
    if (context.character.characterKey === "ines") return "Las ciudades cambian mucho según el barrio y la rutina. ¿Qué lugar de tu día te gustaría entender mejor?";
    return "Me encanta fijarme en los detalles de la ciudad. ¿Qué escena te llamó la atención últimamente?";
  }
  if (plan.intent === "emotional-support") {
    return context.character.characterKey === "ines"
      ? "Siento que estés pasando por eso. Podemos ordenar lo que ocurre paso a paso; ¿qué es lo más urgente ahora?"
      : "Siento que estés pasando por eso. Si te apetece, cuéntame qué es lo que más te preocupa ahora.";
  }
  if (plan.shouldShareExperience) {
    if (context.character.characterKey === "mateo") return "Te entiendo. A mí me gusta convertir las ideas en algo concreto; ¿qué parte de lo que cuentas te importa más?";
    if (context.character.characterKey === "ines") return "Te escucho. En los proyectos del barrio casi siempre ayuda empezar por lo cotidiano; ¿qué parte de tu día pesa más?";
    return "Te entiendo. A mí me gusta fijarme en las pequeñas historias del día; ¿qué parte de lo que cuentas te importa más?";
  }
  return "Te leo. Cuéntame un poco más; me interesa saber qué tienes en mente.";
}

/** Generates deterministic fake text from a structured plan; a provider can replace this later. */
export function generateCharacterReply(input: Readonly<{
  context: ReplyContext;
  plan?: ReplyPlan;
  signal?: AbortSignal;
}>): CharacterReplyResult {
  ensureActive(input.signal);
  const plan = input.plan ?? planReply({
    userMessage: input.context.userMessage,
    relationshipStage: input.context.relationshipStage,
    characterInitiative: input.context.character.initiative,
    characterTopics: input.context.character.topics,
    teachingOpportunity: input.context.teachingOpportunity ?? undefined,
  });
  const text = renderReply(input.context, plan);
  ensureActive(input.signal);
  return { plan, text };
}
