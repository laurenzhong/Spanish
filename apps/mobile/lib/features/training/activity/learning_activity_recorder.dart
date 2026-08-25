// The constructor keeps public configuration names while assigning private fields.
// ignore_for_file: prefer_initializing_formals

import 'dart:async';

import 'package:flutter/widgets.dart';

typedef LearningActivityEventSender = Future<void> Function(
  LearningActivityEvent event,
);

class LearningActivityEvent {
  const LearningActivityEvent({
    required this.clientInstanceId,
    required this.eventType,
    required this.sequence,
  });

  final String clientInstanceId;
  final String eventType;
  final int sequence;

  Map<String, Object> toJson() => <String, Object>{
    'clientInstanceId': clientInstanceId,
    'eventType': eventType,
    'sequence': sequence,
  };
}

class LearningActivityRecorder with WidgetsBindingObserver {
  LearningActivityRecorder({
    required this.send,
    String? clientInstanceId,
    Duration heartbeatInterval = const Duration(seconds: 15),
    Duration idleTimeout = const Duration(seconds: 60),
    DateTime Function()? now,
  }) : _clientInstanceId =
           clientInstanceId ??
           'flutter-${DateTime.now().microsecondsSinceEpoch}-${identityHashCode(Object())}',
       _heartbeatInterval = heartbeatInterval,
       _idleTimeout = idleTimeout,
       _now = now ?? DateTime.now;

  final LearningActivityEventSender send;
  final String _clientInstanceId;
  final Duration _heartbeatInterval;
  final Duration _idleTimeout;
  final DateTime Function() _now;
  Timer? _timer;
  int _sequence = 0;
  DateTime? _lastInteractionAt;
  bool _foreground = true;
  bool _started = false;
  String? _lastSentType;

  bool get isStarted => _started;

  void start() {
    if (_started) return;
    _started = true;
    _foreground = true;
    _lastInteractionAt = _now();
    WidgetsBinding.instance.addObserver(this);
    _emit('active');
    _timer = Timer.periodic(_heartbeatInterval, (_) => _tick());
  }

  void markInteraction() {
    if (!_started) return;
    _lastInteractionAt = _now();
    if (_foreground && _lastSentType == 'inactive') _emit('active');
  }

  void stop() {
    if (!_started) return;
    _started = false;
    _timer?.cancel();
    _timer = null;
    WidgetsBinding.instance.removeObserver(this);
    _emit('ended');
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!_started) return;
    final foreground = state == AppLifecycleState.resumed;
    _foreground = foreground;
    if (!foreground && _lastSentType != 'inactive') _emit('inactive');
    if (foreground) markInteraction();
  }

  void _tick() {
    if (!_started) return;
    final lastInteractionAt = _lastInteractionAt;
    final recentlyActive =
        lastInteractionAt != null &&
        _now().difference(lastInteractionAt) <= _idleTimeout;
    if (_foreground && recentlyActive) {
      _emit('active');
    } else if (_lastSentType != 'inactive') {
      _emit('inactive');
    }
  }

  void _emit(String eventType) {
    final event = LearningActivityEvent(
      clientInstanceId: _clientInstanceId,
      eventType: eventType,
      sequence: _sequence++,
    );
    _lastSentType = eventType;
    unawaited(send(event).catchError((_) {}));
  }
}
