class AuthConfig {
  const AuthConfig({required this.supabaseUrl, required this.publishableKey});

  const AuthConfig.fromEnvironment()
    : supabaseUrl = const String.fromEnvironment('SUPABASE_URL'),
      publishableKey = const String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY');

  final String supabaseUrl;
  final String publishableKey;

  bool get isConfigured =>
      supabaseUrl.trim().isNotEmpty && publishableKey.trim().isNotEmpty;
}
