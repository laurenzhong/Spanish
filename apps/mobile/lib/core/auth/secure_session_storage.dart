import 'package:supabase_flutter/supabase_flutter.dart';

import '../platform/platform_capabilities.dart';

class SecureSupabaseSessionStorage extends LocalStorage {
  const SecureSupabaseSessionStorage(
    this._storage, {
    this.key = 'spanish.supabase.session',
  });

  final SecureStorage _storage;
  final String key;

  @override
  Future<String?> accessToken() => _storage.read(key);

  @override
  Future<bool> hasAccessToken() async => (await accessToken()) != null;

  @override
  Future<void> initialize() async {}

  @override
  Future<void> persistSession(String persistSessionString) =>
      _storage.write(key, persistSessionString);

  @override
  Future<void> removePersistedSession() => _storage.delete(key);
}
