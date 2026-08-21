import '../domain/training_event.dart';
import '../domain/training_state.dart';

class FakeEvaluationRequest {
  const FakeEvaluationRequest({
    required this.expressionKey,
    required this.generationId,
    required this.outputMode,
    required this.text,
  });

  final String expressionKey;
  final int generationId;
  final TrainingOutputMode outputMode;
  final String text;
}

class FakeEvaluator {
  const FakeEvaluator({this.latency = const Duration(milliseconds: 160)});

  final Duration latency;

  Future<TrainingEvent> evaluate(FakeEvaluationRequest request) async {
    await Future<void>.delayed(latency);
    final text = _fold(request.text.trim().toLowerCase());
    final accepted = text.isNotEmpty && _matches(request.expressionKey, text);

    return TrainingEvent('evaluation-succeeded', <String, Object?>{
      'generationId': request.generationId,
      'contextualSuccess': accepted,
      'evidenceStrength': accepted && request.outputMode == TrainingOutputMode.speech
          ? EvidenceStrength.strong.value
          : EvidenceStrength.weak.value,
      'feedbackKey': accepted ? 'contextual-success' : 'needs-another-attempt',
    });
  }

  bool _matches(String expressionKey, String text) {
    switch (expressionKey) {
      case 'start.como-va-todo':
        return text.contains('como va') ||
            text.contains('que tal') ||
            text.contains('como te va');
      case 'relationship.como-se-llama':
        return text.contains('como se llama') ||
            text.contains('como te llamas') ||
            text.contains('cual es tu nombre');
      case 'relationship.me-gusta-viajar':
        return text.contains('me gusta') || text.contains('me encanta');
      case 'need.necesito-ayuda':
        return text.contains('necesito') || text.contains('puede ayudar');
      default:
        return false;
    }
  }

  String _fold(String value) => value
      .replaceAll('á', 'a')
      .replaceAll('é', 'e')
      .replaceAll('í', 'i')
      .replaceAll('ó', 'o')
      .replaceAll('ú', 'u')
      .replaceAll('ü', 'u');
}
