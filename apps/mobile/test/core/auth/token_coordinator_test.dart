import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/core/auth/auth_session.dart';
import 'package:spanish_mobile/core/auth/token_coordinator.dart';

class _FakeSessionSource implements AuthSessionSource {
  _FakeSessionSource(this.session);

  AuthSessionSnapshot? session;
  int refreshCount = 0;
  Future<void> Function()? onRefresh;
  final eventController = StreamController<AuthSessionEvent>.broadcast();
  final sessionController = StreamController<AuthSessionSnapshot?>.broadcast();

  @override
  AuthSessionSnapshot? get currentSession => session;

  @override
  Stream<AuthSessionEvent> get events => eventController.stream;

  @override
  Stream<AuthSessionSnapshot?> get sessions => sessionController.stream;

  @override
  Future<void> refreshSession() async {
    refreshCount++;
    await onRefresh?.call();
  }

  void update(AuthSessionSnapshot? next, AuthSessionEvent event) {
    session = next;
    eventController.add(event);
    sessionController.add(next);
  }

  Future<void> close() async {
    await eventController.close();
    await sessionController.close();
  }
}

AuthSessionSnapshot _session(
  String token,
  DateTime expiresAt, {
  String userId = 'user-a',
}) {
  return AuthSessionSnapshot(
    userId: userId,
    accessToken: token,
    expiresAt: expiresAt,
  );
}

void main() {
  final now = DateTime.utc(2026, 8, 20, 12);

  test(
    'returns a token outside the expiry safety window without refresh',
    () async {
      final source = _FakeSessionSource(
        _session('current', now.add(const Duration(minutes: 5))),
      );
      final coordinator = AccessTokenCoordinator(source, now: () => now);
      addTearDown(() async {
        await coordinator.dispose();
        await source.close();
      });

      expect(await coordinator.requireValidAccessToken(), 'current');
      expect(source.refreshCount, 0);
    },
  );

  test('shares one refresh across concurrent callers', () async {
    final source = _FakeSessionSource(_session('expired', now));
    final release = Completer<void>();
    source.onRefresh = () async {
      await release.future;
      source.update(
        _session('fresh', now.add(const Duration(minutes: 5))),
        AuthSessionEvent.tokenRefreshed,
      );
    };
    final coordinator = AccessTokenCoordinator(source, now: () => now);
    addTearDown(() async {
      await coordinator.dispose();
      await source.close();
    });

    final first = coordinator.requireValidAccessToken();
    final second = coordinator.requireValidAccessToken();
    await Future<void>.delayed(Duration.zero);
    expect(source.refreshCount, 1);

    release.complete();
    expect(await Future.wait([first, second]), ['fresh', 'fresh']);
  });

  test('discards a refresh result after the identity changes', () async {
    final source = _FakeSessionSource(_session('expired', now));
    final release = Completer<void>();
    source.onRefresh = () => release.future;
    final coordinator = AccessTokenCoordinator(source, now: () => now);
    addTearDown(() async {
      await coordinator.dispose();
      await source.close();
    });

    final result = coordinator.requireValidAccessToken();
    await Future<void>.delayed(Duration.zero);
    source.update(
      _session(
        'other-user-token',
        now.add(const Duration(minutes: 5)),
        userId: 'user-b',
      ),
      AuthSessionEvent.identityChanged,
    );
    release.complete();

    await expectLater(
      result,
      throwsA(
        isA<TokenGateException>().having(
          (error) => error.reason,
          'reason',
          TokenGateFailure.identityChanged,
        ),
      ),
    );
  });

  test('distinguishes no session from a temporary refresh failure', () async {
    final signedOut = _FakeSessionSource(null);
    final signedOutCoordinator = AccessTokenCoordinator(
      signedOut,
      now: () => now,
    );
    addTearDown(() async {
      await signedOutCoordinator.dispose();
      await signedOut.close();
    });

    await expectLater(
      signedOutCoordinator.requireValidAccessToken(),
      throwsA(
        isA<TokenGateException>().having(
          (error) => error.reason,
          'reason',
          TokenGateFailure.notSignedIn,
        ),
      ),
    );

    final failing = _FakeSessionSource(_session('expired', now))
      ..onRefresh = () => Future<void>.error(StateError('offline'));
    final failingCoordinator = AccessTokenCoordinator(failing, now: () => now);
    addTearDown(() async {
      await failingCoordinator.dispose();
      await failing.close();
    });

    await expectLater(
      failingCoordinator.requireValidAccessToken(),
      throwsA(
        isA<TokenGateException>().having(
          (error) => error.reason,
          'reason',
          TokenGateFailure.temporarilyUnavailable,
        ),
      ),
    );
  });

  test('maps a refresh timeout to temporary unavailability', () async {
    final source = _FakeSessionSource(_session('expired', now));
    final release = Completer<void>();
    source.onRefresh = () => release.future;
    final coordinator = AccessTokenCoordinator(
      source,
      now: () => now,
      refreshTimeout: const Duration(milliseconds: 5),
    );
    addTearDown(() async {
      if (!release.isCompleted) release.complete();
      await coordinator.dispose();
      await source.close();
    });

    await expectLater(
      coordinator.requireValidAccessToken(),
      throwsA(
        isA<TokenGateException>().having(
          (error) => error.reason,
          'reason',
          TokenGateFailure.temporarilyUnavailable,
        ),
      ),
    );
  });

  test(
    'discards an in-flight refresh after the coordinator is disposed',
    () async {
      final source = _FakeSessionSource(_session('expired', now));
      final release = Completer<void>();
      source.onRefresh = () async {
        await release.future;
        source.update(
          _session('late-token', now.add(const Duration(minutes: 5))),
          AuthSessionEvent.tokenRefreshed,
        );
      };
      final coordinator = AccessTokenCoordinator(source, now: () => now);

      final result = coordinator.requireValidAccessToken();
      await Future<void>.delayed(Duration.zero);
      await coordinator.dispose();
      release.complete();

      await expectLater(
        result,
        throwsA(
          isA<TokenGateException>().having(
            (error) => error.reason,
            'reason',
            TokenGateFailure.identityChanged,
          ),
        ),
      );
      await source.close();
    },
  );

  test('does not issue a still-valid token after disposal', () async {
    final source = _FakeSessionSource(
      _session('current', now.add(const Duration(minutes: 5))),
    );
    final coordinator = AccessTokenCoordinator(source, now: () => now);
    await coordinator.dispose();

    await expectLater(
      coordinator.requireValidAccessToken(),
      throwsA(
        isA<TokenGateException>().having(
          (error) => error.reason,
          'reason',
          TokenGateFailure.identityChanged,
        ),
      ),
    );
    await source.close();
  });
}
