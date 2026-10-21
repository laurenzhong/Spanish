import { describe, expect, it } from "vitest";
import { checkRecall, nextUnansweredRecallId, reduceRecall, startRecall, summarizeRecall, type RecallItem } from "@/src/modules/lexicon-corpus/domain/vocabulary-recall";

const casa: RecallItem = { id: "casa", markKey: "casa", word: "casa", meanings: ["房子、家", "住所"] };
const word = (text: string): RecallItem => ({ ...casa, word: text });

describe("temporary vocabulary recall", () => {
  const navigationItems = [casa, { ...casa, id: "second" }, { ...casa, id: "third" }];

  it("advances after checking, skips filled answers and wraps to earlier blanks without grading them", () => {
    let session = startRecall(navigationItems, "word");
    session = reduceRecall(session, { type: "input", id: "second", value: "already filled" });
    session = reduceRecall(session, { type: "input", id: "casa", value: "wrong" });
    expect(nextUnansweredRecallId(session, "casa")).toBeNull();
    session = reduceRecall(session, { type: "check", id: "casa" });
    expect(nextUnansweredRecallId(session, "casa")).toBe("third");
    expect(session.rounds.word.answers.second!.result).toBeNull();
    session = reduceRecall(session, { type: "input", id: "casa", value: "  " });
    session = reduceRecall(session, { type: "input", id: "third", value: "casa" });
    session = reduceRecall(session, { type: "check", id: "third" });
    expect(nextUnansweredRecallId(session, "third")).toBe("casa");
  });

  it("stays on blank or pending answers, stale items and the last filled answer", () => {
    let session = startRecall(navigationItems, "meaning");
    session = reduceRecall(session, { type: "check", id: "casa" });
    expect(nextUnansweredRecallId(session, "casa")).toBeNull();
    session = reduceRecall(session, { type: "input", id: "casa", value: "居所" });
    session = reduceRecall(session, { type: "check", id: "casa" });
    expect(nextUnansweredRecallId(session, "casa")).toBeNull();
    session = reduceRecall(session, { type: "confirm", id: "casa", correct: true });
    expect(nextUnansweredRecallId(session, "casa")).toBe("second");
    expect(nextUnansweredRecallId(session, "stale")).toBeNull();
    for (const id of ["second", "third"]) session = reduceRecall(session, { type: "input", id, value: "家" });
    expect(nextUnansweredRecallId(session, "casa")).toBeNull();
  });

  it("navigates only the active mode and retry round", () => {
    let session = startRecall(navigationItems, "word");
    session = reduceRecall(session, { type: "input", id: "casa", value: "casa" });
    session = reduceRecall(session, { type: "input", id: "second", value: "wrong" });
    session = reduceRecall(session, { type: "check" });
    session = reduceRecall(session, { type: "retry" });
    session = reduceRecall(session, { type: "input", id: "second", value: "casa" });
    session = reduceRecall(session, { type: "check", id: "second" });
    expect(nextUnansweredRecallId(session, "second")).toBe("third");
    expect(nextUnansweredRecallId(session, "casa")).toBeNull();
    session = reduceRecall(session, { type: "switch", mode: "meaning" });
    session = reduceRecall(session, { type: "input", id: "second", value: "家" });
    session = reduceRecall(session, { type: "check", id: "second" });
    expect(nextUnansweredRecallId(session, "second")).toBe("third");
    session = reduceRecall(session, { type: "input", id: "third", value: "家" });
    expect(nextUnansweredRecallId(session, "second")).toBe("casa");
  });

  it("normalizes casing, surrounding whitespace and Unicode without folding ñ or ü", () => {
    expect(checkRecall(word("también"), "word", "  TAMBIÉN ")).toBe("correct");
    expect(checkRecall(word("también"), "word", "tambie\u0301n")).toBe("correct");
    expect(checkRecall(word("también"), "word", "tambien")).toBe("accent");
    expect(checkRecall(word("si"), "word", "sí")).toBe("accent");
    expect(checkRecall(word("año"), "word", "ano")).toBe("incorrect");
    expect(checkRecall(word("pingüino"), "word", "pinguino")).toBe("incorrect");
    expect(checkRecall(casa, "word", "casas")).toBe("incorrect");
    expect(checkRecall(casa, "word", " ")).toBe("unanswered");
  });

  it("accepts listed Chinese alternatives, but never guesses from substrings or one correct item", () => {
    for (const value of ["家", "住所", "房子", "家、住所", " 房子。 "]) expect(checkRecall(casa, "meaning", value)).toBe("correct");
    for (const value of ["家人", "房", "家、汽车", "不是房子", "居所"]) expect(checkRecall(casa, "meaning", value)).toBe("pending");
    expect(checkRecall(casa, "meaning", "")).toBe("unanswered");
    expect(checkRecall({ ...casa, meanings: ["银行（金融、储蓄机构）"] }, "meaning", "储蓄机构）")).toBe("pending");
  });

  it("freezes valid items, ignores missing meanings and does not mutate the caller", () => {
    const meanings = ["房子"];
    const session = startRecall([{ ...casa, meanings }, casa, { ...casa, id: "empty", meanings: [] }], "word");
    meanings[0] = "修改";
    expect(session.items).toHaveLength(1);
    expect(session.items[0]!.meanings).toEqual(["房子"]);
  });

  it("keeps both modes independent and does not grade until submission", () => {
    let session = startRecall([casa], "word");
    session = reduceRecall(session, { type: "input", id: "casa", value: "CASA" });
    expect(summarizeRecall(session).checked).toBe(false);
    session = reduceRecall(session, { type: "check" });
    expect(summarizeRecall(session).correct).toBe(1);
    session = reduceRecall(session, { type: "switch", mode: "meaning" });
    expect(session.rounds.meaning.answers.casa!.value).toBe("");
    session = reduceRecall(session, { type: "input", id: "casa", value: "家" });
    session = reduceRecall(session, { type: "check", id: "casa" });
    session = reduceRecall(session, { type: "switch", mode: "word" });
    expect(session.rounds.word.answers.casa!.value).toBe("CASA");
    expect(summarizeRecall(session).correct).toBe(1);
  });

  it("keeps hint and self-confirmation separate from independently matched success", () => {
    let session = startRecall([casa], "meaning");
    session = reduceRecall(session, { type: "input", id: "casa", value: "居所" });
    session = reduceRecall(session, { type: "check" });
    session = reduceRecall(session, { type: "confirm", id: "casa", correct: true });
    session = reduceRecall(session, { type: "check" });
    expect(summarizeRecall(session)).toMatchObject({ correct: 0, selfConfirmed: 1 });
    session = reduceRecall(session, { type: "input", id: "casa", value: "家" });
    session = reduceRecall(session, { type: "reveal", id: "casa" });
    session = reduceRecall(session, { type: "check" });
    expect(summarizeRecall(session)).toMatchObject({ correct: 0, hinted: 1, retry: 1 });
    session = reduceRecall(session, { type: "retry" });
    expect(session.rounds.meaning.answers.casa).toMatchObject({ value: "", result: null, hinted: false });
    expect(session.rounds.word.answers.casa!.value).toBe("");
  });

  it("retries only current-mode mistakes, pending/empty answers and prompted successes", () => {
    const second = { ...casa, id: "other", word: "también" };
    let session = startRecall([casa, second], "word");
    session = reduceRecall(session, { type: "input", id: "casa", value: "casa" });
    session = reduceRecall(session, { type: "check" });
    expect(summarizeRecall(session)).toMatchObject({ correct: 1, unanswered: 1, retry: 1 });
    session = reduceRecall(session, { type: "retry" });
    expect(session.rounds.word.ids).toEqual(["other"]);
    expect(session.rounds.meaning.ids).toEqual(["casa", "other"]);
  });

  it("ignores stale item actions and illegal confirmations, and clears edited results", () => {
    let session = startRecall([casa], "word");
    expect(reduceRecall(session, { type: "input", id: "stale", value: "casa" })).toBe(session);
    expect(reduceRecall(session, { type: "confirm", id: "casa", correct: true })).toBe(session);
    session = reduceRecall(session, { type: "check" });
    session = reduceRecall(session, { type: "input", id: "casa", value: "x".repeat(250) });
    expect(session.rounds.word.answers.casa!.value).toHaveLength(200);
    expect(session.rounds.word.answers.casa!.result).toBeNull();
  });
});
