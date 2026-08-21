import 'dart:convert';

import 'package:spanish_mobile/core/platform/platform_capabilities.dart';

import '../domain/training_state.dart';

const trainingCheckpointSchemaVersion = 1;
const trainingContentBundleKey = 'alpha.core';
const trainingContentBundleVersion = 1;

const stableTrainingStatuses = <TrainingStatus>[
  TrainingStatus.awaitingOutput,
  TrainingStatus.showingFeedback,
  TrainingStatus.completed,
  TrainingStatus.recoverableError,
];

class TrainingCheckpoint {
  const TrainingCheckpoint({
    required this.contentKey,
    required this.goalKey,
    required this.status,
    required this.outputMode,
    required this.hintLevel,
    required this.generationId,
    required this.transcript,
    required this.evaluation,
    required this.error,
    this.contentBundleKey = trainingContentBundleKey,
    this.contentBundleVersion = trainingContentBundleVersion,
  });

  factory TrainingCheckpoint.fromState(
    TrainingState state, {
    String bundleKey = trainingContentBundleKey,
    int bundleVersion = trainingContentBundleVersion,
  }) {
    if (!stableTrainingStatuses.contains(state.status) ||
        state.contentKey == null ||
        state.goalKey == null) {
      throw ArgumentError('Training state is not a stable checkpoint state.');
    }
    return TrainingCheckpoint(
      contentKey: state.contentKey!,
      goalKey: state.goalKey!,
      status: state.status,
      outputMode: state.outputMode,
      hintLevel: state.hintLevel,
      generationId: state.generationId,
      transcript: state.transcript,
      evaluation: state.evaluation,
      error: state.error,
      contentBundleKey: bundleKey,
      contentBundleVersion: bundleVersion,
    );
  }

  final String contentBundleKey;
  final int contentBundleVersion;
  final String contentKey;
  final String goalKey;
  final TrainingStatus status;
  final TrainingOutputMode outputMode;
  final int hintLevel;
  final int generationId;
  final String? transcript;
  final TrainingEvaluation? evaluation;
  final TrainingError? error;

  Map<String, Object?> toJson() => <String, Object?>{
        'schemaVersion': trainingCheckpointSchemaVersion,
        'contentBundleKey': contentBundleKey,
        'contentBundleVersion': contentBundleVersion,
        'contentKey': contentKey,
        'goalKey': goalKey,
        'status': status.value,
        'outputMode': outputMode.value,
        'hintLevel': hintLevel,
        'generationId': generationId,
        'transcript': transcript,
        'evaluation': evaluation == null
            ? null
            : <String, Object?>{
                'contextualSuccess': evaluation!.contextualSuccess,
                'evidenceStrength': evaluation!.evidenceStrength.value,
                'feedbackKey': evaluation!.feedbackKey,
              },
        'error': error == null
            ? null
            : <String, Object?>{
                'code': error!.code,
                'recoverTo': error!.recoverTo.value,
                'technical': error!.technical,
              },
      };

  String encode() => jsonEncode(toJson());

  TrainingState toState() => TrainingState(
        status: status,
        contentKey: contentKey,
        goalKey: goalKey,
        outputMode: outputMode,
        hintLevel: hintLevel,
        generationId: generationId,
        transcript: transcript,
        evaluation: evaluation,
        error: error,
      );

