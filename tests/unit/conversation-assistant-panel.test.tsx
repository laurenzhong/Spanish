import { readAloudFake as speech } from "../helpers/read-aloud-fake";
vi.mock("@/src/modules/providers/tts/read-aloud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/modules/providers/tts/read-aloud")>();
  const { readAloudFake } = await import("../helpers/read-aloud-fake");
  return { ...actual, createReadAloud: readAloudFake.create };
});

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationAssistant, type ConversationAssistantProps } from "@/src/modules/conversation/ui/conversation-assistant";

type RecordedRequest = Readonly<{
  url: string;
  body: Record<string, unknown>;
  signal: AbortSignal | null;
}>;

const answer = "这两句都可以用来拒绝邀请，同时给出替代时间。";
const suggestions = [
  { spanish: "No es que no quiera ir, es que hoy estoy un poco cansado. ¿Quedamos otro día?", chinese: "不是不想去，只是今天有点累。改天再约好吗？" },
  { spanish: "Me encantaría, pero hoy necesito descansar. ¿Te parece mañana?", chinese: "我很想去，但今天需要休息。明天可以吗？" },
];

let requests: RecordedRequest[] = [];
let respond: (request: RecordedRequest) => Response | Promise<Response>;

function assistantResponse(request: RecordedRequest, overrides: Record<string, unknown> = {}) {
  return Response.json({
    apiVersion: "v1",
    data: {
      attemptId: request.body.attemptId,
      intent: request.body.intent,
      answer,
      suggestions: [],
      corrections: [],
      structure: [],
      correctedSentence: null,
      ...overrides,
    },
  });
}

function renderPanel(overrides: Partial<ConversationAssistantProps> = {}) {
  const props: ConversationAssistantProps = {
    characterKey: "lucia",
    characterVersion: 1,
    characterName: "Lucía Martín",
    open: true,
    draft: "",
    onClose: vi.fn(),
    onApply: vi.fn(),
    onFocusInput: vi.fn(),
    ...overrides,
  };
  const view = render(<ConversationAssistant {...props} />);
  return { ...view, props };
}

const note = () => screen.getByRole("textbox", { name: "向 AI 助手提问" });
const dialog = () => screen.getByRole("dialog", { name: "Lucía Martín 的 AI 助手" });

