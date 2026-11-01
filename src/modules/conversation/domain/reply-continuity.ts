type ContinuityContext = Readonly<{
  userMessage: string;
  conversationTimeZone: string;
  currentLocalDate: string;
  recentMessages: readonly Readonly<{ role: "user" | "character"; content: string; sentAt?: string }>[];
}>;

function normalized(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("es-ES");
}

const occupationStopWords = new Set(["en", "de", "un", "una", "el", "la", "los", "las", "como", "mi", "trabajo", "curro"]);

/** Returns meaningful words from an explicit user occupation disclosure. */
export function userOccupationDisclosure(userMessage: string): readonly string[] {
  const text = normalized(userMessage).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  // Keep this signal tied to explicit work wording. A broad `soy ...` branch
  // treats ordinary introductions such as "soy Álex" as an occupation and
  // then rejects a grounded reply about the user's actual message.
  const match = /^(?:hola[,\s]+)?(?:yo\s+)?(?:trabajo|curro)\s+(?:en|de)\s+(.+)$/.exec(text)
    ?? /^(?:hola[,\s]+)?(?:yo\s+)?me\s+dedico\s+a\s+(.+)$/.exec(text);
  if (!match?.[1]) return [];
  return match[1].split(/\s+/u)
    .filter((word) => word.length >= 3 && !occupationStopWords.has(word))
    .slice(0, 6);
}

/** A latest occupation disclosure must be acknowledged before older activity topics are reopened. */
export function missesLatestOccupationContinuity(userMessage: string, reply: string): boolean {
  const disclosed = userOccupationDisclosure(userMessage);
  if (disclosed.length === 0) return false;
  const text = normalized(reply);
  const grounded = disclosed.some((word) => text.includes(word)
      || (word.length >= 5 && text.split(/[^\p{L}\p{N}]+/u).some((candidate) => candidate.length >= Math.max(5, word.length - 2) && candidate.slice(0, 4) === word.slice(0, 4))))
    || /\b(?:trabajo|trabajar|trabajando|curro|currar|empleo|oficio|profesion|profesión|dedicas|libros?)\b/u.test(text);
  if (grounded) return false;
  // Keep the gate focused on reopening the previous activity topic after a
  // direct work disclosure. This includes the reported free-time question;
  // a brief neutral reply may still pass, while a reply that asks about the
  // old free-time window must first acknowledge the occupation.
  return /\b(?:cocin(?:ar|a|ando)|descans(?:ar|ado|o|ando)|repos(?:ar|o)|relaj(?:ar|arte|ado)|pausa)\b/u.test(text)
    || /\b(?:rato|tiempo)\s+libre\b/u.test(text)
    || /\bque\s+tal\s+llevas\b/u.test(text);
}

/** A stated preference for calm conversation must not reopen a stale rescheduling topic. */
export function missesLatestQuietConversationContinuity(context: ContinuityContext, reply: string): boolean {
  const current = normalized(context.userMessage);
  if (!/\b(?:prefiero|me\s+gustan?|me\s+apetece)\s+(?:las\s+)?conversaciones?\s+(?:muy\s+)?tranquilas\b/u.test(current)) return false;
  const hadReschedulingTopic = context.recentMessages.some((message) =>
    /\b(?:otro\s+momento|aplaz(?:ar|ado|amos)|pospon(?:er|emos)|reprogram(?:ar|amos)|cambiar\s+de\s+(?:dia|momento))\b/u.test(normalized(message.content)));
  if (!hadReschedulingTopic) return false;
  const generated = normalized(reply);
  const reopensRescheduling = /\b(?:otro\s+momento|hab[eé]is\s+podido\s+encontrar|al\s+menos\s+hab[eé]is\s+podido)\b/u.test(generated);
  if (!reopensRescheduling) return false;
  return !/\b(?:tranquil|calma|sin\s+prisa|despacio|a\s+tu\s+ritmo|hablar)\b/u.test(generated);
}

