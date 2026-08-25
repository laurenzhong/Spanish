"use client";

import {
  useEffect,
  useMemo,
  useReducer,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import contentBundle from "@/content/bundles/alpha-core-v1.json";
import {
  createTrainingState,
  transition,
  type TrainingEvent,
  type TrainingState,
  type TrainingTransition,
} from "@/src/modules/training/domain";
import { createFakeEvaluator } from "@/src/modules/training/fakes";
import {
  checkpointFromState,
  createBrowserTrainingCheckpointStore,
  restoreTrainingCheckpoint,
  serializeTrainingCheckpoint,
  type TrainingCheckpointStore,
} from "@/src/modules/training/checkpoints";
import {
  createBrowserAudioRecorder,
  speechCapabilityErrorCode,
  type BrowserAudioRecorder,
} from "@/src/modules/providers/speech";
import {
  createBrowserTextToSpeech,
  type BrowserTextToSpeech,
} from "@/src/modules/providers/tts";
import type { LearningActivityRecorder } from "@/src/modules/profile/activity";

const practiceExpressions = contentBundle.expressions.slice(0, 4);
const evaluator = createFakeEvaluator();

type LoopState = Readonly<{
  expressionIndex: number;
  transition: TrainingTransition;
}>;

type LoopEvent =
  | TrainingEvent
  | Readonly<{ type: "load-expression"; expressionIndex: number }>
  | Readonly<{
      type: "restore-checkpoint";
      expressionIndex: number;
      state: TrainingState;
    }>;

export type TrainingAudioCapabilities = Readonly<{
  recorder: Pick<BrowserAudioRecorder, "start" | "stop" | "cancel">;
  textToSpeech: Pick<BrowserTextToSpeech, "isSupported" | "speak" | "stop">;
}>;

function startExpression(expressionIndex: number): LoopState {
  const expression = practiceExpressions[expressionIndex] ?? practiceExpressions[0];
  const loaded = transition(createTrainingState(), {
    type: "content-loaded",
    contentKey: expression.stableKey,
    goalKey: expression.goalKey,
  });

  return { expressionIndex, transition: loaded };
}

function loopReducer(state: LoopState, event: LoopEvent): LoopState {
  if (event.type === "load-expression") {
    return startExpression(event.expressionIndex);
  }

  if (event.type === "restore-checkpoint") {
    return {
      expressionIndex: event.expressionIndex,
      transition: { state: event.state, effects: [] },
    };
  }

  return {
    ...state,
    transition: transition(state.transition.state, event),
  };
}

function initialLoopState(): LoopState {
  return startExpression(0);
}

function statusLabel(state: TrainingState): string {
  switch (state.status) {
    case "presenting-input":
      return "先听一遍";
    case "awaiting-output":
      return "轮到你了";
    case "recording":
      return "正在记录你的回答";
    case "transcribing":
      return "正在整理回答";
    case "evaluating":
      return "正在看这句话完成了什么";
    case "showing-feedback":
      return "这一轮完成了";
    case "transitioning":
      return "准备下一种说法";
    case "completed":
      return "这句已完成";
    case "recoverable-error":
      return "这次没有顺利完成";
    case "loading-context":
      return "正在准备内容";
  }
}

function formatRecordingTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function useTrainingEffects(
  current: LoopState,
  dispatch: Dispatch<LoopEvent>,
  store: TrainingCheckpointStore | null,
  enabled: boolean,
  audio: TrainingAudioCapabilities,
  setCapabilityNotice: Dispatch<SetStateAction<string | null>>,
) {
  useEffect(() => {
    if (!enabled) return;
    const cleanups: Array<() => void> = [];
    let active = true;
    let recordingStop: Promise<boolean> | null = null;

    for (const effect of current.transition.effects) {
      if (effect.type === "save-breakpoint" && store) {
        const checkpoint = checkpointFromState(current.transition.state);
        if (checkpoint) {
          void store.write(serializeTrainingCheckpoint(checkpoint));
        }
      }

      if (effect.type === "play-input") {
        if (!audio.textToSpeech.isSupported) {
          setCapabilityNotice(
            "浏览器暂不支持朗读，已保留文字输入。你可以直接阅读这句内容。",
          );
          const timer = window.setTimeout(
            () => active && dispatch({ type: "input-playback-completed" }),
            220,
          );
          cleanups.push(() => window.clearTimeout(timer));
        } else {
          const expressionText =
            practiceExpressions.find(
              (expression) =>
                expression.stableKey === current.transition.state.contentKey,
            )?.text ?? "";
          void audio.textToSpeech
            .speak(expressionText, { languageTag: "es-ES", rate: 0.9 })
            .then(() => {
              if (active) dispatch({ type: "input-playback-completed" });
            })
            .catch((error: unknown) => {
              if (active) {
                dispatch({
                  type: "input-playback-failed",
                  errorCode: speechCapabilityErrorCode(error, "tts-failed"),
                });
              }
            });
          cleanups.push(() => audio.textToSpeech.stop());
        }
      }

      if (effect.type === "start-recording") {
        void audio.recorder.start().catch((error: unknown) => {
          if (!active) return;
          setCapabilityNotice("麦克风暂时不可用，已切换为文字回答。");
          dispatch({
            type: "recording-start-failed",
            generationId: effect.generationId,
            errorCode: speechCapabilityErrorCode(error, "recording-failed"),
          });
        });
      }

      if (effect.type === "stop-recording") {
        recordingStop = audio.recorder
          .stop()
          .then(() => true)
          .catch((error: unknown) => {
            if (active && current.transition.state.status === "transcribing") {
              dispatch({
                type: "transcription-failed",
                generationId: effect.generationId,
                errorCode: speechCapabilityErrorCode(error, "recording-failed"),
              });
            }
            return false;
          });
      }

      if (effect.type === "prepare-variant") {
        const timer = window.setTimeout(
          () => dispatch({ type: "variant-ready" }),
          180,
        );
        cleanups.push(() => window.clearTimeout(timer));
      }

      if (effect.type === "transcribe") {
        const simulatedTranscript =
          practiceExpressions.find(
            (expression) =>
              expression.stableKey === current.transition.state.contentKey,
          )?.text ?? "";
        void (recordingStop ?? Promise.resolve(true)).then((success) => {
          if (!active || !success) return;
          const timer = window.setTimeout(
            () =>
              active &&
              dispatch({
                type: "transcription-succeeded",
                generationId: effect.generationId,
                transcript: simulatedTranscript,
                confidence: 0.96,
              }),
            180,
          );
          cleanups.push(() => window.clearTimeout(timer));
        });
      }

      if (effect.type === "evaluate") {
        const controller = new AbortController();
        const transcript = current.transition.state.transcript ?? "";
        const expressionKey = current.transition.state.contentKey ?? "";
        void evaluator
          .evaluate(
            {
              expressionKey,
              generationId: effect.generationId,
              outputMode: effect.outputMode,
              text: transcript,
            },
            controller.signal,
          )
          .then((result) => dispatch(result))
          .catch((error: unknown) => {
            if (error instanceof DOMException && error.name === "AbortError") return;
            dispatch({
              type: "evaluation-failed",
              generationId: effect.generationId,
              errorCode: "fake-evaluator-failed",
            });
          });
        cleanups.push(() => controller.abort());
      }
    }

    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [audio, current, dispatch, enabled, setCapabilityNotice, store]);
}

type FakeTrainingLoopProps = Readonly<{
  activityRecorder?: LearningActivityRecorder;
  userId?: string;
  audio?: TrainingAudioCapabilities;
}>;

export function FakeTrainingLoop({
  activityRecorder,
  userId = "local-user",
  audio: providedAudio,
}: FakeTrainingLoopProps) {
  const [current, dispatch] = useReducer(loopReducer, undefined, initialLoopState);
  const [draft, setDraft] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [restored, setRestored] = useState(false);
  const [capabilityNotice, setCapabilityNotice] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const state = current.transition.state;
  const checkpointStore = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : createBrowserTrainingCheckpointStore(userId),
    [userId],
  );
  const audio = useMemo<TrainingAudioCapabilities>(
    () =>
      providedAudio ?? {
        recorder: createBrowserAudioRecorder(),
        textToSpeech: createBrowserTextToSpeech(),
      },
    [providedAudio],
  );
  const expression = practiceExpressions[current.expressionIndex] ?? practiceExpressions[0];
  const isProcessing =
    state.status === "transcribing" || state.status === "evaluating";

  useEffect(() => {
    if (!hydrated || !activityRecorder) return;
    activityRecorder.start();
    return () => activityRecorder.stop();
  }, [activityRecorder, hydrated]);

  useEffect(() => {
    if (state.status !== "recording") return;

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [state.status]);

  useEffect(() => {
    if (!checkpointStore) return;
    let active = true;
    void restoreTrainingCheckpoint(checkpointStore, {
      contentBundleKey: "alpha.core",
      contentBundleVersion: 1,
    }).then((restoredState) => {
      if (!active) return;
      if (restoredState) {
        const expressionIndex = Math.max(
          0,
          practiceExpressions.findIndex(
            (expression) => expression.stableKey === restoredState.contentKey,
          ),
        );
        dispatch({
          type: "restore-checkpoint",
          expressionIndex,
          state: restoredState,
        });
        setRestored(true);
      }
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, [checkpointStore]);

  useTrainingEffects(
    current,
    dispatch,
    checkpointStore,
    hydrated,
    audio,
    setCapabilityNotice,
  );

  useEffect(() => {
    return () => {
      void audio.recorder.cancel();
      audio.textToSpeech.stop();
    };
  }, [audio]);

  function submitTyping() {
    setCapabilityNotice(null);
    dispatch({ type: "submit-typing", text: draft });
    setDraft("");
  }

  function startRecording() {
    setRecordingSeconds(0);
    dispatch({ type: "start-recording" });
  }

  function moveToNextExpression() {
    const nextIndex = (current.expressionIndex + 1) % practiceExpressions.length;
    setDraft("");
    async function clearAndLoad() {
      await checkpointStore?.clear();
      dispatch({ type: "load-expression", expressionIndex: nextIndex });
    }
    void clearAndLoad();
  }

  return (
    <div
      className="training-loop"
      data-testid="training-loop"
      data-status={state.status}
      data-hydrated={hydrated}
      data-restored={restored}
    >
      <header className="page-header page-header--simple training-loop__header">
        <div>
          <p className="eyebrow">表达练习</p>
          <h1>把一句话说到对方能接住</h1>
        </div>
        <div
          className="training-loop__counter"
          role="progressbar"
          aria-label={`第 ${current.expressionIndex + 1} 句，共 4 句`}
          aria-valuemin={1}
          aria-valuemax={4}
          aria-valuenow={current.expressionIndex + 1}
        >
          <span>当前句</span>
          <strong>{current.expressionIndex + 1} / 4</strong>
        </div>
      </header>

      {restored ? (
        <p className="training-loop__restore-status" role="status">
          已恢复上次稳定进度
        </p>
      ) : null}

      {capabilityNotice ? (
        <p className="training-loop__capability-notice" role="status">
          {capabilityNotice}
        </p>
      ) : null}

      <section className="training-loop__context" aria-labelledby="training-expression">
        <div className="training-loop__status" aria-live="polite">
          <span className="training-loop__status-dot" aria-hidden="true" />
          {statusLabel(state)}
        </div>
        <p className="eyebrow eyebrow--accent">{expression.goalKey}</p>
        <h2 id="training-expression">{expression.text}</h2>
        <p className="training-loop__translation">{expression.translations["zh-CN"]}</p>
        <p className="training-loop__intent">{expression.communicativeIntent["zh-CN"]}</p>
        <div
          className="training-loop__audio-line"
          data-playing={state.status === "presenting-input"}
          aria-label="西班牙语输入音频"
        >
          <span className="training-loop__audio-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M5 10v4h3l4 4V6l-4 4H5Z" />
              <path d="M16 9.5a4 4 0 0 1 0 5M18.5 7a7.5 7.5 0 0 1 0 10" />
            </svg>
          </span>
          <span className="training-loop__audio-bars" aria-hidden="true">
            <i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
          </span>
          <span className="training-loop__audio-label">
            {state.status === "presenting-input" ? "正在播放" : "已听过一遍"}
          </span>
        </div>
      </section>

      <section className="training-loop__workbench" aria-label="训练操作">
        <div className="training-loop__progress">
          <div className="training-loop__progress-copy">
            <span className="training-loop__progress-label">本轮节奏</span>
            <strong>{state.outputMode === "typing" ? "文字回答" : "口语回答"}</strong>
          </div>
          <span className="training-loop__progress-hint">提示 {state.hintLevel}/3</span>
        </div>

        {state.status === "presenting-input" ? (
          <p className="training-loop__instruction">先听输入，听完后用自己的话回应。</p>
        ) : null}

        {state.status === "awaiting-output" ? (
          <div className="training-loop__output-choice">
            <button
              className="training-loop__primary training-loop__voice-action"
              onClick={startRecording}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <rect x="8" y="3" width="8" height="13" rx="4" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
              </svg>
              <span>开始录音</span>
              <span className="training-loop__button-note" aria-hidden="true">用声音回答</span>
            </button>
            <button
              className="training-loop__secondary training-loop__typing-action"
              onClick={() => {
                setCapabilityNotice(null);
                dispatch({ type: "switch-to-silent" });
              }}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M5 5.5h14v13H5zM8 9h8M8 12h5M8 15h8" />
              </svg>
              <span>用文字回答</span>
              <span className="training-loop__button-note" aria-hidden="true">安静环境</span>
            </button>
          </div>
        ) : null}

        {state.status === "awaiting-output" && state.outputMode === "typing" ? (
          <div className="training-loop__composer">
            <label htmlFor="training-draft">写下你的回应</label>
            <textarea
              id="training-draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="例如：¿Qué tal todo?"
              rows={3}
            />
            <div className="training-loop__composer-actions">
              <button
                className="training-loop__primary"
                disabled={!draft.trim()}
                onClick={submitTyping}
                type="button"
              >
                提交文字回答
              </button>
              <button
                className="training-loop__secondary training-loop__composer-voice"
                onClick={() => {
                  setDraft("");
                  startRecording();
                }}
                type="button"
              >
                改用语音录音
              </button>
            </div>
          </div>
        ) : null}

        {state.status === "recording" ? (
          <div className="training-loop__recording" aria-live="polite">
            <div className="training-loop__recording-head">
              <div className="training-loop__recording-state">
                <span className="training-loop__recording-mark" aria-hidden="true" />
                <span>正在听你说</span>
              </div>
              <time dateTime={`PT${recordingSeconds}S`} aria-label={`已录音 ${formatRecordingTime(recordingSeconds)}`}>
                {formatRecordingTime(recordingSeconds)}
              </time>
            </div>
            <div className="training-loop__recording-waveform" aria-hidden="true">
              {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
            </div>
            <p>完整说完，再结束这一轮。</p>
            <div className="training-loop__recording-actions">
              <button
                className="training-loop__primary"
                onClick={() =>
                  dispatch({
                    type: "stop-recording",
                    generationId: state.generationId,
                  })
                }
                type="button"
              >
                完成录音
              </button>
              <button
                className="training-loop__cancel"
                onClick={() =>
                  dispatch({
                    type: "cancel-recording",
                    generationId: state.generationId,
                  })
                }
                type="button"
              >
                取消，改用文字
              </button>
            </div>
          </div>
        ) : null}

        {isProcessing ? (
          <p className="training-loop__instruction" aria-live="polite">
            {state.status === "transcribing" ? "正在整理你的声音……" : "正在给出这轮反馈……"}
          </p>
        ) : null}

        {state.status === "showing-feedback" && state.evaluation ? (
          <div className="training-loop__feedback" role="status">
            <p className="eyebrow eyebrow--accent">这轮反馈</p>
            <div className="training-loop__feedback-result">
              <span className="training-loop__feedback-mark" aria-hidden="true">
                {state.evaluation.contextualSuccess ? "✓" : "!"}
              </span>
              <div>
                <span className="training-loop__feedback-label">沟通结果</span>
                <h3>
                  {state.evaluation.contextualSuccess
                    ? "对方可以接住你的意思"
                    : "这次还没有完成沟通任务"}
                </h3>
              </div>
            </div>
            <p className="training-loop__feedback-summary">
              {state.evaluation.contextualSuccess
                ? "自然的相近表达也算成功。"
                : "意思还差一点，再给自己一次完整表达的机会。"}
            </p>
            <div className="training-loop__feedback-next">
              <span>下一步</span>
              <strong>
                {state.evaluation.contextualSuccess
                  ? "换一个信息，再说一次"
                  : "换一种说法，完成同一个目的"}
              </strong>
            </div>
            <div className="training-loop__feedback-actions">
              <button
                className="training-loop__secondary"
                onClick={() => dispatch({ type: "enter-variant" })}
                type="button"
              >
                练习变式
              </button>
              <button
                className="training-loop__primary"
                onClick={() => dispatch({ type: "complete-task" })}
                type="button"
              >
                完成这句
              </button>
            </div>
          </div>
        ) : null}

        {state.status === "transitioning" ? (
          <p className="training-loop__instruction" aria-live="polite">换一个信息，再完成同一个沟通目的。</p>
        ) : null}

        {state.status === "completed" ? (
          <div className="training-loop__feedback" role="status">
            <p className="eyebrow eyebrow--accent">已保存</p>
            <div className="training-loop__feedback-result">
              <span className="training-loop__feedback-mark" aria-hidden="true">✓</span>
              <div>
                <span className="training-loop__feedback-label">本句完成</span>
                <h3>这句练习完成了</h3>
              </div>
            </div>
            <p className="training-loop__feedback-summary">完成一次任务不会直接改变能力画像，之后还会用陌生变体复核。</p>
            <button className="training-loop__primary" onClick={moveToNextExpression} type="button">
              下一句
            </button>
          </div>
        ) : null}

        {state.status === "recoverable-error" && state.error ? (
          <div className="training-loop__error" role="alert">
            <div className="training-loop__feedback-result">
              <span className="training-loop__feedback-mark" aria-hidden="true">!</span>
              <div>
                <span className="training-loop__feedback-label">需要再试一次</span>
                <h3>这次技术步骤没有完成</h3>
              </div>
            </div>
            <p>没有产生负面能力记录，你可以回到当前句重新尝试。</p>
            <button className="training-loop__primary" onClick={() => dispatch({ type: "retry" })} type="button">
              再试一次
            </button>
          </div>
        ) : null}

        {state.status === "awaiting-output" ? (
          <div className="training-loop__hints">
            <div className="training-loop__hints-head">
              <span>需要一点支撑？</span>
              <span>{state.hintLevel === 0 ? "按需打开" : `已打开 ${state.hintLevel}/3`}</span>
            </div>
            <div className="training-loop__hint-drawer">
              {[1, 2, 3].map((level) => (
                <button
                  key={level}
                  className={level <= state.hintLevel ? "is-active" : ""}
                  aria-pressed={level <= state.hintLevel}
                  onClick={() => dispatch({ type: "request-hint", level: level as 1 | 2 | 3 })}
                  type="button"
                >
                  <span className="training-loop__hint-index">0{level}</span>
                  <span>提示 {level}</span>
                  <span className="training-loop__hint-state" aria-hidden="true">{level <= state.hintLevel ? "已开" : ""}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
