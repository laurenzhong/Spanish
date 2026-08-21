import 'dart:async';

import 'platform_capabilities.dart';

class FakeAudioRecorder implements AudioRecorder {
  FakeAudioRecorder({this.startFailure, this.stopFailure});

  final PlatformCapabilityException? startFailure;
  final PlatformCapabilityException? stopFailure;
  bool _isRecording = false;

  bool get isRecording => _isRecording;

  @override
  Future<void> start() async {
    if (startFailure != null) throw startFailure!;
    _isRecording = true;
  }

  @override
  Future<RecordedAudio> stop() async {
    if (stopFailure != null) throw stopFailure!;
    if (!_isRecording) {
      throw const PlatformCapabilityException(
        PlatformCapabilityErrorCode.recordingNotActive,
        'Recording has not started.',
      );
    }
    _isRecording = false;
    return const RecordedAudio(bytes: <int>[1, 2, 3], mimeType: 'audio/fake');
  }

  @override
  Future<void> cancel() async {
    _isRecording = false;
  }
}

class FakeAudioPlayer implements AudioPlayer {
  bool isPlaying = false;

  @override
  Future<void> play(List<int> bytes, {required String mimeType}) async {
    isPlaying = true;
  }

  @override
  Future<void> stop() async {
    isPlaying = false;
  }
}

class FakeTextToSpeech implements TextToSpeech {
  FakeTextToSpeech({this.speakFailure});

  final PlatformCapabilityException? speakFailure;
  String? lastText;
  String? lastLanguageTag;

  @override
  Future<void> speak(String text, {required String languageTag}) async {
    if (speakFailure != null) throw speakFailure!;
    lastText = text;
    lastLanguageTag = languageTag;
  }

  @override
  Future<void> stop() async {
    lastText = null;
    lastLanguageTag = null;
  }
}

class FakeSecureStorage implements SecureStorage {
  final Map<String, String> _values = <String, String>{};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async {
    _values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    _values.remove(key);
  }
}

class FakeNotifications implements Notifications {
  final Set<String> scheduledIds = <String>{};
  bool permissionRequested = false;

  @override
  Future<void> requestPermission() async {
    permissionRequested = true;
  }

  @override
  Future<void> schedule({required String id, required DateTime at}) async {
    scheduledIds.add(id);
  }

  @override
  Future<void> cancel(String id) async {
    scheduledIds.remove(id);
  }
}

class FakeAppLifecycle implements AppLifecycle {
  FakeAppLifecycle({LifecyclePhase initialPhase = LifecyclePhase.active})
    : _currentPhase = initialPhase;

  final StreamController<LifecyclePhase> _controller =
      StreamController<LifecyclePhase>.broadcast();
  LifecyclePhase _currentPhase;

  @override
  LifecyclePhase get currentPhase => _currentPhase;

  @override
  Stream<LifecyclePhase> get changes => _controller.stream;

  void setPhase(LifecyclePhase phase) {
    _currentPhase = phase;
    _controller.add(phase);
  }

  Future<void> dispose() => _controller.close();
}

class FakeConnectivity implements Connectivity {
  FakeConnectivity({
    ConnectivityStatus initialStatus = ConnectivityStatus.online,
  }) : _status = initialStatus;

  final StreamController<ConnectivityStatus> _controller =
      StreamController<ConnectivityStatus>.broadcast();
  ConnectivityStatus _status;

  @override
  Future<ConnectivityStatus> currentStatus() async => _status;

  @override
  Stream<ConnectivityStatus> get changes => _controller.stream;

  void setStatus(ConnectivityStatus status) {
    _status = status;
    _controller.add(status);
  }

  Future<void> dispose() => _controller.close();
}

class FakeFileCache implements FileCache {
  final Map<String, List<int>> _files = <String, List<int>>{};

  @override
  Future<List<int>?> read(String key) async => _files[key];

  @override
  Future<void> write(String key, List<int> bytes) async {
    _files[key] = List<int>.unmodifiable(bytes);
  }

  @override
  Future<void> delete(String key) async {
    _files.remove(key);
  }
}
