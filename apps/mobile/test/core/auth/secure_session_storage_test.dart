import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/core/auth/secure_session_storage.dart';
import 'package:spanish_mobile/core/platform/platform_capabilities.dart';

class _MemorySecureStorage implements SecureStorage {
  final values = <String, String>{};

  @override
  Future<void> delete(String key) async => values.remove(key);

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;
}

void main() {
  test(
    'persists and removes the Supabase session through secure storage',
    () async {
      final secureStorage = _MemorySecureStorage();
      final storage = SecureSupabaseSessionStorage(secureStorage);

      expect(await storage.hasAccessToken(), isFalse);
      await storage.persistSession('serialized-session');
      expect(await storage.accessToken(), 'serialized-session');
      expect(await storage.hasAccessToken(), isTrue);

      await storage.removePersistedSession();
      expect(await storage.accessToken(), isNull);
    },
  );
}
