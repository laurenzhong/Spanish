import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/core/platform/fake_platform_capabilities.dart';
import 'package:spanish_mobile/core/platform/platform_capabilities.dart';
import 'package:spanish_mobile/features/training/checkpoints/training_checkpoint.dart';
import 'package:spanish_mobile/features/training/fakes/fake_training_loop.dart';

void main() {
  testWidgets('reaches output selection and completes a typed natural alternative', (
    tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: FakeTrainingLoop()));
    await tester.pump(const Duration(milliseconds: 220));

    expect(find.text('轮到你了'), findsOneWidget);
    await tester.tap(find.text('用文字回答'));
    await tester.pump();
    await tester.enterText(find.byType(TextField), '¿Qué tal todo?');
    await tester.pump();
    await tester.ensureVisible(find.text('提交文字回答'));
    await tester.tap(find.widgetWithText(FilledButton, '提交文字回答'));
    await tester.pumpAndSettle();

    expect(find.text('对方可以接住你的意思'), findsOneWidget);
    await tester.ensureVisible(find.text('完成这句'));
    await tester.tap(find.widgetWithText(FilledButton, '完成这句'));
    await tester.pump();
    expect(find.text('这句练习完成了'), findsOneWidget);
  });

  testWidgets('restores the last stable state without replaying playback', (
    tester,
  ) async {
    final storage = FakeSecureStorage();
    final store = SecureStorageTrainingCheckpointStore(storage, userId: 'user');
    await tester.pumpWidget(MaterialApp(home: FakeTrainingLoop(checkpointStore: store)));
    await tester.pump(const Duration(milliseconds: 220));
    expect(find.text('轮到你了'), findsOneWidget);

    await tester.pumpWidget(MaterialApp(home: FakeTrainingLoop(checkpointStore: store)));
    await tester.pump();
    expect(find.text('轮到你了'), findsOneWidget);
  });

  testWidgets('falls back to typing when microphone permission is denied', (
    tester,
  ) async {
    final recorder = FakeAudioRecorder(
      startFailure: const PlatformCapabilityException(
        PlatformCapabilityErrorCode.microphonePermissionDenied,
        'denied',
      ),
    );
    await tester.pumpWidget(
      MaterialApp(home: FakeTrainingLoop(recorder: recorder)),
    );
    await tester.pump(const Duration(milliseconds: 220));

    expect(find.text('轮到你了'), findsOneWidget);
    await tester.tap(find.text('开始录音'));
    await tester.pump();

    expect(find.text('麦克风暂时不可用，已切换为文字回答。'), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget);
  });

  testWidgets('shows progressive hints and moves to a real variant prompt', (
    tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: FakeTrainingLoop()));
    await tester.pump(const Duration(milliseconds: 220));

    await tester.ensureVisible(find.text('提示 1'));
    await tester.tap(find.text('提示 1'));
    await tester.pump();
    expect(find.textContaining('先决定你想表达的近况'), findsOneWidget);
    await tester.ensureVisible(find.text('提示 2'));
    await tester.tap(find.text('提示 2'));
    await tester.pump();
    expect(find.textContaining('bien'), findsOneWidget);
    await tester.ensureVisible(find.text('提示 3'));
    await tester.tap(find.text('提示 3'));
    await tester.pump();
    expect(find.textContaining('句式骨架'), findsOneWidget);

    await tester.ensureVisible(find.text('用文字回答'));
    await tester.tap(find.text('用文字回答'));
    await tester.pump();
    await tester.ensureVisible(find.byType(TextField));
    await tester.enterText(find.byType(TextField), 'Bien, gracias.');
    await tester.pump();
    await tester.ensureVisible(find.widgetWithText(FilledButton, '提交文字回答'));
    await tester.tap(find.widgetWithText(FilledButton, '提交文字回答'));
    await tester.pumpAndSettle();
    expect(find.text('对方可以接住你的意思'), findsOneWidget);

    await tester.ensureVisible(find.text('练习变式'));
    await tester.tap(find.text('练习变式'));
    await tester.pumpAndSettle();
    expect(find.text('¿Qué tal todo?'), findsOneWidget);
    expect(find.text('变式情境'), findsOneWidget);
    expect(find.text('轮到你了'), findsOneWidget);
  });
}
