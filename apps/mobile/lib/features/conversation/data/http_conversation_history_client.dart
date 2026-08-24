import 'dart:convert';

import 'package:spanish_mobile/core/auth/authenticated_api_client.dart';

import 'conversation_stream.dart';

class HttpConversationHistoryClient implements ConversationHistoryClient {
  HttpConversationHistoryClient(this._client, {this.characterKey = 'lucia'});

  final AuthenticatedApiClient _client;
  final String characterKey;

  @override
  Future<List<ConversationHistoryMessage>> loadHistory() async {
    final response = await _client.get('/api/v1/conversations/$characterKey');
    if (response.statusCode != 200) throw StateError('conversation history unavailable');
    final decoded = jsonDecode(response.body);
    final data = decoded is Map<String, dynamic> ? decoded['data'] : null;
    final rawMessages = data is Map<String, dynamic> ? data['messages'] : null;
    if (rawMessages is! List) return <ConversationHistoryMessage>[];
    return rawMessages.whereType<Map<String, dynamic>>().map((message) => ConversationHistoryMessage(
      id: message['id'] as String,
      role: message['role'] as String,
      text: message['text'] as String,
      complete: message['complete'] == true,
      clientMessageId: message['clientMessageId'] as String?,
      generationId: message['generationId'] as String?,
    )).toList(growable: false);
  }
}
