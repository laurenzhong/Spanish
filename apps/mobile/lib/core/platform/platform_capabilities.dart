import 'dart:async';

enum ConnectivityStatus { online, offline }

enum LifecyclePhase { active, inactive, paused, detached }

class RecordedAudio {
  const RecordedAudio({required this.bytes, required this.mimeType});

  final List<int> bytes;
  final String mimeType;
}

abstract interface class AudioRecorder {
  Future<void> start();

  Future<RecordedAudio> stop();

  Future<void> cancel();
}

abstract interface class AudioPlayer {
  Future<void> play(List<int> bytes, {required String mimeType});

  Future<void> stop();
}

abstract interface class TextToSpeech {
  Future<void> speak(String text, {required String languageTag});

  Future<void> stop();
}

abstract interface class SecureStorage {
  Future<String?> read(String key);

  Future<void> write(String key, String value);

  Future<void> delete(String key);
}

abstract interface class Notifications {
  Future<void> requestPermission();

  Future<void> schedule({required String id, required DateTime at});

  Future<void> cancel(String id);
}

abstract interface class AppLifecycle {
  LifecyclePhase get currentPhase;

  Stream<LifecyclePhase> get changes;
}

abstract interface class Connectivity {
  Future<ConnectivityStatus> currentStatus();

  Stream<ConnectivityStatus> get changes;
}

abstract interface class FileCache {
  Future<List<int>?> read(String key);

  Future<void> write(String key, List<int> bytes);

  Future<void> delete(String key);
}
