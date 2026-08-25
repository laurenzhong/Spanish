import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/core/platform/fake_platform_capabilities.dart';
import 'package:spanish_mobile/core/platform/platform_capabilities.dart';
import 'package:spanish_mobile/features/content/fakes/fake_content_pack.dart';

void main() {
  Widget harness({
    FakeSecureStorage? storage,
    FakeTextToSpeech? textToSpeech,
    VoidCallback? onOpenPractice,
  }) {
    return MaterialApp(
      home: Scaffold(
        body: FakeContentPackExperience(
          storage: storage ?? FakeSecureStorage(),
          textToSpeech: textToSpeech ?? FakeTextToSpeech(),
          onBack: () {},
          onOpenPractice: onOpenPractice ?? () {},
        ),
      ),
    );
  }

  testWidgets('completes listening, reading, typing, transfer and speaking', (
    tester,
  ) async {
    var openedPractice = false;
    await tester.pumpWidget(
      harness(onOpenPractice: () => openedPractice = true),
    );
    await tester.pumpAndSettle();

    expect(find.text('0/5 个步骤'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, '播放全文'));
    await tester.pumpAndSettle();
    expect(find.text('1/5 个步骤'), findsOneWidget);

    await tester.tap(find.widgetWithText(OutlinedButton, '展开西语和中文'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('content-pack-spanish')), findsOneWidget);
    expect(find.text('2/5 个步骤'), findsOneWidget);

    final reply = find.bySemanticsLabel('你的回复');
    await tester.enterText(reply, 'Me gusta conocer gente nueva.');
    await tester.pump();
    final typingButton = find.widgetWithText(FilledButton, '完成这一步');
    expect(tester.widget<FilledButton>(typingButton).onPressed, isNotNull);
    await tester.ensureVisible(typingButton);
    await tester.tap(typingButton);
    await tester.pumpAndSettle();
    expect(find.text('3/5 个步骤'), findsOneWidget);

    final transfer = find.bySemanticsLabel('你的新情境');
    await tester.enterText(transfer, 'En clase quiero hablar de música.');
    await tester.pump();
    final transferButton = find.widgetWithText(FilledButton, '完成迁移');
    expect(tester.widget<FilledButton>(transferButton).onPressed, isNotNull);
    await tester.ensureVisible(transferButton);
    await tester.tap(transferButton);
    await tester.pumpAndSettle();
    expect(find.text('4/5 个步骤'), findsOneWidget);

    final speakingButton = find.widgetWithText(FilledButton, '进入口语复核');
    await tester.ensureVisible(speakingButton);
    await tester.tap(speakingButton);
    await tester.pumpAndSettle();
    expect(openedPractice, isTrue);
    expect(find.text('5/5 个步骤'), findsOneWidget);
  });

  testWidgets('reports TTS fallback while keeping listening progress', (
    tester,
  ) async {
    final tts = FakeTextToSpeech(
      speakFailure: const PlatformCapabilityException(
        PlatformCapabilityErrorCode.ttsFailed,
        'unavailable',
      ),
    );
    await tester.pumpWidget(harness(textToSpeech: tts));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, '播放全文'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('content-pack-notice')), findsOneWidget);
    expect(find.text('1/5 个步骤'), findsOneWidget);
  });

  testWidgets('restores completed steps and both drafts from secure storage', (
    tester,
  ) async {
    final storage = FakeSecureStorage();
    await storage.write(
      'content-pack-progress:v1:immersive.first-cafe-conversation',
      jsonEncode(<String, Object?>{
        'completed': <int>[0, 1],
        'draft': 'Me gusta viajar con amigos.',
        'transferDraft': 'En la universidad hablo de cine.',
      }),
    );
    await tester.pumpWidget(harness(storage: storage));
    await tester.pumpAndSettle();

    expect(find.text('2/5 个步骤'), findsOneWidget);
    expect(
      find
          .byType(TextField)
          .evaluate()
          .map((element) => (element.widget as TextField).controller?.text)
          .contains('Me gusta viajar con amigos.'),
      isTrue,
    );
    expect(
      find
          .byType(TextField)
          .evaluate()
          .map((element) => (element.widget as TextField).controller?.text)
          .contains('En la universidad hablo de cine.'),
      isTrue,
    );
  });
}
