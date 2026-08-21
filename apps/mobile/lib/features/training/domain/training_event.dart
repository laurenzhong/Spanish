class TrainingEvent {
  const TrainingEvent(this.type, [this.data = const <String, Object?>{}]);

  factory TrainingEvent.fromJson(Object? input) {
    if (input is! Map) {
      throw const FormatException('Training event must be an object.');
    }
    final json = Map<String, Object?>.from(input);
    final type = json['type'];
    if (type is! String || type.isEmpty) {
      throw const FormatException('Training event type is required.');
    }
    final data = Map<String, Object?>.from(json)..remove('type');
    return TrainingEvent(type, data);
  }

  final String type;
  final Map<String, Object?> data;

  String string(String key) {
    final value = data[key];
    if (value is! String) throw FormatException('$type.$key must be a string.');
    return value;
  }

  String? optionalString(String key) => data[key] == null ? null : string(key);

  int integer(String key) {
    final value = data[key];
    if (value is! int) throw FormatException('$type.$key must be an integer.');
    return value;
  }

  double number(String key) {
    final value = data[key];
    if (value is! num) throw FormatException('$type.$key must be a number.');
    return value.toDouble();
  }

  bool boolean(String key) {
    final value = data[key];
    if (value is! bool) throw FormatException('$type.$key must be a boolean.');
    return value;
  }
}

class TrainingEffect {
  const TrainingEffect(this.type, [this.data = const <String, Object?>{}]);

  final String type;
  final Map<String, Object?> data;

  Map<String, Object?> toJson() => <String, Object?>{'type': type, ...data};
}

class TrainingTransition {
  const TrainingTransition({required this.state, required this.effects});

  final TrainingState state;
  final List<TrainingEffect> effects;
}
