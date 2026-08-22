import { readFile, rename, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  checkCalibrationReadiness,
  localTranscriptSnapshotSchema,
  parseCalibrationAuthorization,
  parseCalibrationBatchSnapshot,
  parseReplayAudioManifest,
  type CalibrationBatchSnapshot,
} from "../src/modules/evidence/replay";
import type { AnnotationDraft } from "../src/modules/providers/annotation";

class InputError extends Error {}

type ManualDraftPlan = {
  summary: string;
  observations: Array<{
    category: "transcript" | "context";
    observation: string;
    evidenceBasis: "transcript";
  }>;
  questions: string[];
};

const manualDraftPlans: Record<string, ManualDraftPlan> = {};

try {
  const args = parseArguments(process.argv.slice(2));
  const manifest = parseReplayAudioManifest(await readJson(args.manifest));
  const authorization = parseCalibrationAuthorization(await readJson(args.authorization));
  const readiness = checkCalibrationReadiness({ manifest, authorization });
  if (readiness.status === "blocked") {
    throw new InputError(`Calibration gate blocked: ${readiness.reasons.map((reason) => reason.code).join(",")}`);
  }

  const transcripts = localTranscriptSnapshotSchema.parse(await readJson(args.transcripts));
  const transcriptById = new Map(transcripts.samples.map((sample) => [sample.sampleId, sample]));
  const samples = manifest.entries.map((entry) => {
    const transcript = transcriptById.get(entry.sampleId);
    const attemptId = `calibration.${entry.sampleId}`;
    if (!transcript || transcript.status === "failed") {
      return {
        sampleId: entry.sampleId,
        attemptId,
        status: "failed" as const,
        stage: "transcription" as const,
        errorCode: transcript?.status === "failed" ? transcript.errorCode : "transcript-not-found",
        retryable: false,
      };
    }
    return {
      sampleId: entry.sampleId,
      attemptId,
      status: "completed" as const,
      transcript: transcript.transcript,
      transcriptionProvider: "local-whisper" as const,
      transcriptionModelVersion: transcript.modelVersion,
      transcriptionLatencyMs: transcript.latencyMs,
      transcriptionRequestId: null,
      annotationRequestId: null,
      draft: createManualDraft(entry.sampleId),
      speechSignal: null,
    };
  });

  const snapshot = parseCalibrationBatchSnapshot({
    schemaVersion: "1.0",
    runId: `manual-codex-${transcripts.runId}`,
    status: samples.every((sample) => sample.status === "completed") ? "completed" : "partial-failure",
    samples,
  });
  await writeSnapshotAtomically(args.output, snapshot);
  process.stdout.write(`${JSON.stringify({
    status: snapshot.status,
    runId: snapshot.runId,
    completed: snapshot.samples.filter((sample) => sample.status === "completed").length,
    failed: snapshot.samples.filter((sample) => sample.status === "failed").length,
  })}\n`);
} catch (error) {
  const message = error instanceof InputError
    ? error.message
    : error instanceof Error
      ? error.message
      : "Manual annotation input is invalid.";
  process.stderr.write(`${message}\n`);
  process.exitCode = error instanceof InputError ? 2 : 1;
}

function createManualDraft(sampleId: string): AnnotationDraft {
  const plan = manualDraftPlans[sampleId] ?? {
    summary: "转写内容需要人工结合原音频确认。",
    observations: [
      {
        category: "transcript" as const,
        observation: "当前只能确认转写文本本身，不能据此判断发音、流利度或学习能力。",
        evidenceBasis: "transcript" as const,
      },
    ],
    questions: ["原音频中的词句是否与转写一致？"],
  };
  return {
    status: "draft",
    summary: plan.summary,
    observations: plan.observations.map((observation) => ({ ...observation, needsHumanReview: true as const })),
    questionsForReviewer: plan.questions,
    safety: {
      audioSent: false,
      writesEvidence: false,
      affectsMastery: false,
      affectsConfidence: false,
    },
    provider: "manual-codex",
    modelVersion: "codex-manual-review-v1",
    providerRequestId: null,
    latencyMs: 0,
    estimatedCostMicros: 0,
    retentionPolicy: "ephemeral",
  };
}