export function requestsQuestionRepeat(userMessage: string): boolean {
  return /\b(?:repite(?:me(?:la)?|la)?|repetir(?:me(?:la)?|la)?|repites|que me habias preguntado)\b/u.test(normalized(userMessage));
}

export function requestsActivityAdvice(userMessage: string): boolean {
  return /\b(?:no se que hacer|que me recomiendas hacer|que hago|que puedo hacer|dame ideas|me das ideas)\b/u.test(normalized(userMessage));
}

function activityQuestions(text: string): readonly string[] {
  return (normalized(text).match(/[^?]*\?/gu) ?? [])
    .map((part) => part.split("¿").at(-1) ?? part)
    .filter((question) =>
      /\bque\s+(?:(?:vas|vais)\s+a\s+hacer|planes?\s+(?:tienes|teneis)|(?:piensas|quieres)\s+hacer)(?:\s+(?:para\s+)?(?:hoy|esta tarde|esta noche|manana|ahora|despues|luego|este finde|este fin de semana))?\s*[,?]/u.test(question)
      || (/\bo\b/u.test(question)
        && /\b(?:salir|saliste|caminar|pasear|paseo)\b/u.test(question)
        && /\b(?:cafe|casa|quedarte|quedaste|tranquilo)\b/u.test(question)));
}

function timeWindow(question: string): string {
  if (/\bmanana\b/u.test(question)) return "tomorrow";
  if (/\besta noche\b/u.test(question)) return "tonight";
  if (/\besta tarde\b/u.test(question)) return "afternoon";
  if (/\b(?:ahora|despues|luego)\b/u.test(question)) return "next";
  return "today";
}

