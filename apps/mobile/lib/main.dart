import 'package:flutter/material.dart';
import 'package:spanish_mobile/app.dart';
import 'package:spanish_mobile/core/auth/auth_config.dart';
import 'package:spanish_mobile/core/auth/auth_repository.dart';
import 'package:spanish_mobile/core/auth/auth_session.dart';
import 'package:spanish_mobile/core/auth/secure_session_storage.dart';
import 'package:spanish_mobile/core/platform/flutter_secure_storage_adapter.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  const config = AuthConfig.fromEnvironment();

  if (!config.isConfigured) {
    runApp(const SpanishApp());
    return;
  }

  await Supabase.initialize(
    url: config.supabaseUrl,
    publishableKey: config.publishableKey,
    authOptions: const FlutterAuthClientOptions(
      localStorage: SecureSupabaseSessionStorage(FlutterSecureStorageAdapter()),
      detectSessionInUri: false,
    ),
  );
  final auth = Supabase.instance.client.auth;
  runApp(
    SpanishApp(
      authRepository: SupabaseAuthRepository(auth),
      authSessionSource: SupabaseAuthSessionSource(auth),
    ),
  );
}
