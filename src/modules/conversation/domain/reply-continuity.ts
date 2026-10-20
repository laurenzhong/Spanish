type ContinuityContext = Readonly<{
  userMessage: string;
  conversationTimeZone: string;
  currentLocalDate: string;
  recentMessages: readonly Readonly<{ role: "user" | "character"; content: string; sentAt?: string }>[];
}>;

function normalized(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("es-ES");
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