Object.assign(manualDraftPlans, {
  "audio.02aa19e818232fc7": {
    summary: "转写显示多组问候、感谢和告别练习；中间若干片段疑似识别错误，需要人工回听。",
    observations: [
      { category: "context", observation: "可辨认问候、感谢和告别等交际表达，但样本也包含练习编号。", evidenceBasis: "transcript" },
      { category: "transcript", observation: "部分短语与常见西班牙语表达不一致，不能直接当作学习者的真实表达。", evidenceBasis: "transcript" },
    ],
    questions: ["疑似错误片段的原音频内容是什么？", "这些句子是朗读练习还是独立交际表达？"],
  },
  "audio.a36495517a8dd410": {
    summary: "转写包含问候、感谢、告别和可能的“de nada”片段，整体语境需要人工确认。",
    observations: [
      { category: "context", observation: "问候、感谢和告别表达较清楚，适合标记为基础社交短语练习。", evidenceBasis: "transcript" },
      { category: "transcript", observation: "“Ve nada”可能是转写误差，不能据此判断用户实际说法。", evidenceBasis: "transcript" },
    ],
    questions: ["该片段是否实际为“de nada”？", "音频是否为连续对话，还是短语逐条朗读？"],
  },
  "audio.836d4d6bff167534": {
    summary: "转写主要是不同时间段的问候和告别短语列表，未显示完整对话语境。",
    observations: [
      { category: "context", observation: "包含 buenos días、buenas tardes、buenas noches、hasta luego 等场景化表达。", evidenceBasis: "transcript" },
      { category: "transcript", observation: "当前文本更像词句复习材料，不能证明用户能在自由对话中迁移使用。", evidenceBasis: "transcript" },
    ],
    questions: ["每条短语之间是否有原音频停顿或提示？", "是否需要按正式程度或时间场景分组？"],
  },
  "audio.0d472e13a21a0c38": {
    summary: "转写是一组西班牙语字母与示例词拼读练习，不是完整交际表达。",
    observations: [
      { category: "context", observation: "内容覆盖字母、姓名、城市和国家示例，适合归为字母拼读或词汇识别练习。", evidenceBasis: "transcript" },
      { category: "transcript", observation: "个别字母或专名可能存在转写混淆，需要以原音频和教材文本核对。", evidenceBasis: "transcript" },
    ],
    questions: ["字母名称和示例词是否与教材顺序一致？", "该样本是否仅用于听辨/跟读，而非口语能力评分？"],
  },
  "audio.8117d0f67830447c": {
    summary: "转写包含食物、地点或姓名相关的词汇片段，但多个词语识别不稳定，需要人工回听。",
    observations: [
      { category: "transcript", observation: "可辨认 comida、camarero、cine、cuenta 等词汇，但整体缺少句子语境。", evidenceBasis: "transcript" },
      { category: "context", observation: "词汇列表不能单独证明用户能够在餐饮场景中完成交际任务。", evidenceBasis: "transcript" },
    ],
    questions: ["疑似词汇错误的原音频内容是什么？", "这些词是否来自同一个场景或词汇练习单元？"],
  },
});

function parseArguments(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (!argument?.startsWith("--")) throw new InputError("Manual annotation arguments are invalid.");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new InputError("Manual annotation arguments are incomplete.");
    values.set(argument.slice(2), value);
    index += 1;
  }
  const manifest = values.get("manifest");
  const authorization = values.get("authorization");
  const transcripts = values.get("transcripts");
  const output = values.get("output");
  if (!manifest || !authorization || !transcripts || !output) {
    throw new InputError("Usage: pnpm audio:calibration:manual-annotate -- --manifest <file> --authorization <file> --transcripts <file> --output <file>");
  }
  return { manifest, authorization, transcripts, output };
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    throw new InputError("A manual annotation input JSON file is unreadable.");
  }
}

async function writeSnapshotAtomically(outputPath: string, snapshot: CalibrationBatchSnapshot): Promise<void> {
  const directory = path.dirname(outputPath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
}
