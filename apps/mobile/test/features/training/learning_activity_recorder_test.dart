import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/widgets.dart';
import 'package:spanish_mobile/features/training/activity/learning_activity_recorder.dart';

void main() {
  testWidgets('emits active, inactive, and ended across app lifecycle', (
    tester,
  ) async {
    final events = <LearningActivityEvent>[];
    final recorder = LearningActivityRecorder(
      clientInstanceId: 'flutter-test',
      heartbeatInterval: const Duration(seconds: 1),
      send: (event) async => events.add(event),
    );

    recorder.start();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    recorder.stop();

    expect(events.map((event) => event.eventType), <String>[
      'active',
      'inactive',
      'active',
      'ended',
    ]);
    expect(events.map((event) => event.sequence), <int>[0, 1, 2, 3]);
    expect(
      events.every((event) => event.clientInstanceId == 'flutter-test'),
      isTrue,
    );
  });

  testWidgets('does not start twice and releases its timer on stop', (
    tester,
  ) async {
    final events = <LearningActivityEvent>[];
    final recorder = LearningActivityRecorder(
      clientInstanceId: 'flutter-test',
      heartbeatInterval: const Duration(milliseconds: 10),
      send: (event) async => events.add(event),
    );

    recorder.start();
    recorder.start();
    await tester.pump(const Duration(milliseconds: 25));
    recorder.stop();
    final countAfterStop = events.length;
    await tester.pump(const Duration(milliseconds: 100));

    expect(events.length, countAfterStop);
    expect(recorder.isStarted, isFalse);
  });
}
