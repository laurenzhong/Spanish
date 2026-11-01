/** Temporary self-check results. These are never learning evidence or mastery. */
export type RecallMode = "word" | "meaning";
export type RecallResult = "correct" | "accent" | "incorrect" | "pending" | "unanswered";
export type RecallItem = Readonly<{ id: string; markKey: string; word: string; meanings: readonly string[] }>;
export type RecallAnswer = Readonly<{ value: string; result: RecallResult | null; hinted: boolean; revealed: boolean; selfConfirmed: boolean }>;
type RecallRound = Readonly<{ ids: readonly string[]; answers: Readonly<Record<string, RecallAnswer>>; generation: number }>;
export type RecallSession = Readonly<{
  mode: RecallMode;
  items: readonly RecallItem[];
  rounds: Readonly<Record<RecallMode, RecallRound>>;
}>;
export type RecallAction =
  | Readonly<{ type: "switch"; mode: RecallMode }>
  | Readonly<{ type: "input"; id: string; value: string }>
  | Readonly<{ type: "reveal"; id: string }>
  | Readonly<{ type: "check"; id?: string }>
  | Readonly<{ type: "confirm"; id: string; correct: boolean }>
  | Readonly<{ type: "retry" }>;

function emptyAnswer(): RecallAnswer {
  return { value: "", result: null, hinted: false, revealed: false, selfConfirmed: false };
}

function newRound(items: readonly RecallItem[], generation = 0): RecallRound {
  return { ids: items.map((item) => item.id), answers: Object.fromEntries(items.map((item) => [item.id, emptyAnswer()])), generation };
}

export function startRecall(items: readonly RecallItem[], mode: RecallMode, modeKeys?: Readonly<Record<RecallMode, readonly string[]>>): RecallSession {
  const seen = new Set<string>();
  const frozen = items.filter((item) => {
    if (!item.word.trim() || !item.meanings.some((meaning) => meaning.trim()) || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).map((item) => ({ ...item, meanings: item.meanings.map((meaning) => meaning.trim()).filter(Boolean) }));
  const forMode = (direction: RecallMode) => modeKeys ? frozen.filter((item) => modeKeys[direction].includes(item.markKey)) : frozen;
  return { mode, items: frozen, rounds: { word: newRound(forMode("word")), meaning: newRound(forMode("meaning")) } };
}

function normalizeWord(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("es").replace(/\s+/gu, " ");
}

function withoutAcute(value: string): string {
  // Only acute stress accents: folding all diacritics would incorrectly equate ñ/n and ü/u.
  return value.normalize("NFD").replace(/\u0301/gu, "").normalize("NFC");
}

function normalizeMeaning(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, "").replace(/[。.!！]+$/gu, "");
}

function meaningParts(value: string): readonly string[] {
  // Only explicit alternatives outside parenthetical qualifiers; no substring/fuzzy inference.
  const parts: string[] = [];
  let depth = 0;
  let part = "";
  for (const character of value.normalize("NFKC")) {
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && /[、,;；/|]/u.test(character)) {
      if (normalizeMeaning(part)) parts.push(normalizeMeaning(part));
      part = "";
    } else part += character;
  }
  if (normalizeMeaning(part)) parts.push(normalizeMeaning(part));
  return parts;
}

export function checkRecall(item: RecallItem, mode: RecallMode, value: string): RecallResult {
  if (!value.trim()) return "unanswered";
  if (mode === "word") {
    const actual = normalizeWord(value);
    const expected = normalizeWord(item.word);
    if (actual === expected) return "correct";
    return withoutAcute(actual) === withoutAcute(expected) ? "accent" : "incorrect";
  }
  const accepted = new Set(item.meanings.flatMap((meaning) => [normalizeMeaning(meaning), ...meaningParts(meaning)]));
  const supplied = meaningParts(value);
  return supplied.length > 0 && supplied.every((part) => accepted.has(part)) ? "correct" : "pending";
}

export function recallNeedsRetry(answer: RecallAnswer): boolean {
  return answer.result !== "correct" || answer.hinted || answer.selfConfirmed;
}

