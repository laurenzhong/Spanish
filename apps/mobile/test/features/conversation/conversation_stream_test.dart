import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/features/conversation/data/conversation_stream.dart';
import 'package:spanish_mobile/features/conversation/ui/chat_thread.dart';

class _RetryAfterEarlyFailureClient implements ConversationStreamClient {
  var attempts = 0;

  @override
  Stream<String> streamReply({
    required String text,
    required String clientMessageId,
    required String generationId,
  }) async* {
    attempts += 1;
    if (attempts == 1) {
      yield '${jsonEncode(<String, Object?>{'type': 'error', 'generationId': generationId, 'messageId': null, 'code': 'stream-failed', 'retryable': true})}\n';
      return;
    }
    yield '${jsonEncode(<String, Object?>{'type': 'meta', 'protocolVersion': 'v1', 'characterKey': 'lucia', 'characterVersion': 1, 'generationId': generationId, 'messageId': 'retry-message'})}\n';
    yield '${jsonEncode(<String, Object?>{'type': 'delta', 'generationId': generationId, 'messageId': 'retry-message', 'text': '¡Hola de nuevo!'})}\n';
    yield '${jsonEncode(<String, Object?>{'type': 'done', 'generationId': generationId, 'messageId': 'retry-message'})}\n';
  }
}

class _StopAndRetryClient implements ConversationStreamClient {
  var attempts = 0;

  @override
  Stream<String> streamReply({
    required String text,
    required String clientMessageId,
    required String generationId,
  }) async* {
    attempts += 1;
    if (attempts == 1) {
      await Future<void>.delayed(const Duration(seconds: 1));
      return;
    }
    yield '${jsonEncode(<String, Object?>{'type': 'meta', 'protocolVersion': 'v1', 'characterKey': 'lucia', 'characterVersion': 1, 'generationId': generationId, 'messageId': 'stopped-message'})}\n';
    yield '${jsonEncode(<String, Object?>{'type': 'delta', 'generationId': generationId, 'messageId': 'stopped-message', 'text': 'Seguimos hablando.'})}\n';
    yield '${jsonEncode(<String, Object?>{'type': 'done', 'generationId': generationId, 'messageId': 'stopped-message'})}\n';
  }
}

void main() {
  test('parses events split at arbitrary chunk boundaries', () {
    final lines = <Map<String, Object?>>[
      <String, Object?>{
        'type': 'meta',
        'protocolVersion': 'v1',
        'characterKey': 'lucia',
        'characterVersion': 1,
        'generationId': 'g1',
        'messageId': 'm1',
      },
      <String, Object?>{
        'type': 'delta',
        'generationId': 'g1',
        'messageId': 'm1',
        'text': 'Hola',
      },
      <String, Object?>{
        'type': 'done',
        'generationId': 'g1',
        'messageId': 'm1',
      },
    ].map((line) => '${jsonEncode(line)}\n').join();
    final parser = ConversationStreamParser();
    final events = <ConversationStreamEvent>[];
    for (var index = 0; index < lines.length; index++) {
      events.addAll(parser.push(lines[index]));
    }
    events.addAll(parser.finish());
    expect(events.map((event) => event.type), <ConversationStreamEventType>[
      ConversationStreamEventType.meta,
      ConversationStreamEventType.delta,
      ConversationStreamEventType.done,
    ]);
  });

  test('does not invent done when the stream ends without it', () {
    final parser = ConversationStreamParser();
    parser.push(
      '${jsonEncode(<String, Object?>{'type': 'meta', 'protocolVersion': 'v1', 'characterKey': 'lucia', 'characterVersion': 1, 'generationId': 'g1', 'messageId': 'm1'})}\n',
    );
    parser.push(
      '${jsonEncode(<String, Object?>{'type': 'delta', 'generationId': 'g1', 'messageId': 'm1', 'text': 'Parcial'})}\n',
    );
    expect(parser.finish(), isEmpty);
  });

  testWidgets('sends a message through the fake stream', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: ConversationChatThread())),
    );
    await tester.enterText(find.byType(TextField), 'Hola');
    await tester.tap(find.byTooltip('发送消息'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.textContaining('Qué alegría'), findsOneWidget);
  });

  testWidgets('voice stop falls back to typing without a transcript', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ConversationChatThread(
            client: const FakeConversationStreamClient(),
          ),
        ),
      ),
    );
    await tester.tap(find.byTooltip('使用语音输入'));
    await tester.pump();
    await tester.tap(find.byTooltip('停止录音'));
    await tester.pump();
    expect(find.textContaining('没有可验证的语音转写'), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget);
  });

  testWidgets('offers retry when the stream fails before meta', (tester) async {
    final client = _RetryAfterEarlyFailureClient();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: ConversationChatThread(client: client)),
      ),
    );
    await tester.enterText(find.byType(TextField), 'Hola');
    await tester.tap(find.byTooltip('发送消息'));
    await tester.pump();

    expect(find.text('发送失败'), findsOneWidget);
    expect(find.text('重新发送'), findsOneWidget);
    await tester.tap(find.text('重新发送'));
    await tester.pump();
    expect(find.textContaining('¡Hola de nuevo!'), findsOneWidget);
    expect(find.text('Hola'), findsOneWidget);
  });

  testWidgets(
    'stops before the first event and retries without duplicating the user message',
    (tester) async {
      final client = _StopAndRetryClient();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: ConversationChatThread(client: client)),
        ),
      );
      await tester.enterText(find.byType(TextField), 'Hola');
      await tester.tap(find.byTooltip('发送消息'));
      await tester.pump();
      await tester.tap(find.text('停止回复'));
      await tester.pump();

      expect(find.text('已停止'), findsOneWidget);
      await tester.tap(find.text('重新发送'));
      await tester.pump();
      expect(find.textContaining('Seguimos hablando.'), findsOneWidget);
      expect(find.text('Hola'), findsOneWidget);
      await tester.pump(const Duration(seconds: 1));
    },
  );
}
