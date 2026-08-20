import 'dart:async';

import 'package:supabase_flutter/supabase_flutter.dart';

class AuthSessionSnapshot {
  const AuthSessionSnapshot({
    required this.userId,
    required this.accessToken,
    required this.expiresAt,
  });

  final String userId;
  final String accessToken;
  final DateTime? expiresAt;
}

enum AuthSessionEvent { signedIn, signedOut, identityChanged, tokenRefreshed }

abstract interface class AuthSessionSource {
  AuthSessionSnapshot? get currentSession;

  Stream<AuthSessionSnapshot?> get sessions;

  Stream<AuthSessionEvent> get events;

  Future<void> refreshSession();
}

class SupabaseAuthSessionSource implements AuthSessionSource {
  SupabaseAuthSessionSource(this._auth);

  final GoTrueClient _auth;

  @override
  AuthSessionSnapshot? get currentSession => _snapshot(_auth.currentSession);

  @override
  Stream<AuthSessionSnapshot?> get sessions async* {
    yield currentSession;
    yield* _auth.onAuthStateChange.map((state) => _snapshot(state.session));
  }

  @override
  Stream<AuthSessionEvent> get events => _auth.onAuthStateChange.map((state) {
    return switch (state.event) {
      AuthChangeEvent.signedIn => AuthSessionEvent.signedIn,
      AuthChangeEvent.signedOut => AuthSessionEvent.signedOut,
      AuthChangeEvent.tokenRefreshed ||
      AuthChangeEvent.initialSession ||
      AuthChangeEvent.userUpdated => AuthSessionEvent.tokenRefreshed,
      _ => AuthSessionEvent.identityChanged,
    };
  });

  @override
  Future<void> refreshSession() async {
    await _auth.refreshSession();
  }

  AuthSessionSnapshot? _snapshot(Session? session) {
    if (session == null) return null;
    final expiresAt = session.expiresAt;
    return AuthSessionSnapshot(
      userId: session.user.id,
      accessToken: session.accessToken,
      expiresAt: expiresAt == null
          ? null
          : DateTime.fromMillisecondsSinceEpoch(expiresAt * 1000, isUtc: true),
    );
  }
}
