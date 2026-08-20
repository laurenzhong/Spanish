import 'dart:async';

import 'auth_session.dart';

enum TokenGateFailure { notSignedIn, identityChanged, temporarilyUnavailable }

class TokenGateException implements Exception {
  const TokenGateException(this.reason, [this.cause]);

  final TokenGateFailure reason;
  final Object? cause;
}

class AccessTokenCoordinator {
  AccessTokenCoordinator(
    this._source, {
    DateTime Function()? now,
    this.expirySafetyWindow = const Duration(seconds: 60),
    this.refreshTimeout = const Duration(seconds: 15),
  }) : _now = now ?? DateTime.now {
    _eventSubscription = _source.events.listen(_handleAuthEvent);
  }

  final AuthSessionSource _source;
  final DateTime Function() _now;
  final Duration expirySafetyWindow;
  final Duration refreshTimeout;
  late final StreamSubscription<AuthSessionEvent> _eventSubscription;
  Future<void>? _refreshInFlight;
  int _identityGeneration = 0;
  bool _disposed = false;

  Future<String> requireValidAccessToken({bool forceRefresh = false}) async {
    if (_disposed) {
      throw const TokenGateException(TokenGateFailure.identityChanged);
    }
    final before = _source.currentSession;
    if (before == null) {
      throw const TokenGateException(TokenGateFailure.notSignedIn);
    }

    final generation = _identityGeneration;
    if (!forceRefresh && _isUsable(before)) {
      return before.accessToken;
    }

    final refresh = _refreshInFlight ?? _refreshSession();
    _refreshInFlight = refresh;
    try {
      await refresh.timeout(refreshTimeout);
    } on TimeoutException catch (error) {
      throw TokenGateException(TokenGateFailure.temporarilyUnavailable, error);
    } catch (error) {
      if (_source.currentSession == null) {
        throw TokenGateException(TokenGateFailure.notSignedIn, error);
      }
      throw TokenGateException(TokenGateFailure.temporarilyUnavailable, error);
    }

    final after = _source.currentSession;
    if (_disposed ||
        generation != _identityGeneration ||
        after == null ||
        after.userId != before.userId) {
      throw const TokenGateException(TokenGateFailure.identityChanged);
    }
    if (!_isUsable(after)) {
      throw const TokenGateException(TokenGateFailure.notSignedIn);
    }

    return after.accessToken;
  }

  bool _isUsable(AuthSessionSnapshot session) {
    final expiresAt = session.expiresAt;
    return session.accessToken.isNotEmpty &&
        expiresAt != null &&
        expiresAt.isAfter(_now().add(expirySafetyWindow));
  }

  Future<void> _refreshSession() async {
    try {
      await _source.refreshSession();
    } finally {
      _refreshInFlight = null;
    }
  }

  void _handleAuthEvent(AuthSessionEvent event) {
    if (event != AuthSessionEvent.tokenRefreshed) {
      _identityGeneration++;
    }
  }

  Future<void> dispose() async {
    _disposed = true;
    _identityGeneration++;
    await _eventSubscription.cancel();
  }
}
