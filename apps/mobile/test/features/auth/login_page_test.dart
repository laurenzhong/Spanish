import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/core/auth/auth_repository.dart';
import 'package:spanish_mobile/features/auth/login_page.dart';

class _FakeAuthRepository implements AuthRepository {
  String? requestedEmail;
  String? verifiedEmail;
  String? verifiedToken;
  Object? requestError;

  @override
  Future<void> requestEmailOtp(String email) async {
    if (requestError case final error?) throw error;
    requestedEmail = email;
  }

  @override
  Future<void> verifyEmailOtp({
    required String email,
    required String token,
  }) async {
    verifiedEmail = email;
    verifiedToken = token;
  }

  @override
  Future<void> signInWithPassword({
    required String email,
    required String password,
  }) async {}

  @override
  Future<void> signOut() async {}
}

void main() {
  testWidgets('moves from email entry to six-digit OTP entry', (tester) async {
    final repository = _FakeAuthRepository();
    await tester.pumpWidget(
      MaterialApp(home: LoginPage(repository: repository)),
    );

    await tester.enterText(
      find.byType(TextField).first,
      ' learner@example.test ',
    );
    await tester.tap(find.widgetWithText(FilledButton, '获取验证码'));
    await tester.pump();

    expect(repository.requestedEmail, 'learner@example.test');
    expect(find.text('六位验证码'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, '进入学习'), findsOneWidget);
  });

  testWidgets('shows a stable message when requesting an OTP fails', (
    tester,
  ) async {
    final repository = _FakeAuthRepository()
      ..requestError = StateError('offline');
    await tester.pumpWidget(
      MaterialApp(home: LoginPage(repository: repository)),
    );

    await tester.enterText(
      find.byType(TextField).first,
      'learner@example.test',
    );
    await tester.tap(find.widgetWithText(FilledButton, '获取验证码'));
    await tester.pump();

    expect(find.text('验证码发送失败，请稍后重试。'), findsOneWidget);
  });
}
