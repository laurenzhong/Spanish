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
    final baseKey = expressionKey.split('.variant.').first;
    switch (baseKey) {
      case 'start.como-va-todo':
        return text.contains('como va') ||
            text.contains('que tal') ||
            text.contains('como te va') ||
            _containsAny(text, const <String>[
              'bien', 'mal', 'regular', 'genial', 'tranquil', 'ocupad',
              'cansad', 'gracias', 'todo', 'trabajo', 'clase', 'dia', 'semana',
            ]);
      case 'relationship.como-se-llama':
        return text.contains('como se llama') ||
            text.contains('como te llamas') ||
            text.contains('cual es tu nombre') ||
            _containsAny(text, const <String>['me llamo', 'soy']);
      case 'relationship.me-gusta-viajar':
        return _containsAny(text, const <String>[
          'me gusta', 'me encanta', 'disfruto', 'aficion', 'hobby', 'viajar',
          'viaje', 'musica', 'cine', 'leer', 'senderismo', 'comida',
        ]);
      case 'need.necesito-ayuda':
        return _containsAny(text, const <String>[
          'necesito', 'ayuda', 'podrias', 'puede', 'por favor', 'problema',
        ]);
      default:
        return false;
    }
  }

  bool _containsAny(String text, List<String> signals) =>
      signals.any(text.contains);

  String _fold(String value) => value
      .replaceAll('á', 'a')
      .replaceAll('é', 'e')
      .replaceAll('í', 'i')
      .replaceAll('ó', 'o')
      .replaceAll('ú', 'u')
      .replaceAll('ü', 'u');
}