  static TrainingCheckpoint? tryParse(
    String serialized, {
    String expectedBundleKey = trainingContentBundleKey,
    int expectedBundleVersion = trainingContentBundleVersion,
  }) {
    try {
      final input = jsonDecode(serialized);
      if (input is! Map) return null;
      final json = Map<String, Object?>.from(input);
      if (json['schemaVersion'] != trainingCheckpointSchemaVersion ||
          json['contentBundleKey'] != expectedBundleKey ||
          json['contentBundleVersion'] != expectedBundleVersion) {
        return null;
      }
      final contentKey = json['contentKey'];
      final goalKey = json['goalKey'];
      final statusValue = json['status'];
      final outputModeValue = json['outputMode'];
      final hintLevel = json['hintLevel'];
      final generationId = json['generationId'];
      if (contentKey is! String || contentKey.isEmpty ||
          goalKey is! String || goalKey.isEmpty ||
          statusValue is! String || outputModeValue is! String ||
          hintLevel is! int || hintLevel < 0 || hintLevel > 3 ||
          generationId is! int || generationId < 0 ||
          !stableTrainingStatuses.any((status) => status.value == statusValue)) {
        return null;
      }
      final status = TrainingStatus.fromValue(statusValue);
      final outputMode = TrainingOutputMode.values.firstWhere(
        (mode) => mode.value == outputModeValue,
        orElse: () => throw const FormatException('Invalid output mode.'),
      );
      final transcript = json['transcript'];
      if (transcript != null && transcript is! String) return null;
      final evaluation = _parseEvaluation(json['evaluation']);
      if (json['evaluation'] != null && evaluation == null) return null;
      final error = _parseError(json['error']);
      if (json['error'] != null && error == null) return null;
      if (status == TrainingStatus.showingFeedback && evaluation == null) return null;
      if (status == TrainingStatus.recoverableError && error == null) return null;

      return TrainingCheckpoint(
        contentBundleKey: expectedBundleKey,
        contentBundleVersion: expectedBundleVersion,
        contentKey: contentKey,
        goalKey: goalKey,
        status: status,
        outputMode: outputMode,
        hintLevel: hintLevel,
        generationId: generationId,
        transcript: transcript as String?,
        evaluation: evaluation,
        error: error,
      );
    } catch (_) {
      return null;
    }
  }
}

abstract interface class TrainingCheckpointStore {
  Future<String?> read();

  Future<void> write(String serialized);

  Future<void> clear();
}

class SecureStorageTrainingCheckpointStore implements TrainingCheckpointStore {
  SecureStorageTrainingCheckpointStore(this._storage, {required String userId})
      : _key = trainingCheckpointStorageKey(userId);

  final SecureStorage _storage;
  final String _key;

  @override
  Future<String?> read() => _storage.read(_key);

  @override
  Future<void> write(String serialized) => _storage.write(_key, serialized);

  @override
  Future<void> clear() => _storage.delete(_key);
}

String trainingCheckpointStorageKey(String userId) =>
    'spanish.training.checkpoint.v1.${Uri.encodeComponent(userId)}';

TrainingEvaluation? _parseEvaluation(Object? input) {
  if (input == null || input is! Map) return null;
  final json = Map<String, Object?>.from(input);
  final contextualSuccess = json['contextualSuccess'];
  final evidenceStrength = json['evidenceStrength'];
  final feedbackKey = json['feedbackKey'];
  if (contextualSuccess is! bool || evidenceStrength is! String || feedbackKey is! String || feedbackKey.isEmpty) {
    return null;
  }
  return TrainingEvaluation(
    contextualSuccess: contextualSuccess,
    evidenceStrength: EvidenceStrength.fromValue(evidenceStrength),
    feedbackKey: feedbackKey,
  );
}

TrainingError? _parseError(Object? input) {
  if (input == null || input is! Map) return null;
  final json = Map<String, Object?>.from(input);
  final code = json['code'];
  final recoverTo = json['recoverTo'];
  if (code is! String || code.isEmpty || recoverTo is! String || json['technical'] != true) {
    return null;
  }
  final status = TrainingStatus.fromValue(recoverTo);
  if (status == TrainingStatus.loadingContext || status == TrainingStatus.recoverableError) {
    return null;
  }
  return TrainingError(code: code, recoverTo: status);
}

Future<TrainingState?> restoreTrainingCheckpoint(
  TrainingCheckpointStore store, {
  String expectedBundleKey = trainingContentBundleKey,
  int expectedBundleVersion = trainingContentBundleVersion,
}) async {
  String? serialized;
  try {
    serialized = await store.read();
  } catch (_) {
    return null;
  }
  if (serialized == null) return null;
  final checkpoint = TrainingCheckpoint.tryParse(
    serialized,
    expectedBundleKey: expectedBundleKey,
    expectedBundleVersion: expectedBundleVersion,
  );
  if (checkpoint == null) {
    try {
      await store.clear();
    } catch (_) {
      // A storage failure must not block the training flow.
    }
    return null;
  }
  return checkpoint.toState();
}
