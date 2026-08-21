import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/core/platform/fake_platform_capabilities.dart';
import 'package:spanish_mobile/features/training/checkpoints/training_checkpoint.dart';
import 'package:spanish_mobile/features/training/domain/training_engine.dart';
import 'package:spanish_mobile/features/training/domain/training_event.dart';
import 'package:spanish_mobile/features/training/domain/training_state.dart';

TrainingState awaitingOutputState() => reduceTraining(<TrainingEvent>[
      const TrainingEvent('content-loaded', <String, Object?>{
        'contentKey': 'expression.demo',
        'goalKey': 'goal.demo',
      }),
      const TrainingEvent('input-playback-completed'),
    ]).state;

void main() {
  test('projects only stable states and round-trips them', () {
    final transient = reduceTraining(<TrainingEvent>[
      const TrainingEvent('content-loaded', <String, Object?>{
        'contentKey': 'expression.demo',
        'goalKey': 'goal.demo',
      }),
    ]).state;
    expect(
      () => TrainingCheckpoint.fromState(transient),
      throwsArgumentError,
    );

    final checkpoint = TrainingCheckpoint.fromState(awaitingOutputState());
    expect(
      TrainingCheckpoint.tryParse(checkpoint.encode())!.toState().status,
      TrainingStatus.awaitingOutput,
    );
  });

  test('clears corrupt storage and restores valid storage', () async {
    final storage = FakeSecureStorage();
    final store = SecureStorageTrainingCheckpointStore(
      storage,
      userId: 'checkpoint-user',
    );
    await store.write('broken');
    expect(await restoreTrainingCheckpoint(store), isNull);
    expect(await store.read(), isNull);

    await store.write(TrainingCheckpoint.fromState(awaitingOutputState()).encode());
    expect(
      (await restoreTrainingCheckpoint(store))?.status,
      TrainingStatus.awaitingOutput,
    );
  });

  test('keeps storage keys isolated by user id', () {
    expect(
      trainingCheckpointStorageKey('user/a'),
      isNot(trainingCheckpointStorageKey('user/b')),
    );
  });
}
