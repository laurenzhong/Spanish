import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/core/platform/fake_platform_capabilities.dart';
import 'package:spanish_mobile/core/platform/platform_capabilities.dart';

void main() {
  test('fake secure storage preserves and deletes values', () async {
    final storage = FakeSecureStorage();

    await storage.write('session', 'alpha');
    expect(await storage.read('session'), 'alpha');

    await storage.delete('session');
    expect(await storage.read('session'), isNull);
  });

  test('fake connectivity exposes stable offline state', () async {
    final connectivity = FakeConnectivity(
      initialStatus: ConnectivityStatus.offline,
    );

    expect(await connectivity.currentStatus(), ConnectivityStatus.offline);
    expect(connectivity.changes, emits(ConnectivityStatus.online));
    connectivity.setStatus(ConnectivityStatus.online);
  });

  test('fake recorder completes an in-memory recording', () async {
    final recorder = FakeAudioRecorder();

    await recorder.start();
    final audio = await recorder.stop();

    expect(audio.bytes, isNotEmpty);
    expect(audio.mimeType, 'audio/fake');
  });
}
