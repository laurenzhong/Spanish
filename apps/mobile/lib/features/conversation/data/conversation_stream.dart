import 'dart:async';
import 'dart:convert';

enum ConversationStreamEventType { meta, delta, done, error }

enum ConversationStreamErrorCode {
  streamAborted('stream-aborted'),
  streamFailed('stream-failed'),
  characterUnavailable('character-unavailable'),
  inputInvalid('input-invalid');

  const ConversationStreamErrorCode(this.value);
  final String value;

  static ConversationStreamErrorCode? fromValue(String value) {
    for (final code in values) {
      if (code.value == value) return code;
    }
    return null;
  }
}

sealed class ConversationStreamEvent {
  const ConversationStreamEvent({required this.type, required this.generationId});

  final ConversationStreamEventType type;
  final String generationId;
}

class ConversationMetaEvent extends ConversationStreamEvent {
  const ConversationMetaEvent({required this.characterKey, required this.characterVersion, required this.messageId, required super.generationId}) : super(type: ConversationStreamEventType.meta);
  final String characterKey;
  final int characterVersion;
  final String messageId;
}

class ConversationDeltaEvent extends ConversationStreamEvent {
  const ConversationDeltaEvent({required this.messageId, required this.text, required super.generationId}) : super(type: ConversationStreamEventType.delta);
  final String messageId;
  final String text;
}

class ConversationDoneEvent extends ConversationStreamEvent {
  const ConversationDoneEvent({required this.messageId, required super.generationId}) : super(type: ConversationStreamEventType.done);
  final String messageId;
}

class ConversationErrorEvent extends ConversationStreamEvent {
  const ConversationErrorEvent({required this.code, required this.messageId, required this.retryable, required super.generationId}) : super(type: ConversationStreamEventType.error);
  final ConversationStreamErrorCode code;
  final String? messageId;
  final bool retryable;
}

class ConversationStreamParser {
  String _buffer = '';
  bool _invalid = false;

  List<ConversationStreamEvent> push(String chunk) {
    if (_invalid) return const <ConversationStreamEvent>[];
    _buffer += chunk;
    final events = <ConversationStreamEvent>[];
    var newline = _buffer.indexOf('\n');
    while (newline >= 0) {
      final line = _buffer.substring(0, newline).replaceFirst(RegExp(r'\r$'), '').trim();
      _buffer = _buffer.substring(newline + 1);
      if (line.isNotEmpty) {
        final event = _parseLine(line);
        if (event == null) {
          _invalid = true;
          return <ConversationStreamEvent>[_failure()];
        }
        events.add(event);
      }
      newline = _buffer.indexOf('\n');
    }
    return events;
  }

  List<ConversationStreamEvent> finish() {
    if (_invalid) return const <ConversationStreamEvent>[];
    if (_buffer.trim().isNotEmpty) {
      _invalid = true;
      return <ConversationStreamEvent>[_failure()];
    }
    return const <ConversationStreamEvent>[];
  }

  ConversationStreamEvent? _parseLine(String line) {
    try {
      final decoded = jsonDecode(line);
      if (decoded is! Map<String, dynamic>) return null;
      final type = decoded['type'];
      final generationId = decoded['generationId'];
      if (type is! String || generationId is! String || generationId.trim().isEmpty) return null;
      switch (type) {
        case 'meta':
          if (decoded['protocolVersion'] != 'v1' || decoded['characterKey'] != 'lucia' || decoded['characterVersion'] != 1) return null;
          final messageId = decoded['messageId'];
          if (messageId is! String || messageId.trim().isEmpty) return null;
          return ConversationMetaEvent(characterKey: 'lucia', characterVersion: 1, messageId: messageId, generationId: generationId);
        case 'delta':
          final messageId = decoded['messageId'];
          final text = decoded['text'];
          if (messageId is! String || messageId.trim().isEmpty || text is! String || text.isEmpty) return null;
          return ConversationDeltaEvent(messageId: messageId, text: text, generationId: generationId);
        case 'done':
          final messageId = decoded['messageId'];
          if (messageId is! String || messageId.trim().isEmpty) return null;
          return ConversationDoneEvent(messageId: messageId, generationId: generationId);
        case 'error':
          final code = decoded['code'];
          final retryable = decoded['retryable'];
          final messageId = decoded['messageId'];
          final parsedCode = code is String ? ConversationStreamErrorCode.fromValue(code) : null;
          if (parsedCode == null || retryable is! bool || (messageId is! String && messageId != null)) return null;
          return ConversationErrorEvent(code: parsedCode, messageId: messageId as String?, retryable: retryable, generationId: generationId);
        default:
          return null;
      }
    } catch (_) {
      return null;
    }
  }

  ConversationErrorEvent _failure() => const ConversationErrorEvent(code: ConversationStreamErrorCode.streamFailed, messageId: null, retryable: true, generationId: 'unknown');
}

abstract interface class ConversationStreamClient {
  Stream<String> streamReply({required String text, required String clientMessageId, required String generationId});
}

class ConversationHistoryMessage {
  const ConversationHistoryMessage({required this.id, required this.role, required this.text, required this.complete, this.clientMessageId, this.generationId});
  final String id;
  final String role;
  final String text;
  final bool complete;
  final String? clientMessageId;
  final String? generationId;
}

abstract interface class ConversationHistoryClient {
  Future<List<ConversationHistoryMessage>> loadHistory();
}

class FakeConversationStreamClient implements ConversationStreamClient {
  const FakeConversationStreamClient();

  @override
  Stream<String> streamReply({required String text, required String clientMessageId, required String generationId}) async* {
    if (text.trim().isEmpty) {
      yield '${jsonEncode(<String, Object?>{'type': 'error', 'generationId': generationId, 'messageId': null, 'code': 'input-invalid', 'retryable': false})}\n';
      return;
    }
    const messageId = 'lucia-local-message';
    yield '${jsonEncode(<String, Object?>{'type': 'meta', 'protocolVersion': 'v1', 'characterKey': 'lucia', 'characterVersion': 1, 'generationId': generationId, 'messageId': messageId})}\n';
    final reply = text.toLowerCase().contains('hola') ? '¡Hola! Qué alegría leerte. ¿Cómo va todo por tu lado?' : 'Te leo. Cuéntame un poco más; me interesa saber qué tienes en mente.';
    for (final chunk in _chunks(reply)) {
      await Future<void>.delayed(const Duration(milliseconds: 35));
      yield '${jsonEncode(<String, Object?>{'type': 'delta', 'generationId': generationId, 'messageId': messageId, 'text': chunk})}\n';
    }
    yield '${jsonEncode(<String, Object?>{'type': 'done', 'generationId': generationId, 'messageId': messageId})}\n';
  }

  List<String> _chunks(String text) {
    final words = text.split(' ');
    final chunks = <String>[];
    var current = '';
    for (final word in words) {
      final candidate = current.isEmpty ? word : '$current $word';
      if (candidate.length > 18 && current.isNotEmpty) {
        chunks.add('$current ');
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current.isNotEmpty) chunks.add(current);
    return chunks;
  }
}
