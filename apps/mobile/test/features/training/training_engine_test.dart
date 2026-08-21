import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/features/training/domain/training_engine.dart';
import 'package:spanish_mobile/features/training/domain/training_event.dart';
import 'package:spanish_mobile/features/training/domain/training_state.dart';

Directory get repositoryRoot => Directory.current.parent.parent;

Map<String, dynamic> readFixture() => jsonDecode(
      File(
        '${repositoryRoot.path}${Platform.pathSeparator}contracts${Platform.pathSeparator}fixtures${Platform.pathSeparator}training${Platform.pathSeparator}training-transitions.json',
      ).readAsStringSync(),
    ) as Map<String, dynamic>;

Map<String, Object?> stateSnapshot(TrainingState state) => <String, Object?>{
      'status': state.status.value,
      'contentKey': state.contentKey,
      'goalKey': state.goalKey,
      'outputMode': state.outputMode.value,
      'hintLevel': state.hintLevel,
      'generationId': state.generationId,
      'transcript': state.transcript,
      'evaluation': state.evaluation == null
          ? null
          : <String, Object?>{
              'contextualSuccess': state.evaluation!.contextualSuccess,
              'evidenceStrength': state.evaluation!.evidenceStrength.value,
              'feedbackKey': state.evaluation!.feedbackKey,
            },
      'error': state.error == null
          ? null
          : <String, Object?>{
              'code': state.error!.code,
              'recoverTo': state.error!.recoverTo.value,
              'technical': state.error!.technical,
            },
    };

void main() {
  final fixture = readFixture();
  final cases = fixture['cases'] as List<dynamic>;

  for (final rawCase in cases) {
    final testCase = rawCase as Map<String, dynamic>;
    test('replays ${testCase['id']}', () {
      final events = (testCase['events'] as List<dynamic>)
          .map(TrainingEvent.fromJson)
          .toList(growable: false);
      final result = reduceTraining(events);
      final expected = testCase['expected'] as Map<String, dynamic>;

      expect(stateSnapshot(result.state), equals(expected['state']));
      expect(
        result.effects.map((effect) => effect.toJson()).toList(growable: false),
        equals(expected['effects']),
      );
    });
  }

  test('does not turn a technical failure into evaluation evidence', () {
    final result = reduceTraining(<TrainingEvent>[
      const TrainingEvent('content-loaded', <String, Object?>{
        'contentKey': 'expression.demo',
        'goalKey': 'goal.demo',
      }),
      const TrainingEvent('input-playback-completed'),
      const TrainingEvent('submit-typing', <String, Object?>{'text': 'Hola'}),
      const TrainingEvent('evaluation-failed', <String, Object?>{
        'generationId': 2,
        'errorCode': 'evaluation-timeout',
      }),
    ]);

    expect(result.state.status, TrainingStatus.recoverableError);
    expect(result.state.evaluation, isNull);
    expect(result.effects.first.toJson(), <String, Object?>{
      'type': 'show-error',
      'code': 'evaluation-timeout',
      'technical': true,
    });
  });
}
