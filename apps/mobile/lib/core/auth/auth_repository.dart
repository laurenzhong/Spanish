import 'package:supabase_flutter/supabase_flutter.dart';

abstract interface class AuthRepository {
  Future<void> requestEmailOtp(String email);

  Future<void> verifyEmailOtp({required String email, required String token});

  Future<void> signInWithPassword({
    required String email,
    required String password,
  });

  Future<void> signOut();
}

class SupabaseAuthRepository implements AuthRepository {
  SupabaseAuthRepository(this._auth);

  final GoTrueClient _auth;

  @override
  Future<void> requestEmailOtp(String email) async {
    await _auth.signInWithOtp(email: email, shouldCreateUser: true);
  }

  @override
  Future<void> verifyEmailOtp({
    required String email,
    required String token,
  }) async {
    await _auth.verifyOTP(email: email, token: token, type: OtpType.email);
  }

  @override
  Future<void> signInWithPassword({
    required String email,
    required String password,
  }) async {
    await _auth.signInWithPassword(email: email, password: password);
  }

  @override
  Future<void> signOut() => _auth.signOut();
}
