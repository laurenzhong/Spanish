import 'dart:async';

import 'package:flutter/material.dart';

import '../data/conversation_stream.dart';
import 'voice_composer.dart';

class ConversationChatThread extends StatefulWidget {
  const ConversationChatThread({this.client, super.key});

  final ConversationStreamClient? client;

  @override
  State<ConversationChatThread> createState() => _ConversationChatThreadState();
}

class _ConversationMessage {
  _ConversationMessage({required this.id, required this.role, required this.text, this.complete = true, this.clientMessageId});

  final String id;
  final String role;
  String text;
  bool complete;
  final String? clientMessageId;
}

class _ConversationChatThreadState extends State<ConversationChatThread> {
  late final ConversationStreamClient _client;
  final _messages = <_ConversationMessage>[];
  StreamSubscription<String>? _subscription;
  String? _activeGeneration;
  String? _activeMessage;
  String? _retryText;
  String _status = 'idle';
  int _sequence = 0;

  @override
  void initState() {
    super.initState();
    _client = widget.client ?? const FakeConversationStreamClient();
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    super.dispose();
  }

  String _id(String prefix) => '$prefix-${++_sequence}';

  void _submit(String text) {
    if (_status == 'streaming') return;
    final clientMessageId = _id('client');
    final generationId = _id('generation');
    setState(() => _messages.add(_ConversationMessage(id: clientMessageId, role: 'user', text: text, clientMessageId: clientMessageId)));
    _start(text, clientMessageId, generationId);
  }

  void _retry() {
    final text = _retryText;
    if (text == null || _status == 'streaming') return;
    final generationId = _id('generation');
    final user = _messages.lastWhere((message) => message.role == 'user', orElse: () => _ConversationMessage(id: '', role: 'user', text: ''));
    _start(text, user.clientMessageId ?? user.id, generationId);
  }

  void _start(String text, String clientMessageId, String generationId) {
    unawaited(_subscription?.cancel());
    setState(() { _status = 'streaming'; _activeGeneration = generationId; _activeMessage = null; _retryText = null; });
    final parser = ConversationStreamParser();
    _subscription = _client.streamReply(text: text, clientMessageId: clientMessageId, generationId: generationId).listen(
      (chunk) {
        for (final event in parser.push(chunk)) {
          _apply(_withGeneration(event, generationId));
        }
      },
      onError: (_) {
        if (mounted && generationId == _activeGeneration) setState(() { _status = 'failed'; _retryText = text; });
      },
      onDone: () {
        for (final event in parser.finish()) {
          _apply(_withGeneration(event, generationId));
        }
        if (mounted && generationId == _activeGeneration && _status == 'streaming') setState(() { _status = 'failed'; _retryText = text; });
      },
    );
  }

  ConversationStreamEvent _withGeneration(ConversationStreamEvent event, String generationId) {
    if (event.generationId != 'unknown') return event;
    return ConversationErrorEvent(code: ConversationStreamErrorCode.streamFailed, messageId: null, retryable: true, generationId: generationId);
  }

  void _apply(ConversationStreamEvent event) {
    if (!mounted || event.generationId != _activeGeneration) return;
    switch (event) {
      case ConversationMetaEvent():
        _activeMessage = event.messageId;
        _messages.add(_ConversationMessage(id: event.messageId, role: 'character', text: '', complete: false));
        setState(() {});
      case ConversationDeltaEvent():
        if (event.messageId != _activeMessage) return;
        final message = _messages.firstWhere((item) => item.id == event.messageId);
        setState(() => message.text += event.text);
      case ConversationDoneEvent():
        if (event.messageId != _activeMessage) return;
        final message = _messages.firstWhere((item) => item.id == event.messageId);
        setState(() { message.complete = true; _status = 'completed'; });
      case ConversationErrorEvent():
        setState(() { _status = event.code == ConversationStreamErrorCode.streamAborted ? 'cancelled' : 'failed'; _retryText = _messages.lastWhere((item) => item.role == 'user', orElse: () => _ConversationMessage(id: '', role: 'user', text: '')).text; });
    }
  }

  void _cancel() {
    if (_activeGeneration == null) return;
    unawaited(_subscription?.cancel());
    setState(() => _status = 'cancelled');
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final streaming = _status == 'streaming';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: <Widget>[
            const CircleAvatar(radius: 28, backgroundColor: Color(0xFFFFD4B9), foregroundColor: Color(0xFF67442F), child: Text('L', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 19))),
            const SizedBox(width: 12),
            const Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[Text('Lucía Martín', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)), SizedBox(height: 3), Text('Madrid · 文字交流')])),
            Text(_status == 'streaming' ? '正在回复' : _status == 'failed' ? '发送失败' : _status == 'cancelled' ? '已停止' : '在线', style: TextStyle(color: streaming ? colors.primary : colors.onSurfaceVariant, fontSize: 12)),
          ],
        ),
        const SizedBox(height: 18),
        Container(
          constraints: const BoxConstraints(minHeight: 380),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: colors.surfaceContainerLowest, border: Border.all(color: colors.outlineVariant), borderRadius: BorderRadius.circular(18)),
          child: _messages.isEmpty
              ? const Center(child: Text('¡Hola! Puedes contarme lo que quieras.'))
              : ListView.separated(
                  shrinkWrap: true,
                  itemCount: _messages.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (context, index) {
                    final message = _messages[index];
                    final isUser = message.role == 'user';
                    return Align(
                      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 520),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        decoration: BoxDecoration(color: isUser ? colors.primary : colors.surface, border: Border.all(color: isUser ? colors.primary : colors.outlineVariant), borderRadius: BorderRadius.circular(14)),
                        child: Text(message.text.isEmpty ? '…' : message.text, style: TextStyle(color: isUser ? colors.onPrimary : colors.onSurface, height: 1.5)),
                      ),
                    );
                  },
                ),
        ),
        if (_status == 'failed' || _status == 'cancelled') ...<Widget>[
          const SizedBox(height: 10),
          Row(children: <Widget>[Expanded(child: Text(_status == 'cancelled' ? '回复已停止，已保留目前收到的内容。' : '这次回复没有完整送达，未产生任何学习评分。')), TextButton(onPressed: _retryText == null ? null : _retry, child: const Text('重新发送'))]),
        ],
        const SizedBox(height: 12),
        ConversationVoiceComposer(disabled: streaming, onSubmit: _submit),
        if (streaming) Align(alignment: Alignment.centerRight, child: TextButton(onPressed: _cancel, child: const Text('停止回复'))),
      ],
    );
  }
}
