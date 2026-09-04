import 'package:flutter/material.dart';
import 'package:spanish_mobile/app.dart';
import 'package:spanish_mobile/core/auth/auth_config.dart';
import 'package:spanish_mobile/core/auth/auth_repository.dart';
import 'package:spanish_mobile/core/auth/auth_session.dart';
import 'package:spanish_mobile/core/auth/authenticated_api_client.dart';
import 'package:spanish_mobile/core/auth/token_coordinator.dart';
import 'package:spanish_mobile/core/auth/secure_session_storage.dart';
import 'package:spanish_mobile/core/platform/flutter_secure_storage_adapter.dart';
import 'package:spanish_mobile/features/explore/data/explore_api.dart';
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
  final sessionSource = SupabaseAuthSessionSource(auth);
  final tokenCoordinator = AccessTokenCoordinator(sessionSource);
  const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000',
  );
  runApp(
    SpanishApp(
      authRepository: SupabaseAuthRepository(auth),
      authSessionSource: sessionSource,
      exploreApi: ExploreApi(
        AuthenticatedApiClient(tokenCoordinator, baseUri: Uri.parse(apiBaseUrl)),
      ),
    ),
  );
}
