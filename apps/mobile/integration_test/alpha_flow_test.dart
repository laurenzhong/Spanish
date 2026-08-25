import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:spanish_mobile/app.dart';
import 'package:spanish_mobile/core/auth/auth_repository.dart';
import 'package:spanish_mobile/core/auth/auth_session.dart';
import 'package:spanish_mobile/core/platform/fake_platform_capabilities.dart';
import 'package:spanish_mobile/core/platform/platform_capabilities.dart';
import 'package:spanish_mobile/features/conversation/data/conversation_stream.dart';
import 'package:spanish_mobile/features/conversation/ui/chat_thread.dart';
import 'package:spanish_mobile/features/training/checkpoints/training_checkpoint.dart';
import 'package:spanish_mobile/features/training/fakes/fake_training_loop.dart';

class _FakeSessionSource implements AuthSessionSource {
  _FakeSessionSource();

  AuthSessionSnapshot? _session;
  final _controller = StreamController<AuthSessionSnapshot?>.broadcast();

  @override
  AuthSessionSnapshot? get currentSession => _session;

  @override
  Stream<AuthSessionSnapshot?> get sessions => _controller.stream;

  @override
  Stream<AuthSessionEvent> get events => const Stream<AuthSessionEvent>.empty();

  void signIn(String userId) {
    _session = AuthSessionSnapshot(
      userId: userId,
      accessToken: 'fake-access-token',
      expiresAt: DateTime.utc(2099),
    );
    _controller.add(_session);
  }

  @override
  Future<void> refreshSession() async {}

  Future<void> dispose() => _controller.close();
}

class _FakeAuthRepository implements AuthRepository {
  _FakeAuthRepository(this.source);

  final _FakeSessionSource source;
  var otpRequested = false;

  @override
  Future<void> requestEmailOtp(String email) async {
    if (email.trim().isEmpty) throw StateError('email-required');
    otpRequested = true;
  }

  @override
  Future<void> verifyEmailOtp({
    required String email,
    required String token,
  }) async {
    if (!otpRequested || token != '123456') throw StateError('invalid-otp');
    source.signIn('integration-user');
  }

  @override
  Future<void> signInWithPassword({
    required String email,
    required String password,
  }) async {
    source.signIn('integration-user');
  }

  @override
  Future<void> signOut() async {}
}

class _FailThenSucceedConversationClient implements ConversationStreamClient {
  var attempts = 0;

  @override
  Stream<String> streamReply({
    required String text,
    required String clientMessageId,
    required String generationId,
  }) async* {
    attempts += 1;
    const messageId = 'integration-lucia-message';
    yield '${jsonEncode(<String, Object?>{'type': 'meta', 'protocolVersion': 'v1', 'characterKey': 'lucia', 'characterVersion': 1, 'generationId': generationId, 'messageId': messageId})}\n';
    yield '${jsonEncode(<String, Object?>{'type': 'delta', 'generationId': generationId, 'messageId': messageId, 'text': attempts == 1 ? 'Parcial' : '¡Hola! Qué alegría leerte.'})}\n';
    if (attempts > 1) {
      yield '${jsonEncode(<String, Object?>{'type': 'done', 'generationId': generationId, 'messageId': messageId})}\n';
    }
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'logs in through the fake OTP flow and opens the learning shell',
    (tester) async {
      final source = _FakeSessionSource();
      final repository = _FakeAuthRepository(source);
      addTearDown(source.dispose);

      await tester.pumpWidget(
        SpanishApp(authSessionSource: source, authRepository: repository),
      );
      expect(find.text('用邮箱接收验证码'), findsOneWidget);

      await tester.enterText(
        find.byType(TextField).first,
        'alpha@example.test',
      );
      await tester.tap(find.widgetWithText(FilledButton, '获取验证码'));
      await tester.pumpAndSettle();
      expect(find.text('六位验证码'), findsOneWidget);

      await tester.enterText(find.byType(TextField).last, '123456');
      await tester.tap(find.widgetWithText(FilledButton, '进入学习'));
      await tester.pumpAndSettle();
      expect(find.text('问候后自然继续交流'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, '继续学习'), findsOneWidget);
    },
  );

  testWidgets('runs training with three hints and microphone denial fallback', (
    tester,
  ) async {
    final recorder = FakeAudioRecorder(
      startFailure: const PlatformCapabilityException(
        PlatformCapabilityErrorCode.microphonePermissionDenied,
        'denied',
      ),
    );
    final storage = FakeSecureStorage();
    final checkpointStore = SecureStorageTrainingCheckpointStore(
      storage,
      userId: 'integration-user',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: FakeTrainingLoop(
          recorder: recorder,
          checkpointStore: checkpointStore,
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 220));
    expect(find.text('轮到你了'), findsOneWidget);

    for (final level in <int>[1, 2, 3]) {
      await tester.tap(find.text('提示 $level'));
      await tester.pump();
    }
    expect(find.text('提示 3/3'), findsOneWidget);

    await tester.tap(find.text('开始录音'));
    await tester.pump();
    expect(find.text('麦克风暂时不可用，已切换为文字回答。'), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget);

    await tester.enterText(find.byType(TextField), '¿Qué tal todo?');
    await tester.tap(find.widgetWithText(FilledButton, '提交文字回答'));
    await tester.pumpAndSettle();
    expect(find.text('对方可以接住你的意思'), findsOneWidget);
    expect(find.text('自然的相近表达也算成功。'), findsOneWidget);
  });

  testWidgets(
    'retries an incomplete Lucía fake stream without inventing completion',
    (tester) async {
      final client = _FailThenSucceedConversationClient();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: ConversationChatThread(client: client)),
        ),
      );

      await tester.enterText(find.byType(TextField), 'Hola, Lucía');
      await tester.tap(find.byTooltip('发送消息'));
      await tester.pumpAndSettle();
      expect(find.text('Parcial'), findsOneWidget);
      expect(find.text('发送失败'), findsOneWidget);
      expect(find.text('这次回复没有完整送达，未产生任何学习评分。'), findsOneWidget);

      await tester.tap(find.text('重新发送'));
      await tester.pumpAndSettle();
      expect(client.attempts, 2);
      expect(find.text('Qué alegría'), findsOneWidget);
      expect(find.text('已送达'), findsOneWidget);
      expect(find.text('这次回复没有完整送达，未产生任何学习评分。'), findsNothing);
    },
  );
}
