"use client";

import {
  useEffect,
  useMemo,
  useReducer,
  useState,
  type Dispatch,
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

function useTrainingEffects(
  current: LoopState,
  dispatch: Dispatch<LoopEvent>,
  store: TrainingCheckpointStore | null,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    const cleanups: Array<() => void> = [];

    for (const effect of current.transition.effects) {
      if (effect.type === "save-breakpoint" && store) {
        const checkpoint = checkpointFromState(current.transition.state);
        if (checkpoint) {
          void store.write(serializeTrainingCheckpoint(checkpoint));
        }
      }

      if (effect.type === "play-input") {
        const timer = window.setTimeout(
          () => dispatch({ type: "input-playback-completed" }),
          220,
        );
        cleanups.push(() => window.clearTimeout(timer));
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
        const timer = window.setTimeout(
          () =>
            dispatch({
              type: "transcription-succeeded",
              generationId: effect.generationId,
              transcript: simulatedTranscript,
              confidence: 0.96,
            }),
          180,
        );
        cleanups.push(() => window.clearTimeout(timer));
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

    return () => cleanups.forEach((cleanup) => cleanup());
  }, [current, dispatch, enabled, store]);
}

type FakeTrainingLoopProps = Readonly<{
  userId?: string;
}>;

export function FakeTrainingLoop({ userId = "local-user" }: FakeTrainingLoopProps) {
  const [current, dispatch] = useReducer(loopReducer, undefined, initialLoopState);
  const [draft, setDraft] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [restored, setRestored] = useState(false);
  const state = current.transition.state;
  const checkpointStore = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : createBrowserTrainingCheckpointStore(userId),
    [userId],
  );
  const expression = practiceExpressions[current.expressionIndex] ?? practiceExpressions[0];
  const isProcessing =
    state.status === "transcribing" || state.status === "evaluating";

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

  useTrainingEffects(current, dispatch, checkpointStore, hydrated);

  function submitTyping() {
    dispatch({ type: "submit-typing", text: draft });
    setDraft("");
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
          <p className="eyebrow">表达练习 · {current.expressionIndex + 1}/4</p>
          <h1>把一句话说到对方能接住</h1>
        </div>
        <span className="quiet-badge">开发微循环</span>
      </header>

      {restored ? (
        <p className="training-loop__restore-status" role="status">
          已恢复上次稳定进度
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
      </section>

      <section className="training-loop__workbench" aria-label="训练操作">
        <div className="training-loop__progress">
          <span>提示 {state.hintLevel}/3</span>
          <span>generation {state.generationId}</span>
        </div>

        {state.status === "presenting-input" ? (
          <p className="training-loop__instruction">先听输入，听完后用自己的话回应。</p>
        ) : null}

        {state.status === "awaiting-output" ? (
          <div className="training-loop__output-choice">
            <button
              className="training-loop__secondary"
              onClick={() => dispatch({ type: "switch-to-silent" })}
              type="button"
            >
              用文字回答
            </button>
            <button
              className="training-loop__primary"
              onClick={() => dispatch({ type: "start-recording" })}
              type="button"
            >
              开始模拟录音
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
            <button
              className="training-loop__primary"
              disabled={!draft.trim()}
              onClick={submitTyping}
              type="button"
            >
              提交文字回答
            </button>
          </div>
        ) : null}

        {state.status === "recording" ? (
          <div className="training-loop__recording" aria-live="polite">
            <span className="training-loop__recording-mark" aria-hidden="true" />
            <p>正在等待你的模拟回答</p>
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
              提交模拟语音
            </button>
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
            <h3>
              {state.evaluation.contextualSuccess
                ? "对方可以接住你的意思"
                : "这次还没有完成沟通任务"}
            </h3>
            <p>
              {state.evaluation.contextualSuccess
                ? "自然的相近表达也算成功；下一步换一个信息再试。"
                : "先保留这次尝试，再换一种说法完成同一个目的。"}
            </p>
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
            <h3>这句练习完成了</h3>
            <p>完成一次任务不会直接改变能力画像，之后还会用陌生变体复核。</p>
            <button className="training-loop__primary" onClick={moveToNextExpression} type="button">
              下一句
            </button>
          </div>
        ) : null}

        {state.status === "recoverable-error" && state.error ? (
          <div className="training-loop__error" role="alert">
            <h3>这次技术步骤没有完成</h3>
            <p>没有产生负面能力记录，你可以回到当前句重新尝试。</p>
            <button className="training-loop__primary" onClick={() => dispatch({ type: "retry" })} type="button">
              再试一次
            </button>
          </div>
        ) : null}

        {state.status === "awaiting-output" ? (
          <div className="training-loop__hints">
            {[1, 2, 3].map((level) => (
              <button
                key={level}
                className={level <= state.hintLevel ? "is-active" : ""}
                onClick={() => dispatch({ type: "request-hint", level: level as 1 | 2 | 3 })}
                type="button"
              >
                提示 {level}
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