function isSameLocalDay(sentAt: string | undefined, context: ContinuityContext): boolean {
  if (!sentAt) return false;
  const date = new Date(sentAt);
  if (Number.isNaN(date.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: context.conversationTimeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}` === context.currentLocalDate;
}

/**
 * A bounded check for the reported daily-plan loop, including questions asked
 * by the character. It does not infer that going to work means finishing work,
 * or establish semantic relevance for arbitrary conversations.
 */
export function repeatsDailyActivityQuestion(context: ContinuityContext, reply: string): boolean {
  const userMessage = normalized(context.userMessage);
  if (requestsQuestionRepeat(context.userMessage) || /\bno entendi\b/u.test(userMessage)) return false;
  const questions = activityQuestions(reply);
  if (questions.length === 0) return false;
  const previous = context.recentMessages
    .filter((message) => message.role === "character" && isSameLocalDay(message.sentAt, context))
    .flatMap((message) => activityQuestions(message.content));
  const userWindow = timeWindow(userMessage);
  return questions.some((question) => {
    // A question without an explicit window can inherit the user's newly
    // opened window. An explicit "today" question must not inherit "tonight".
    const questionWindow = timeWindow(question);
    const effectiveWindow = questionWindow === "today" && !/\bhoy\b/u.test(question) ? userWindow : questionWindow;
    if (requestsActivityAdvice(context.userMessage) && effectiveWindow === userWindow) return false;
    return previous.some((earlier) => timeWindow(earlier) === effectiveWindow);
  });
}

/**
 * Bounded regression for coffee being suggested by the character and later
 * reported as a completed user action. This is not a general fact verifier:
 * unknown attribution patterns and existing summary/memory mentions are left
 * to the provider's grounding rules rather than guessed from prose.
 */
export function attributesUnconfirmedCoffee(context: ContinuityContext & Readonly<{
  rollingSummary?: string | null;
  memories?: readonly Readonly<{ content: string }>[];
}>, reply: string): boolean {
  const coffee = /\bcafe\b/u;
  if (!context.recentMessages.some((message) => message.role === "character" && coffee.test(normalized(message.content)))) return false;
  const userEvidence = [context.userMessage, context.rollingSummary ?? "", ...(context.memories ?? []).map((memory) => memory.content),
    ...context.recentMessages.filter((message) => message.role === "user").map((message) => message.content)];
  if (userEvidence.some((content) => coffee.test(normalized(content)))) return false;
  const statements = normalized(reply).replace(/¿[^?]*\?/gu, "").split(/[.!?;\n]/u);
  return statements.some((statement) => {
    if (/\b(?:no|si|quiza|quizas|tal vez|a lo mejor)\b/u.test(statement)) return false;
    return /\b(?:pillaste|tomaste|bebiste|te tomaste|has (?:tomado|bebido)|te has tomado)\s+(?:(?:un|el|ese|tu)\s+)?cafe\b/u.test(statement);
  });
}

/** Do not turn unspecified weekend work into work on a particular day. */
export function narrowsUnspecifiedWeekendWork(context: ContinuityContext, reply: string): boolean {
  const userMessages = [context.userMessage, ...context.recentMessages.filter((message) => message.role === "user").map((message) => message.content)]
    .map(normalized);
  if (!userMessages.some((message) => /\b(?:fin de semana|finde)\b/u.test(message))) return false;
  if (!/\b(?:currar|trabajar|trabaje|curre|trabajando|currando)\b/u.test(normalized(context.userMessage))) return false;
  const statements = normalized(reply).replace(/¿[^?]*\?/gu, "").split(/[.!?;\n]/u);
  return statements.some((statement) => {
    // Self-reports, conditional advice and explicitly future plans do not
    // assert the weekday of the user's reported work.
    if (/\b(?:yo|si|podrias|podriamos|proximo|proxima|que viene|no)\b/u.test(statement)) return false;
    const day = /\b(?:currando|trabajando|curraste|trabajaste|curras|trabajas|trabajar|currar|plan)\s+(?:(?:en|de|el|este)\s+)?(sabado|domingo)\b/u.exec(statement)?.[1];
    return Boolean(day && !userMessages.some((message) => new RegExp(`\\b${day}\\b`, "u").test(message)));
  });
}

/**
 * A user can mention a future activity while explicitly keeping it tentative.
 * Do not let a reply turn that idea into a definite obligation or appointment.
 * This is intentionally limited to the observed tomorrow/cooking shape rather
 * than attempting general natural-language certainty detection.
 */
export function overstatesTentativeUserPlan(context: ContinuityContext, reply: string): boolean {
  const current = normalized(context.userMessage);
  if (!/\b(?:solo\s+es\s+una\s+idea|de\s+momento\s+solo\s+es\s+una\s+idea|todavia\s+no\s+es\s+(?:un\s+)?plan|aun\s+no\s+es\s+(?:un\s+)?plan)\b/u.test(current)) return false;
  const hasTentativePlan = context.recentMessages.some((message) => message.role === "user"
    && /\b(?:creo\s+que|quizas|tal\s+vez|a\s+lo\s+mejor)\b.{0,72}\b(?:manana|volver(?:e|as)?|cocinar(?:e|as)?)\b/u.test(normalized(message.content)));
  if (!hasTentativePlan) return false;
  const generated = normalized(reply);
  return /\b(?:manana\s+te\s+toca|te\s+toca\s+(?:volver|cocinar)|manana\s+(?:volveras|cocinaras)|seguro\s+que\s+(?:volveras|cocinaras)|manana\s+vuelve\s+la\s+cocina|la\s+cocina\s+recupera\s+manana)\b/u.test(generated);
}

/** A newly stated tentative cooking plan must not be answered with the prior book topic. */
export function missesLatestTentativeCookingContinuity(context: ContinuityContext, reply: string): boolean {
  const current = normalized(context.userMessage);
  if (!/\b(?:creo\s+que|quizas|tal\s+vez|a\s+lo\s+mejor)\b.{0,72}\b(?:manana|volver(?:e|as)?|cocinar(?:e|as)?)\b/u.test(current)) return false;
  const generated = normalized(reply);
  const cookingTerms = /\b(?:cocina|cocinar|cocines|receta|sarten|preparar|comida)\b/u.test(generated);
  const staleBookTerms = /\b(?:libro|libros|final(?:es)?|titulo|historia(?:s)?|capitulo)\b/u.test(generated);
  return !cookingTerms && staleBookTerms;
}