beforeEach(() => {
  speech.reset();
  requests = [];
  respond = (request) => assistantResponse(request);
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (!url.endsWith("/assistant")) throw new Error(`unexpected fetch ${url}`);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const request: RecordedRequest = { url, body, signal: init?.signal ?? null };
    requests.push(request);
    return respond(request);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("conversation assistant panel", () => {
  it("exposes a labelled dialog with the three learning shortcuts", () => {
    renderPanel();

    expect(dialog()).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI 助手" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭 AI 助手" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "帮我回复" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查语法" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "分析句子成分" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "问一下" })).toBeInTheDocument();
    // The owner asked for a compact panel: no header description and no visible
    // composer label; the placeholder and icon carry the affordance instead.
    expect(screen.queryByText("问怎么回复、检查语法，或分析句子成分。")).not.toBeInTheDocument();
    expect(screen.queryByText("补充说明或提问")).not.toBeInTheDocument();
    expect(screen.getByText(/不知道怎么回复、想检查一句西语/)).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it("keeps the send icon inside the chat-style composer field", () => {
    renderPanel();

    const form = screen.getByRole("form", { name: "向 AI 助手提问" });
    const textarea = within(form).getByRole("textbox", { name: "向 AI 助手提问" });
    const field = textarea.closest(".conversation-assistant__field");
    expect(field).not.toBeNull();
    expect(within(field as HTMLElement).getByRole("textbox")).toBe(textarea);

    const ask = within(field as HTMLElement).getByRole("button", { name: "问一下" });
    expect(ask).toHaveAttribute("type", "submit");
    expect(ask.parentElement).toBe(field);
    expect(ask.querySelector("svg")).not.toBeNull();
  });

  it("sends a reply request with the panel note as its optional question", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(note(), "想拒绝她的邀请，怎么回？");
    await user.click(screen.getByRole("button", { name: "帮我回复" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].url).toBe("/api/v1/conversations/lucia/assistant");
    expect(Object.keys(requests[0].body).sort()).toEqual(["attemptId", "characterVersion", "intent", "question"]);
    expect(requests[0].body).toMatchObject({
      intent: "reply",
      characterVersion: 1,
      question: "想拒绝她的邀请，怎么回？",
      attemptId: expect.any(String),
    });
    expect(await screen.findByText(answer)).toBeInTheDocument();
  });

  it("rejects an over-long reply note locally instead of sending a doomed request", async () => {
    const user = userEvent.setup();
    renderPanel();

    fireEvent.change(note(), { target: { value: "a".repeat(801) } });
    await user.click(screen.getByRole("button", { name: "帮我回复" }));

    expect(screen.getByText("问题请控制在 800 字以内。")).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it("checks grammar with the panel note first and falls back to the composer draft", async () => {
    const user = userEvent.setup();
    renderPanel({ draft: "  Yo estoy cansado hoy.  " });

    await user.click(screen.getByRole("button", { name: "检查语法" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toMatchObject({ intent: "grammar", targetText: "Yo estoy cansado hoy." });
    expect(requests[0].body).not.toHaveProperty("question");

    await user.type(note(), "Yo es cansado.");
    await user.click(screen.getByRole("button", { name: "检查语法" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].body).toMatchObject({ intent: "grammar", targetText: "Yo es cansado." });
  });

  it("shows a local notice instead of a request when grammar has nothing to check", async () => {
    const user = userEvent.setup();
    renderPanel({ draft: "   " });

    await user.click(screen.getByRole("button", { name: "检查语法" }));

    expect(screen.getByText("先在输入框写下要检查的句子。")).toBeInTheDocument();
    expect(requests).toHaveLength(0);
    await waitFor(() => expect(note()).toHaveFocus());
  });

  it("analyses the character's last sentence when no sentence is typed", async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.getByText(/分析句子成分时不填写内容，会分析对方最后一句/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "分析句子成分" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(Object.keys(requests[0].body).sort()).toEqual(["attemptId", "characterVersion", "intent"]);
    expect(requests[0].body).toMatchObject({ intent: "structure" });
    expect(requests[0].body).not.toHaveProperty("targetText");
  });

  it("analyses the typed sentence when the learner provides one", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(note(), "Me gusta el café de Madrid.");
    await user.click(screen.getByRole("button", { name: "分析句子成分" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toMatchObject({ intent: "structure", targetText: "Me gusta el café de Madrid." });
  });

  it("asks a free-form question from the question form", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(note(), "虚拟式和条件式有什么区别？");
    await user.click(screen.getByRole("button", { name: "问一下" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(Object.keys(requests[0].body).sort()).toEqual(["attemptId", "characterVersion", "intent", "question"]);
    expect(requests[0].body).toMatchObject({ intent: "question", question: "虚拟式和条件式有什么区别？" });
  });

  it("does not send an empty free-form question", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "问一下" }));

    expect(screen.getByText("请先写下你想问的问题。")).toBeInTheDocument();
    expect(requests).toHaveLength(0);
    await waitFor(() => expect(note()).toHaveFocus());
  });

  it("clears the free-form question from the composer once it is sent", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(note(), "虚拟式和条件式有什么区别？");
    await user.click(screen.getByRole("button", { name: "问一下" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toMatchObject({ intent: "question", question: "虚拟式和条件式有什么区别？" });
    // The textarea must not keep the sent question: leaving it there reads as an
    // unsent message even though the request already went out.
    expect(note()).toHaveValue("");
    // The transcript keeps the question, so clearing the composer loses nothing.
    expect(screen.getByText(/虚拟式和条件式有什么区别/)).toBeInTheDocument();
    expect(await screen.findByText(answer)).toBeInTheDocument();
  });

  it("sends with Enter and keeps Shift+Enter for a line break", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(note(), "第一行{Shift>}{Enter}{/Shift}第二行");
    expect(note()).toHaveValue("第一行\n第二行");
    expect(requests).toHaveLength(0);

    await user.type(note(), "{Enter}");
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toMatchObject({ intent: "question", question: "第一行\n第二行" });
    expect(note()).toHaveValue("");
  });

  it("does not send on Enter while a Chinese IME composition is active", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(note(), "虚拟式");
    fireEvent.keyDown(note(), { key: "Enter", isComposing: true });
    // Safari reports the composition-confirming Enter with keyCode 229 and may
    // already have cleared `isComposing`, so both signals must be ignored.
    fireEvent.keyDown(note(), { key: "Enter", keyCode: 229 });

    expect(requests).toHaveLength(0);
    expect(note()).toHaveValue("虚拟式");
  });

  it("does not send or clear a second question while the first one is pending", async () => {
    const user = userEvent.setup();
    let release!: (response: Response) => void;
    respond = () => new Promise<Response>((resolve) => { release = resolve; });
    renderPanel();

    await user.type(note(), "第一个问题{Enter}");
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(note()).toHaveValue("");

    // The textarea stays editable while thinking; Enter must neither dispatch a
    // second request nor wipe the question the learner is preparing.
    await user.type(note(), "第二个问题{Enter}");
    expect(requests).toHaveLength(1);
    expect(note()).toHaveValue("第二个问题");

    await act(async () => release(assistantResponse(requests[0])));
    expect(await screen.findByText(answer)).toBeInTheDocument();
  });

  it("renders reply suggestions and applies one to the draft without sending", async () => {
    const user = userEvent.setup();
    respond = (request) => assistantResponse(request, { suggestions });
    const { props } = renderPanel();

    await user.click(screen.getByRole("button", { name: "帮我回复" }));

    expect(await screen.findByText(suggestions[0].spanish)).toHaveAttribute("lang", "es");
    expect(screen.getByText(suggestions[0].chinese)).toBeInTheDocument();
    expect(screen.getByText(suggestions[1].spanish)).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "填入输入框" })[0]);
    expect(props.onApply).toHaveBeenCalledWith(suggestions[0].spanish);
    expect(props.onFocusInput).toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    expect(requests.every((request) => !request.url.includes("/stream"))).toBe(true);
  });

  it("plays and stops a suggestion through the shared read-aloud adapter", async () => {
    const user = userEvent.setup();
    respond = (request) => assistantResponse(request, { suggestions });
    renderPanel();

    await user.click(screen.getByRole("button", { name: "帮我回复" }));
    await screen.findByText(suggestions[0].spanish);

    await user.click(screen.getAllByRole("button", { name: "朗读这条建议" })[0]);
    await waitFor(() => expect(speech.speak).toHaveBeenCalledTimes(1));
    expect(speech.attempts[0]).toMatchObject({ text: suggestions[0].spanish, lang: "es-ES" });
    expect(screen.getAllByRole("button", { name: "停止朗读这条建议" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "停止朗读这条建议" }));
    await waitFor(() => expect(speech.cancel).toHaveBeenCalled());
    expect(screen.getAllByRole("button", { name: "朗读这条建议" })).toHaveLength(suggestions.length);
  });

  it("renders the corrected sentence and every grammar correction", async () => {
    const user = userEvent.setup();
    const corrections = [
      { original: "Yo es cansado.", corrected: "Yo estoy cansado.", explanation: "estar 用来描述状态。" },
      { original: "Ayer voy al café.", corrected: "Ayer fui al café.", explanation: "过去时间用简单过去时。" },
    ];
    respond = (request) => assistantResponse(request, { correctedSentence: "Yo estoy cansado. Ayer fui al café.", corrections });
    const { props } = renderPanel({ draft: "Yo es cansado. Ayer voy al café." });

    await user.click(screen.getByRole("button", { name: "检查语法" }));

    const correctionsList = await screen.findByRole("list", { name: "语法修正" });
    expect(within(correctionsList).getByText("Yo es cansado.")).toBeInTheDocument();
    expect(within(correctionsList).getByText("Yo estoy cansado.")).toBeInTheDocument();
    expect(within(correctionsList).getByText("estar 用来描述状态。")).toBeInTheDocument();
    expect(screen.getByText("修正后的句子")).toBeInTheDocument();
    expect(screen.getByText("Yo estoy cansado. Ayer fui al café.")).toHaveAttribute("lang", "es");

    await user.click(screen.getByRole("button", { name: "使用修正句" }));
    expect(props.onApply).toHaveBeenCalledWith("Yo estoy cansado. Ayer fui al café.");
    expect(props.onFocusInput).toHaveBeenCalled();
  });

  it("renders sentence-constituent analysis", async () => {
    const user = userEvent.setup();
    const structure = [
      { fragment: "Me", role: "间接宾语", explanation: "表示喜欢的主体是说话人。" },
      { fragment: "gusta el café de Madrid", role: "谓语和主语", explanation: "主语是 el café de Madrid。" },
    ];
    respond = (request) => assistantResponse(request, { structure });
    renderPanel();

    await user.click(screen.getByRole("button", { name: "分析句子成分" }));

    const structureList = await screen.findByRole("list", { name: "句子成分" });
    expect(within(structureList).getByText("Me")).toHaveAttribute("lang", "es");
    expect(within(structureList).getByText("间接宾语")).toBeInTheDocument();
    expect(within(structureList).getByText("表示喜欢的主体是说话人。")).toBeInTheDocument();
    expect(within(structureList).getByText("谓语和主语")).toBeInTheDocument();
  });

  it("renders only the answer when the provider omits the optional blocks", async () => {
    const user = userEvent.setup();
    respond = (request) => Response.json({
      apiVersion: "v1",
      data: { attemptId: request.body.attemptId, intent: request.body.intent, answer },
    });
    renderPanel();

    await user.click(screen.getByRole("button", { name: "帮我回复" }));

    expect(await screen.findByText(answer)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "回复建议" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "语法修正" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "句子成分" })).not.toBeInTheDocument();
  });

  it("shows an inline error and retries the same request with a new attempt", async () => {
    const user = userEvent.setup();
    let calls = 0;
    respond = (request) => {
      calls += 1;
      return calls === 1
        ? Response.json({ error: { code: "provider-unavailable" } }, { status: 503 })
        : assistantResponse(request);
    };
    renderPanel();

    await user.type(note(), "怎么礼貌地拒绝？");
    await user.click(screen.getByRole("button", { name: "帮我回复" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("AI 助手暂时不可用，请稍后再试。");
    await user.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByText(answer)).toBeInTheDocument();
    expect(requests).toHaveLength(2);
    expect(requests[1].body).toMatchObject({ intent: "reply", question: "怎么礼貌地拒绝？" });
    expect(requests[0].body.attemptId).not.toBe(requests[1].body.attemptId);
  });

  it("rejects a response whose attempt or intent does not match the request", async () => {
    const user = userEvent.setup();
    respond = (request) => Response.json({
      apiVersion: "v1",
      data: {
        attemptId: "another-attempt",
        intent: request.body.intent,
        answer,
        suggestions: [],
        corrections: [],
        structure: [],
        correctedSentence: null,
      },
    });
    renderPanel();

    await user.click(screen.getByRole("button", { name: "帮我回复" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("AI 助手的回答无法解析，请重试。");
    expect(screen.queryByText(answer)).not.toBeInTheDocument();
  });

  it("disables the actions and shows a pending status while thinking", async () => {
    const user = userEvent.setup();
    let release!: (response: Response) => void;
    respond = () => new Promise<Response>((resolve) => { release = resolve; });
    renderPanel();

    await user.click(screen.getByRole("button", { name: "帮我回复" }));

    expect(screen.getByText("正在思考…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "帮我回复" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "检查语法" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "分析句子成分" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "问一下" })).toBeDisabled();

    await act(async () => release(assistantResponse(requests[0])));
    expect(await screen.findByText(answer)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "帮我回复" })).toBeEnabled();
  });

  it("aborts the in-flight request and stops read-aloud when the panel closes", async () => {
    const user = userEvent.setup();
    respond = (request) => assistantResponse(request, { suggestions });
    const { props, rerender } = renderPanel();

    await user.click(screen.getByRole("button", { name: "帮我回复" }));
    await screen.findByText(suggestions[0].spanish);
    await user.click(screen.getAllByRole("button", { name: "朗读这条建议" })[0]);
    await waitFor(() => expect(speech.speak).toHaveBeenCalledTimes(1));

    respond = () => new Promise<Response>(() => undefined);
    await user.click(screen.getByRole("button", { name: "帮我回复" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    const inFlight = requests[1].signal;
    expect(inFlight?.aborted).toBe(false);
    const cancelsBeforeClose = speech.cancel.mock.calls.length;

    rerender(<ConversationAssistant {...props} open={false} />);

    await waitFor(() => expect(inFlight?.aborted).toBe(true));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(speech.cancel.mock.calls.length).toBeGreaterThan(cancelsBeforeClose));

    // The cancelled attempt must not look like it is still thinking on reopen.
    rerender(<ConversationAssistant {...props} open />);
    expect(await screen.findByText("本次请求已取消。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("ignores a stale response from an attempt cancelled before it answered", async () => {
    const user = userEvent.setup();
    let releaseOld!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => { releaseOld = resolve; });
    let calls = 0;
    respond = (request) => {
      calls += 1;
      return calls === 1 ? oldResponse : assistantResponse(request);
    };
    const { props, rerender } = renderPanel();

    await user.click(screen.getByRole("button", { name: "帮我回复" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    rerender(<ConversationAssistant {...props} open={false} />);
    await waitFor(() => expect(requests[0].signal?.aborted).toBe(true));
    rerender(<ConversationAssistant {...props} open />);
    await user.click(screen.getByRole("button", { name: "帮我回复" }));
    expect(await screen.findByText(answer)).toBeInTheDocument();
    await waitFor(() => expect(requests).toHaveLength(2));

    await act(async () => releaseOld(assistantResponse(requests[0], { answer: "过期的助手回答" })));
    expect(screen.queryByText("过期的助手回答")).not.toBeInTheDocument();
    expect(screen.getByText(answer)).toBeInTheDocument();
  });

  it("keeps the transcript across close and reopen but drops it for another character", async () => {
    const user = userEvent.setup();
    respond = (request) => assistantResponse(request, { suggestions });
    const { props, rerender } = renderPanel();

    await user.click(screen.getByRole("button", { name: "帮我回复" }));
    expect(await screen.findByText(suggestions[0].spanish)).toBeInTheDocument();
    rerender(<ConversationAssistant {...props} open={false} />);
    rerender(<ConversationAssistant {...props} open />);
    expect(screen.getByText(suggestions[0].spanish)).toBeInTheDocument();
    expect(requests).toHaveLength(1);

    // The chat thread remounts the panel with a new key when the character
    // changes, which is what drops the transient transcript.
    rerender(<ConversationAssistant {...props} characterKey="mateo" characterName="Mateo Ruiz" key="mateo:1" open />);
    expect(screen.queryByText(suggestions[0].spanish)).not.toBeInTheDocument();
    expect(screen.getByText(/不知道怎么回复、想检查一句西语/)).toBeInTheDocument();
  });

  it("reports a local timeout after the 45 second deadline", async () => {
    vi.useFakeTimers();
    try {
      respond = () => new Promise<Response>(() => undefined);
      renderPanel();

      fireEvent.click(screen.getByRole("button", { name: "帮我回复" }));
      expect(requests).toHaveLength(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });

      expect(screen.getByText("请求超时，请重试。")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "帮我回复" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
