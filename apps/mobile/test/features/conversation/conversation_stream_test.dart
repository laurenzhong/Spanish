import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/features/conversation/data/conversation_stream.dart';
import 'package:spanish_mobile/features/conversation/ui/chat_thread.dart';

void main() {
  test('parses events split at arbitrary chunk boundaries', () {
    final lines = <Map<String, Object?>>[
      <String, Object?>{'type': 'meta', 'protocolVersion': 'v1', 'characterKey': 'lucia', 'characterVersion': 1, 'generationId': 'g1', 'messageId': 'm1'},
      <String, Object?>{'type': 'delta', 'generationId': 'g1', 'messageId': 'm1', 'text': 'Hola'},
      <String, Object?>{'type': 'done', 'generationId': 'g1', 'messageId': 'm1'},
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
    parser.push('${jsonEncode(<String, Object?>{'type': 'meta', 'protocolVersion': 'v1', 'characterKey': 'lucia', 'characterVersion': 1, 'generationId': 'g1', 'messageId': 'm1'})}\n');
    parser.push('${jsonEncode(<String, Object?>{'type': 'delta', 'generationId': 'g1', 'messageId': 'm1', 'text': 'Parcial'})}\n');
    expect(parser.finish(), isEmpty);
  });

  testWidgets('sends a message through the fake stream', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: ConversationChatThread())));
    await tester.enterText(find.byType(TextField), 'Hola');
    await tester.tap(find.byTooltip('发送消息'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.textContaining('Qué alegría'), findsOneWidget);
  });

  testWidgets('voice stop falls back to typing without a transcript', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ConversationChatThread(client: const FakeConversationStreamClient()))));
    await tester.tap(find.byTooltip('使用语音输入'));
    await tester.pump();
    await tester.tap(find.byTooltip('停止录音'));
    await tester.pump();
    expect(find.textContaining('没有可验证的语音转写'), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget);
  });
}
