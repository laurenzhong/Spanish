import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/app.dart';
import 'package:spanish_mobile/core/auth/auth_session.dart';

class _AuthenticatedSessionSource implements AuthSessionSource {
  static final snapshot = AuthSessionSnapshot(
    userId: '00000000-0000-4000-8000-000000000001',
    accessToken: 'access-token',
    expiresAt: DateTime.utc(2099),
  );

  @override
  AuthSessionSnapshot? get currentSession => snapshot;

  @override
  Stream<AuthSessionEvent> get events => const Stream.empty();

  @override
  Stream<AuthSessionSnapshot?> get sessions => const Stream.empty();

  @override
  Future<void> refreshSession() async {}
}

void main() {
  testWidgets('starts on learning with one primary action', (tester) async {
    await tester.pumpWidget(
      SpanishApp(authSessionSource: _AuthenticatedSessionSource()),
    );

    expect(find.text('问候后自然继续交流'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, '继续学习'), findsOneWidget);
    expect(find.textContaining('分钟'), findsNothing);
    expect(find.textContaining('模式'), findsNothing);
    expect(find.byType(NavigationBar), findsOneWidget);
  });

  testWidgets('reaches all four product areas from mobile navigation', (
    tester,
  ) async {
    await tester.pumpWidget(
      SpanishApp(authSessionSource: _AuthenticatedSessionSource()),
    );

    for (final destination in <String, String>{
      '探索': '探索真实表达',
      '对话': '你的西语好友',
      '我的': '我的进步',
      '学习': '问候后自然继续交流',
    }.entries) {
      await tester.tap(find.text(destination.key).last);
      await tester.pumpAndSettle();
      expect(find.text(destination.value), findsOneWidget);
    }
  });

  testWidgets('uses a navigation rail on wide screens', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      SpanishApp(authSessionSource: _AuthenticatedSessionSource()),
    );

    expect(find.byType(NavigationRail), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
    expect(find.text('问候后自然继续交流'), findsOneWidget);
  });

  testWidgets('shows email login when there is no authenticated session', (
    tester,
  ) async {
    await tester.pumpWidget(const SpanishApp());

    expect(find.text('用邮箱接收验证码'), findsOneWidget);
    expect(find.text('当前构建尚未配置 Supabase Auth。'), findsOneWidget);
    expect(find.text('问候后自然继续交流'), findsNothing);
  });
}
