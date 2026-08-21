import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/features/training/domain/training_state.dart';
import 'package:spanish_mobile/features/training/fakes/fake_evaluator.dart';

void main() {
  test('accepts a natural alternative and gives strong speech evidence', () async {
    final result = await const FakeEvaluator(latency: Duration.zero).evaluate(
      const FakeEvaluationRequest(
        expressionKey: 'start.como-va-todo',
        generationId: 1,
        outputMode: TrainingOutputMode.speech,
        text: '¿Qué tal todo?',
      ),
    );

    expect(result.type, 'evaluation-succeeded');
    expect(result.boolean('contextualSuccess'), isTrue);
    expect(result.string('evidenceStrength'), 'strong');
  });

  test('keeps typed success at weak evidence', () async {
    final result = await const FakeEvaluator(latency: Duration.zero).evaluate(
      const FakeEvaluationRequest(
        expressionKey: 'relationship.me-gusta-viajar',
        generationId: 2,
        outputMode: TrainingOutputMode.typing,
        text: 'Me encanta viajar.',
      ),
    );

    expect(result.boolean('contextualSuccess'), isTrue);
    expect(result.string('evidenceStrength'), 'weak');
  });

  test('does not treat empty or unrelated output as a success', () async {
    final evaluator = const FakeEvaluator(latency: Duration.zero);
    final empty = await evaluator.evaluate(
      const FakeEvaluationRequest(
        expressionKey: 'need.necesito-ayuda',
        generationId: 3,
        outputMode: TrainingOutputMode.speech,
        text: '   ',
      ),
    );
    final unrelated = await evaluator.evaluate(
      const FakeEvaluationRequest(
        expressionKey: 'need.necesito-ayuda',
        generationId: 4,
        outputMode: TrainingOutputMode.speech,
        text: 'Me gusta el verano.',
      ),
    );

    expect(empty.boolean('contextualSuccess'), isFalse);
    expect(unrelated.boolean('contextualSuccess'), isFalse);
  });
}
