import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeTrainingLoop } from "@/src/modules/training/ui/fake-training-loop";
import { SpeechCapabilityError } from "@/src/modules/providers/speech";

describe("FakeTrainingLoop", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores a stable checkpoint without replaying input playback", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<FakeTrainingLoop userId="checkpoint-user" />);

    await screen.findByText("轮到你了");
    expect(screen.getByTestId("training-loop")).toHaveAttribute(
      "data-hydrated",
      "true",
    );
    expect(
      JSON.parse(
        window.localStorage.getItem(
          "spanish.training.checkpoint.v1:checkpoint-user",
        ) ?? "{}",
      ),
    ).toMatchObject({ contentBundleKey: "alpha.core", contentBundleVersion: 2 });
    unmount();
    cleanup();
    render(<FakeTrainingLoop userId="checkpoint-user" />);

    expect(await screen.findByText("已恢复上次稳定进度")).toBeInTheDocument();
    expect(screen.getByText("轮到你了")).toBeInTheDocument();
    expect(screen.queryByText("先听一遍")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "用文字回答" }));
    expect(screen.getByLabelText("写下你的回应")).toBeInTheDocument();
  });

  it("loads the first expression and reaches output selection", async () => {
    render(<FakeTrainingLoop />);

    expect(screen.getByTestId("training-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("training-timeline")).toHaveTextContent("听懂情境");
    expect(screen.getByTestId("training-timeline")).toHaveTextContent("自己表达");
    expect(screen.getByTestId("training-timeline")).toHaveTextContent("换一种说法");
    expect(screen.getByTestId("training-detail-disclosure")).not.toHaveAttribute("open");
    expect(screen.queryByTestId("training-detail-rail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("training-hint-content")).not.toBeInTheDocument();
    expect(screen.getByText("先听一遍")).toBeInTheDocument();
    expect(await screen.findByText("轮到你了")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "提示" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "用文字回答" })).toBeInTheDocument();
  });

  it("replays and stops the current Spanish pronunciation from the audio control", async () => {
    const user = userEvent.setup();
    const selectedVoice = {
      name: "Microsoft Sofia Online (Natural) - Spanish (Bolivia)",
      lang: "es-BO",
      voiceURI: "sofia-es",
    } as SpeechSynthesisVoice;
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => [selectedVoice],
    });
    window.localStorage.setItem("sueno-reader-tts-voice:es", selectedVoice.voiceURI);
    let finishReplay: () => void = () => undefined;
    const speak = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishReplay = resolve;
          }),
      );
    const stop = vi.fn(() => finishReplay());
    const audio = {
      recorder: {
        start: async () => undefined,
        stop: async () => ({ blob: new Blob(), metadata: { mimeType: "audio/webm", sizeBytes: 0 } }),
        cancel: async () => undefined,
      },
      textToSpeech: {
        isSupported: true,
        speak,
        stop,
      },
    };

    render(<FakeTrainingLoop audio={audio} />);
    await screen.findByText("轮到你了");
    speak.mockClear();
    stop.mockClear();

    await user.click(screen.getByRole("button", { name: "播放发音" }));

    expect(speak).toHaveBeenCalledWith("¿Cómo va todo?", {
      languageTag: "es-ES",
      rate: 0.9,
      voiceName: selectedVoice.name,
      voiceURI: selectedVoice.voiceURI,
    });
    await user.click(screen.getByRole("button", { name: "停止发音" }));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("starts with the expression for the selected communication goal", async () => {
    render(<FakeTrainingLoop goalKey="communication.repair.ask-repeat" />);

    expect(screen.getByText("¿Podría repetirlo?")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "第 1 句，共 1 句" })).toBeInTheDocument();
    expect(await screen.findByText("轮到你了")).toBeInTheDocument();
  });

  it("does not restore a checkpoint from another goal", async () => {
    window.localStorage.setItem(
      "spanish.training.checkpoint.v1:goal-user",
      JSON.stringify({
        schemaVersion: 1,
        contentBundleKey: "alpha.core",
        contentBundleVersion: 1,
        contentKey: "start.como-va-todo",
        goalKey: "communication.start.check-in",
        status: "awaiting-output",
        outputMode: "speech",
        hintLevel: 0,
        generationId: 2,
        transcript: null,
        evaluation: null,
        error: null,
      }),
    );

    render(<FakeTrainingLoop goalKey="communication.repair.ask-repeat" userId="goal-user" />);

    expect(screen.getByText("¿Podría repetirlo?")).toBeInTheDocument();
    expect(await screen.findByText("轮到你了")).toBeInTheDocument();
    expect(screen.queryByText("已恢复上次稳定进度")).not.toBeInTheDocument();
  });

  it("accepts a natural typed alternative and starts the next expression after completion", async () => {
    const user = userEvent.setup();
    render(<FakeTrainingLoop />);

    await screen.findByText("轮到你了");
    await user.click(screen.getByRole("button", { name: "用文字回答" }));
    expect(screen.getByLabelText("写下你的回应")).toHaveFocus();
    await user.click(screen.getByText("练习说明"));
    expect(screen.getByTestId("training-detail-disclosure")).toHaveAttribute("open");
    expect(screen.getByTestId("training-detail-disclosure")).toHaveTextContent("文字回答");
    expect(screen.getByTestId("training-evidence-summary")).toHaveTextContent("文字路径");
    await user.type(screen.getByLabelText("写下你的回应"), "¿Qué tal todo?");
    await user.click(screen.getByRole("button", { name: "提交文字回答" }));

    expect(await screen.findByText("正在给出这轮反馈……")).toBeInTheDocument();
    expect(await screen.findByText("对方可以接住你的意思")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "完成这句" }));
    await user.click(screen.getByRole("button", { name: "下一句" }));

    expect(await screen.findByText("¿Cómo se llama?")).toBeInTheDocument();
    expect(screen.getByText("先听一遍")).toBeInTheDocument();
  });

  it("falls back to typing when microphone permission is denied", async () => {
    const user = userEvent.setup();
    const audio = {
      recorder: {
        start: () =>
          Promise.reject(
            new SpeechCapabilityError(
              "microphone-permission-denied",
              "denied",
            ),
          ),
        stop: async () => ({ blob: new Blob(), metadata: { mimeType: "audio/webm", sizeBytes: 0 } }),
        cancel: async () => undefined,
      },
      textToSpeech: {
        isSupported: false,
        speak: async () => undefined,
        stop: () => undefined,
      },
    };
    render(<FakeTrainingLoop audio={audio} />);

    await screen.findByText("轮到你了");
    await user.click(screen.getByRole("button", { name: "开始录音" }));

    expect(await screen.findByText("麦克风暂时不可用，已切换为文字回答。")).toBeInTheDocument();
    expect(screen.getByLabelText("写下你的回应")).toBeInTheDocument();
    expect(screen.getByTestId("training-loop")).toHaveAttribute(
      "data-status",
      "awaiting-output",
    );
  });

  it("keeps technical recording failures out of evidence", async () => {
    const user = userEvent.setup();
    const audio = {
      recorder: {
        start: async () => undefined,
        stop: () => Promise.reject(new SpeechCapabilityError("recording-failed", "failed")),
        cancel: async () => undefined,
      },
      textToSpeech: {
        isSupported: false,
        speak: async () => undefined,
        stop: () => undefined,
      },
    };
    render(<FakeTrainingLoop audio={audio} />);

    await screen.findByText("轮到你了");
    await user.click(screen.getByRole("button", { name: "开始录音" }));
    await user.click(await screen.findByRole("button", { name: "完成录音" }));

    expect(await screen.findByText("这次技术步骤没有完成")).toBeInTheDocument();
    expect(screen.getByTestId("training-evidence-summary")).toHaveTextContent("无负面能力记录");
  });
});
