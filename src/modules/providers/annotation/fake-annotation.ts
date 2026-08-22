import {
  AnnotationDraftError,
  type AnnotationDraft,
  type AnnotationDraftInput,
  type AnnotationDraftProvider,
  validateAnnotationDraftInput,
} from "./annotation";

export type FakeAnnotationDraftProviderResult =
  | AnnotationDraft
  | AnnotationDraftError
  | (() => AnnotationDraft | AnnotationDraftError);

export class FakeAnnotationDraftProvider implements AnnotationDraftProvider {
  readonly inputs: AnnotationDraftInput[] = [];

  constructor(
    private readonly result: FakeAnnotationDraftProviderResult = defaultDraft,
  ) {}

  async createDraft(
    input: AnnotationDraftInput,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<AnnotationDraft> {
    validateAnnotationDraftInput(input);
    if (options.signal?.aborted) {
      throw new AnnotationDraftError(
        "provider-cancelled",
        "Annotation drafting was cancelled.",
        false,
      );
    }
    this.inputs.push(input);
    const result = typeof this.result === "function" ? this.result() : this.result;
    if (result instanceof AnnotationDraftError) throw result;
    return result;
  }
}

const defaultDraft: AnnotationDraft = {
  status: "draft",
  summary: "人工复核草稿。",
  observations: [
    {
      category: "context",
      observation: "需要人工确认表达是否完成当前交际任务。",
      evidenceBasis: "transcript",
      needsHumanReview: true,
    },
  ],
  questionsForReviewer: ["表达是否在语境中自然且可理解？"],
  safety: {
    audioSent: false,
    writesEvidence: false,
    affectsMastery: false,
    affectsConfidence: false,
  },
  provider: "fake",
  modelVersion: "fake-annotation-v1",
  providerRequestId: null,
  latencyMs: 0,
  estimatedCostMicros: 0,
  retentionPolicy: "ephemeral",
};

