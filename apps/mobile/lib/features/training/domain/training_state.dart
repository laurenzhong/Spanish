enum TrainingStatus {
  loadingContext('loading-context'),
  presentingInput('presenting-input'),
  awaitingOutput('awaiting-output'),
  recording('recording'),
  transcribing('transcribing'),
  evaluating('evaluating'),
  showingFeedback('showing-feedback'),
  transitioning('transitioning'),
  completed('completed'),
  recoverableError('recoverable-error');

  const TrainingStatus(this.value);
  final String value;

  static TrainingStatus fromValue(String value) => TrainingStatus.values.firstWhere(
        (status) => status.value == value,
        orElse: () => throw FormatException('Unsupported training status: $value'),
      );
}

enum TrainingOutputMode { speech('speech'), typing('typing');
  const TrainingOutputMode(this.value);
  final String value;
}

enum EvidenceStrength {
  none('none'),
  weak('weak'),
  moderate('moderate'),
  strong('strong');

  const EvidenceStrength(this.value);
  final String value;

  static EvidenceStrength fromValue(String value) => EvidenceStrength.values.firstWhere(
        (strength) => strength.value == value,
        orElse: () => throw FormatException('Unsupported evidence strength: $value'),
      );
}

class TrainingEvaluation {
  const TrainingEvaluation({
    required this.contextualSuccess,
    required this.evidenceStrength,
    required this.feedbackKey,
  });

  final bool contextualSuccess;
  final EvidenceStrength evidenceStrength;
  final String feedbackKey;
}

class TrainingError {
  const TrainingError({required this.code, required this.recoverTo});

  final String code;
  final TrainingStatus recoverTo;
  bool get technical => true;
}

class TrainingState {
  const TrainingState({
    required this.status,
    required this.contentKey,
    required this.goalKey,
    required this.outputMode,
    required this.hintLevel,
    required this.generationId,
    required this.transcript,
    required this.evaluation,
    required this.error,
  });

  factory TrainingState.initial() => const TrainingState(
        status: TrainingStatus.loadingContext,
        contentKey: null,
        goalKey: null,
        outputMode: TrainingOutputMode.speech,
        hintLevel: 0,
        generationId: 0,
        transcript: null,
        evaluation: null,
        error: null,
      );

  final TrainingStatus status;
  final String? contentKey;
  final String? goalKey;
  final TrainingOutputMode outputMode;
  final int hintLevel;
  final int generationId;
  final String? transcript;
  final TrainingEvaluation? evaluation;
  final TrainingError? error;

  TrainingState copyWith({
    TrainingStatus? status,
    String? contentKey,
    String? goalKey,
    TrainingOutputMode? outputMode,
    int? hintLevel,
    int? generationId,
    String? transcript,
    TrainingEvaluation? evaluation,
    TrainingError? error,
    bool clearContent = false,
    bool clearGoal = false,
    bool clearTranscript = false,
    bool clearEvaluation = false,
    bool clearError = false,
  }) {
    return TrainingState(
      status: status ?? this.status,
      contentKey: clearContent ? null : contentKey ?? this.contentKey,
      goalKey: clearGoal ? null : goalKey ?? this.goalKey,
      outputMode: outputMode ?? this.outputMode,
      hintLevel: hintLevel ?? this.hintLevel,
      generationId: generationId ?? this.generationId,
      transcript: clearTranscript ? null : transcript ?? this.transcript,
      evaluation: clearEvaluation ? null : evaluation ?? this.evaluation,
      error: clearError ? null : error ?? this.error,
    );
  }
}