/** Call after checking the current answer; navigation never grades other items. */
export function nextUnansweredRecallId(session: RecallSession, currentId: string): string | null {
  const round = session.rounds[session.mode];
  const index = round.ids.indexOf(currentId);
  const answer = round.answers[currentId];
  if (index < 0 || !answer?.value.trim() || !answer.result || answer.result === "pending" || answer.result === "unanswered") return null;
  for (let offset = 1; offset < round.ids.length; offset += 1) {
    const id = round.ids[(index + offset) % round.ids.length]!;
    if (!round.answers[id]!.value.trim()) return id;
  }
  return null;
}

export function reduceRecall(session: RecallSession, action: RecallAction): RecallSession {
  if (action.type === "switch") {
    if (action.mode === session.mode) return session;
    // The opposite direction displays the answer as its cue. It cannot become
    // independent recall merely by toggling modes in the same session.
    const exposedKeys = new Set(session.items.filter((item) => session.rounds[session.mode].ids.includes(item.id)).map((item) => item.markKey));
    const target = session.rounds[action.mode];
    const answers = { ...target.answers };
    for (const item of session.items) {
      const answer = answers[item.id];
      if (answer && exposedKeys.has(item.markKey) && answer.result !== "correct") answers[item.id] = { ...answer, hinted: true };
    }
    return { ...session, mode: action.mode, rounds: { ...session.rounds, [action.mode]: { ...target, answers } } };
  }
  const round = session.rounds[session.mode];
  const replaceRound = (next: RecallRound): RecallSession => ({
    ...session, rounds: { ...session.rounds, [session.mode]: next },
  });
  if (action.type === "retry") {
    const ids = new Set(round.ids);
    const items = session.items.filter((item) => ids.has(item.id) && recallNeedsRetry(round.answers[item.id]!));
    if (!items.length) return session;
    const next = newRound(items, round.generation + 1);
    return replaceRound({ ...next, answers: Object.fromEntries(items.map((item) => {
      const previous = round.answers[item.id]!;
      const exposed = previous.hinted || previous.revealed || previous.selfConfirmed
        || (previous.result !== null && previous.result !== "correct" && previous.result !== "unanswered");
      return [item.id, { ...emptyAnswer(), hinted: exposed }];
    })) });
  }
  if (action.type === "check") {
    const answers = { ...round.answers };
    const ids = new Set(round.ids);
    for (const item of session.items) {
      if (!ids.has(item.id) || (action.id !== undefined && action.id !== item.id)) continue;
      const answer = answers[item.id]!;
      // Explicit confirmations survive an idempotent re-check until the answer is edited.
      if (!answer.selfConfirmed) answers[item.id] = { ...answer, result: checkRecall(item, session.mode, answer.value) };
    }
    return replaceRound({ ...round, answers });
  }
  if (!round.ids.includes(action.id)) return session;
  const answer = round.answers[action.id]!;
  let next: RecallAnswer;
  if (action.type === "input") next = {
    ...answer, value: action.value.slice(0, 200), result: null, selfConfirmed: false,
    hinted: answer.hinted || answer.selfConfirmed || (answer.result !== null && answer.result !== "correct" && answer.result !== "unanswered"),
  };
  else if (action.type === "reveal") next = { ...answer, hinted: true, revealed: true };
  else {
    if (session.mode !== "meaning" || answer.result !== "pending") return session;
    next = { ...answer, result: action.correct ? "correct" : "incorrect", selfConfirmed: true };
  }
  return replaceRound({ ...round, answers: { ...round.answers, [action.id]: next } });
}

export function summarizeRecall(session: RecallSession) {
  const round = session.rounds[session.mode];
  const answers = round.ids.map((id) => round.answers[id]!);
  return {
    total: answers.length,
    correct: answers.filter((answer) => answer.result === "correct" && !answer.hinted && !answer.selfConfirmed).length,
    selfConfirmed: answers.filter((answer) => answer.result === "correct" && !answer.hinted && answer.selfConfirmed).length,
    hinted: answers.filter((answer) => answer.hinted).length,
    review: answers.filter((answer) => answer.result === "incorrect" || answer.result === "accent").length,
    pending: answers.filter((answer) => answer.result === "pending").length,
    unanswered: answers.filter((answer) => answer.result === "unanswered").length,
    checked: answers.some((answer) => answer.result !== null),
    retry: answers.filter(recallNeedsRetry).length,
  };
}
