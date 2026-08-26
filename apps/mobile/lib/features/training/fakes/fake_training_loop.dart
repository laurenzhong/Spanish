import 'dart:async';

import 'package:flutter/material.dart';
import 'package:spanish_mobile/core/platform/fake_platform_capabilities.dart';
import 'package:spanish_mobile/core/platform/platform_capabilities.dart';
import 'package:spanish_mobile/shared/widgets/surface_card.dart';

import '../domain/training_engine.dart';
import '../domain/training_event.dart';
import '../domain/training_state.dart';
import '../checkpoints/training_checkpoint.dart';
import 'fake_evaluator.dart';
import '../activity/learning_activity_recorder.dart';

class _Expression {
  const _Expression({
    required this.key,
    required this.goalKey,
    required this.goalTitle,
    required this.text,
    required this.translation,
    required this.intent,
    this.variants = const <_Expression>[],
  });

  final String key;
  final String goalKey;
  final String goalTitle;
  final String text;
  final String translation;
  final String intent;
  final List<_Expression> variants;
}

String _articleTransferLabel(String type) {
  const labels = <String, String>{
    'summary': '说说文章讲了什么',
    'opinion': '说说你的看法',
    'personal_transfer': '联系到自己的生活',
    'character_dialogue': '和角色聊两句',
  };
  return labels[type] ?? '读到口语';
}

class FakeTrainingLoop extends StatefulWidget {
  const FakeTrainingLoop({
    this.checkpointStore,
    this.activityRecorder,
    this.recorder,
    this.textToSpeech,
    this.articleTransferType,
    this.articleTitle,
    super.key,
  });

  final TrainingCheckpointStore? checkpointStore;
  final LearningActivityRecorder? activityRecorder;
  final AudioRecorder? recorder;
  final TextToSpeech? textToSpeech;
  final String? articleTransferType;
  final String? articleTitle;

  @override
  State<FakeTrainingLoop> createState() => _FakeTrainingLoopState();
}

class _FakeTrainingLoopState extends State<FakeTrainingLoop> {
  static const _expressions = <_Expression>[
    _Expression(
      key: 'start.como-va-todo',
      goalKey: 'communication.start.check-in',
      goalTitle: '询问近况',
      text: '¿Cómo va todo?',
      translation: '一切都怎么样？',
      intent: '轻松问候，并邀请对方谈谈近况。',
      variants: <_Expression>[
        _Expression(
          key: 'start.como-va-todo.variant.0',
          goalKey: 'communication.start.check-in',
          goalTitle: '变式情境',
          text: '¿Qué tal todo?',
          translation: '最近怎么样？',
          intent: '用另一种自然说法询问近况。',
        ),
        _Expression(
          key: 'start.como-va-todo.variant.1',
          goalKey: 'communication.start.check-in',
          goalTitle: '变式情境',
          text: '¿Cómo te va?',
          translation: '你最近过得怎么样？',
          intent: '直接向熟人询问近况。',
        ),
      ],
    ),
    _Expression(
      key: 'relationship.como-se-llama',
      goalKey: 'communication.relationship.ask-name',
      goalTitle: '询问姓名',
      text: '¿Cómo se llama?',
      translation: '您叫什么名字？',
      intent: '礼貌询问初次见面的人的姓名。',
      variants: <_Expression>[
        _Expression(
          key: 'relationship.como-se-llama.variant.0',
          goalKey: 'communication.relationship.ask-name',
          goalTitle: '变式情境',
          text: '¿Cómo te llamas?',
          translation: '你叫什么名字？',
          intent: '对同龄人或熟人使用更直接的问法。',
        ),
        _Expression(
          key: 'relationship.como-se-llama.variant.1',
          goalKey: 'communication.relationship.ask-name',
          goalTitle: '变式情境',
          text: 'Perdone, ¿cómo se llama?',
          translation: '不好意思，您叫什么名字？',
          intent: '在礼貌打断陌生人时询问姓名。',
        ),
      ],
    ),
    _Expression(
      key: 'relationship.me-gusta-viajar',
      goalKey: 'communication.relationship.share-interest',
      goalTitle: '分享兴趣',
      text: 'Me gusta viajar y probar la comida local.',
      translation: '我喜欢旅行和尝试当地美食。',
      intent: '分享个人兴趣，为对方追问创造机会。',
      variants: <_Expression>[
        _Expression(
          key: 'relationship.me-gusta-viajar.variant.0',
          goalKey: 'communication.relationship.share-interest',
          goalTitle: '变式情境',
          text: 'Me encanta descubrir sitios nuevos.',
          translation: '我很喜欢发现新的地方。',
          intent: '换一个具体兴趣继续分享。',
        ),
        _Expression(
          key: 'relationship.me-gusta-viajar.variant.1',
          goalKey: 'communication.relationship.share-interest',
          goalTitle: '变式情境',
          text: 'Disfruto mucho de la música.',
          translation: '我很喜欢音乐。',
          intent: '用另一种结构表达个人兴趣。',
        ),
      ],
    ),
    _Expression(
      key: 'need.necesito-ayuda',
      goalKey: 'communication.need.ask-help',
      goalTitle: '请求帮助',
      text: 'Necesito ayuda.',
      translation: '我需要帮助。',
      intent: '在需要协助时直接说明核心需求。',
      variants: <_Expression>[
        _Expression(
          key: 'need.necesito-ayuda.variant.0',
          goalKey: 'communication.need.ask-help',
          goalTitle: '变式情境',
          text: '¿Podrías ayudarme, por favor?',
          translation: '你可以帮帮我吗？',
          intent: '用更礼貌的方式请求帮助。',
        ),
        _Expression(
          key: 'need.necesito-ayuda.variant.1',
          goalKey: 'communication.need.ask-help',
          goalTitle: '变式情境',
          text: '¿Me puede ayudar?',
          translation: '您可以帮我吗？',
          intent: '在正式场合请求协助。',
        ),
      ],
    ),
  ];

  final _evaluator = const FakeEvaluator();
  final _timers = <Timer>[];
  late final AudioRecorder _recorder;
  late final TextToSpeech _textToSpeech;
  TrainingState _state = TrainingState.initial();
  TrainingCheckpointStore? _checkpointStore;
  int _expressionIndex = 0;
  int _variantIndex = 0;
  String _draft = '';
  String? _capabilityNotice;
  bool _initialized = false;

  _Expression get _baseExpression => _expressions[_expressionIndex];
  _Expression get _expression => _variantIndex == 0
      ? _baseExpression
      : _baseExpression.variants[_variantIndex - 1];

  static const _hints = <String, List<String>>{
    'start.como-va-todo': <String>[
      '先决定你想表达的近况：好、一般、忙，还是有点累。',
      '可以先说 bien、regular 或 cansado，再补一句 gracias 或今天的情况。',
      '句式骨架：近况 + gracias。Hoy + 一个简单原因。',
    ],
    'relationship.como-se-llama': <String>[
      '先确认你是在礼貌询问对方姓名。',
      '可以用 cómo te llamas，或在回答时用 me llamo / soy。',
      '句式骨架：Me llamo + 名字；再用 ¿Y tú？把对话交回去。',
    ],
    'relationship.me-gusta-viajar': <String>[
      '先说一个你愿意分享的兴趣或活动。',
      '可以用 me gusta、me encanta 或 disfruto + 活动。',
      '句式骨架：Me gusta + 活动 + y + 一个具体对象。',
    ],
    'need.necesito-ayuda': <String>[
      '先明确你需要对方做什么。',
      '可以用 necesito、podrías 或 por favor 让请求更清楚。',
      '句式骨架：Necesito + 帮助内容；再补 por favor。',
    ],
  };

  @override
  void initState() {
    super.initState();
    _checkpointStore = widget.checkpointStore;
    _recorder = widget.recorder ?? FakeAudioRecorder();
    _textToSpeech = widget.textToSpeech ?? FakeTextToSpeech();
    widget.activityRecorder?.start();
    _initialize();
  }

  @override
  void dispose() {
    for (final timer in _timers) {
      timer.cancel();
    }
    unawaited(_recorder.cancel());
    unawaited(_textToSpeech.stop());
    widget.activityRecorder?.stop();
    super.dispose();
  }

  void _dispatch(TrainingEvent event) {
    final result = transition(_state, event);
    var nextState = result.state;
    var nextVariantIndex = _variantIndex;
    if (event.type == 'variant-ready' &&
        result.state.status == TrainingStatus.presentingInput &&
        _baseExpression.variants.isNotEmpty) {
      nextVariantIndex = (_variantIndex % _baseExpression.variants.length) + 1;
      nextState = result.state.copyWith(
        contentKey: _baseExpression.variants[nextVariantIndex - 1].key,
      );
    }
    if (!mounted) {
      _state = nextState;
      _variantIndex = nextVariantIndex;
      return;
    }
    setState(() {
      _state = nextState;
      _variantIndex = nextVariantIndex;
    });
    _runEffects(result.effects);
  }

  Future<void> _initialize() async {
    final restored = _checkpointStore == null
        ? null
        : await restoreTrainingCheckpoint(_checkpointStore!);
    if (!mounted) return;

    if (restored != null) {
      var index = _expressions.indexWhere(
        (expression) => expression.key == restored.contentKey,
      );
      var variantIndex = 0;
      if (index < 0) {
        index = _expressions.indexWhere((expression) {
          final variant = expression.variants.indexWhere(
            (candidate) => candidate.key == restored.contentKey,
          );
          if (variant >= 0) variantIndex = variant + 1;
          return variant >= 0;
        });
      }
      setState(() {
        _expressionIndex = index < 0 ? 0 : index;
        _variantIndex = variantIndex;
        _state = restored;
        _initialized = true;
      });
      return;
    }

    final result = transition(
      TrainingState.initial(),
      const TrainingEvent('content-loaded', <String, Object?>{
        'contentKey': 'start.como-va-todo',
        'goalKey': 'communication.start.check-in',
      }),
    );
    setState(() {
      _state = result.state;
      _initialized = true;
    });
    _runEffects(result.effects);
  }

  void _runEffects(List<TrainingEffect> effects) {
    Future<bool>? recordingStop;
    for (final effect in effects) {
      switch (effect.type) {
        case 'save-breakpoint':
          if (_checkpointStore != null) {
            try {
              final checkpoint = TrainingCheckpoint.fromState(_state);
              unawaited(
                _checkpointStore!.write(checkpoint.encode()).catchError((_) {}),
              );
            } on ArgumentError {
              // The state machine only saves stable states; transient states are ignored.
            }
          }
          break;
        case 'play-input':
          unawaited(_speakInput());
          break;
        case 'start-recording':
          unawaited(_startRecording(effect.data['generationId'] as int));
          break;
        case 'stop-recording':
          recordingStop = _stopRecording(
            effect.data['generationId'] as int,
            reportFailure: _state.status == TrainingStatus.transcribing,
          );
          break;
        case 'prepare-variant':
          _schedule(const Duration(milliseconds: 180), () {
            _dispatch(const TrainingEvent('variant-ready'));
          });
          break;
        case 'transcribe':
          final generationId = effect.data['generationId'] as int;
          final simulatedTranscript = _expression.text;
          unawaited(
            (recordingStop ?? Future<bool>.value(true)).then((success) {
              if (!success || !mounted) return;
              _schedule(const Duration(milliseconds: 180), () {
                _dispatch(
                  TrainingEvent('transcription-succeeded', <String, Object?>{
                    'generationId': generationId,
                    'transcript': simulatedTranscript,
                    'confidence': 0.96,
                  }),
                );
              });
            }),
          );
          break;
        case 'evaluate':
          final generationId = effect.data['generationId'] as int;
          final mode = effect.data['outputMode'] as String;
          final outputMode = TrainingOutputMode.values.firstWhere(
            (value) => value.value == mode,
          );
          final request = FakeEvaluationRequest(
            expressionKey: _state.contentKey ?? '',
            generationId: generationId,
            outputMode: outputMode,
            text: _state.transcript ?? '',
          );
          _evaluator.evaluate(request).then((event) {
            if (mounted && generationId == _state.generationId) {
              _dispatch(event);
            }
          });
          break;
        default:
          break;
      }
    }
  }

  Future<void> _speakInput() async {
    try {
      await _textToSpeech.speak(_expression.text, languageTag: 'es-ES');
      if (mounted) _dispatch(const TrainingEvent('input-playback-completed'));
    } catch (error) {
      if (mounted) {
        _dispatch(
          TrainingEvent('input-playback-failed', <String, Object?>{
            'errorCode': _capabilityErrorCode(error, 'tts-failed'),
          }),
        );
      }
    }
  }

  Future<void> _startRecording(int generationId) async {
    try {
      await _recorder.start();
    } catch (error) {
      if (!mounted) return;
      setState(() => _capabilityNotice = '麦克风暂时不可用，已切换为文字回答。');
      _dispatch(
        TrainingEvent('recording-start-failed', <String, Object?>{
          'generationId': generationId,
          'errorCode': _capabilityErrorCode(error, 'recording-failed'),
        }),
      );
    }
  }

  Future<bool> _stopRecording(
    int generationId, {
    required bool reportFailure,
  }) async {
    try {
      await _recorder.stop();
      return true;
    } catch (error) {
      if (reportFailure &&
          mounted &&
          _state.status == TrainingStatus.transcribing) {
        _dispatch(
          TrainingEvent('transcription-failed', <String, Object?>{
            'generationId': generationId,
            'errorCode': _capabilityErrorCode(error, 'recording-failed'),
          }),
        );
      }
      return false;
    }
  }

  String _capabilityErrorCode(Object error, String fallback) {
    if (error is PlatformCapabilityException) return error.code.value;
    return fallback;
  }

  void _schedule(Duration duration, void Function() callback) {
    late final Timer timer;
    timer = Timer(duration, () {
      _timers.remove(timer);
      callback();
    });
    _timers.add(timer);
  }

  void _submitTyping() {
    final text = _draft.trim();
    if (text.isEmpty) return;
    _dispatch(TrainingEvent('submit-typing', <String, Object?>{'text': text}));
    setState(() => _draft = '');
  }

  void _nextExpression() {
    final nextIndex = (_expressionIndex + 1) % _expressions.length;
    void startNext() {
      setState(() {
        _expressionIndex = nextIndex;
        _variantIndex = 0;
        _draft = '';
        _state = transition(
          TrainingState.initial(),
          TrainingEvent('content-loaded', <String, Object?>{
            'contentKey': _expressions[nextIndex].key,
            'goalKey': _expressions[nextIndex].goalKey,
          }),
        ).state;
      });
      _runEffects(<TrainingEffect>[const TrainingEffect('play-input')]);
    }

    if (_checkpointStore == null) {
      startNext();
      return;
    }
    unawaited(
      _checkpointStore!
          .clear()
          .then((_) {
            if (mounted) startNext();
          })
          .catchError((_) {
            if (mounted) startNext();
          }),
    );
  }

  String _statusLabel(TrainingStatus status) {
    switch (status) {
      case TrainingStatus.presentingInput:
        return '先听一遍';
      case TrainingStatus.awaitingOutput:
        return '轮到你了';
      case TrainingStatus.recording:
        return '正在记录你的回答';
      case TrainingStatus.transcribing:
        return '正在整理回答';
      case TrainingStatus.evaluating:
        return '正在看这句话完成了什么';
      case TrainingStatus.showingFeedback:
        return '这一轮完成了';
      case TrainingStatus.transitioning:
        return '准备下一种说法';
      case TrainingStatus.completed:
        return '这句已完成';
      case TrainingStatus.recoverableError:
        return '这次没有顺利完成';
      case TrainingStatus.loadingContext:
        return '正在准备内容';
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final isProcessing =
        _state.status == TrainingStatus.transcribing ||
        _state.status == TrainingStatus.evaluating;

    if (!_initialized) {
      return const Center(child: CircularProgressIndicator());
    }

    return Listener(
      onPointerDown: (_) => widget.activityRecorder?.markInteraction(),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(18, 26, 18, 40),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: <Widget>[
                    const Expanded(
                      child: Text(
                        '把一句话说到对方能接住',
                        style: TextStyle(
                          fontSize: 25,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    Text(
                      '${_expressionIndex + 1}/4',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
                if (_capabilityNotice != null) ...<Widget>[
                  const SizedBox(height: 12),
                  Text(
                    _capabilityNotice!,
                    style: TextStyle(color: colors.onSurfaceVariant),
                  ),
                ],
                if (widget.articleTransferType != null) ...<Widget>[
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF7F0),
                      border: Border.all(color: const Color(0xFFE7C9AF)),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        const Text(
                          '来自阅读',
                          style: TextStyle(
                            color: Color(0xFF9B5C2E),
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          _articleTransferLabel(widget.articleTransferType!),
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          '围绕《${widget.articleTitle ?? '这篇文章'}》先组织要点，再用声音回答。',
                          style: TextStyle(
                            color: colors.onSurfaceVariant,
                            height: 1.45,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '只有主动用声音回答时，才会进入口语评估。',
                          style: TextStyle(
                            color: colors.onSurfaceVariant,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 20),
                SurfaceCard(
                  color: const Color(0xFFF8FBFF),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        _statusLabel(_state.status),
                        style: TextStyle(
                          color: colors.primary,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 18),
                      Text(
                        _variantIndex > 0 ? '变式情境' : _expression.goalTitle,
                        style: TextStyle(
                          color: colors.primary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _expression.text,
                        style: const TextStyle(
                          fontSize: 28,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(_expression.translation),
                      const SizedBox(height: 6),
                      Text(
                        _expression.intent,
                        style: TextStyle(
                          color: colors.onSurfaceVariant,
                          height: 1.5,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                SurfaceCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        '提示 ${_state.hintLevel}/3',
                        style: TextStyle(
                          color: colors.onSurfaceVariant,
                          fontSize: 12,
                        ),
                      ),
                      if (_state.hintLevel > 0 &&
                          _hints[_baseExpression.key] != null) ...<Widget>[
                        const SizedBox(height: 8),
                        Text(
                          _hints[_baseExpression.key]![_state.hintLevel - 1],
                          style: TextStyle(
                            color: colors.onSurfaceVariant,
                            height: 1.5,
                          ),
                        ),
                      ],
                      const SizedBox(height: 16),
                      if (_state.status == TrainingStatus.presentingInput)
                        const Text('先听输入，听完后用自己的话回应。'),
                      if (_state.status ==
                          TrainingStatus.awaitingOutput) ...<Widget>[
                        Row(
                          children: <Widget>[
                            Expanded(
                              child: OutlinedButton(
                                onPressed: () {
                                  setState(() => _capabilityNotice = null);
                                  _dispatch(
                                    const TrainingEvent('switch-to-silent'),
                                  );
                                },
                                child: const Text('用文字回答'),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: FilledButton(
                                onPressed: () => _dispatch(
                                  const TrainingEvent('start-recording'),
                                ),
                                child: const Text('开始录音'),
                              ),
                            ),
                          ],
                        ),
                        if (_state.outputMode ==
                            TrainingOutputMode.typing) ...<Widget>[
                          const SizedBox(height: 14),
                          Material(
                            type: MaterialType.transparency,
                            child: TextField(
                              onChanged: (value) {
                                widget.activityRecorder?.markInteraction();
                                setState(() => _draft = value);
                              },
                              minLines: 2,
                              maxLines: 4,
                              decoration: const InputDecoration(
                                labelText: '写下你的回应',
                                border: OutlineInputBorder(),
                              ),
                            ),
                          ),
                          const SizedBox(height: 10),
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton(
                              onPressed: _draft.trim().isEmpty
                                  ? null
                                  : _submitTyping,
                              child: const Text('提交文字回答'),
                            ),
                          ),
                        ],
                      ],
                      if (_state.status == TrainingStatus.recording)
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            const Text('正在等待你的回答'),
                            const SizedBox(height: 12),
                            FilledButton(
                              onPressed: () => _dispatch(
                                TrainingEvent(
                                  'stop-recording',
                                  <String, Object?>{
                                    'generationId': _state.generationId,
                                  },
                                ),
                              ),
                              child: const Text('提交模拟语音'),
                            ),
                          ],
                        ),
                      if (isProcessing)
                        const Padding(
                          padding: EdgeInsets.only(top: 4),
                          child: Text('正在给出这轮反馈……'),
                        ),
                      if (_state.status == TrainingStatus.showingFeedback &&
                          _state.evaluation != null)
                        _Feedback(
                          success: _state.evaluation!.contextualSuccess,
                          onVariant: () =>
                              _dispatch(const TrainingEvent('enter-variant')),
                          onComplete: () =>
                              _dispatch(const TrainingEvent('complete-task')),
                        ),
                      if (_state.status == TrainingStatus.transitioning)
                        const Text('换一个信息，再完成同一个沟通目的。'),
                      if (_state.status == TrainingStatus.recoverableError)
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            const Text(
                              '这次技术步骤没有完成',
                              style: TextStyle(fontWeight: FontWeight.w800),
                            ),
                            const SizedBox(height: 8),
                            const Text('没有产生负面能力记录，你可以回到当前句重新尝试。'),
                            const SizedBox(height: 12),
                            FilledButton(
                              onPressed: () =>
                                  _dispatch(const TrainingEvent('retry')),
                              child: const Text('再试一次'),
                            ),
                          ],
                        ),
                      if (_state.status == TrainingStatus.completed)
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            const Text(
                              '这句练习完成了',
                              style: TextStyle(fontWeight: FontWeight.w800),
                            ),
                            const SizedBox(height: 8),
                            const Text('完成一次任务不会直接改变能力画像，之后还会用陌生变体复核。'),
                            const SizedBox(height: 12),
                            FilledButton(
                              onPressed: _nextExpression,
                              child: const Text('下一句'),
                            ),
                          ],
                        ),
                      if (_state.status ==
                          TrainingStatus.awaitingOutput) ...<Widget>[
                        const Divider(height: 28),
                        Wrap(
                          spacing: 8,
                          children: <Widget>[
                            for (var level = 1; level <= 3; level++)
                              OutlinedButton(
                                onPressed: () => _dispatch(
                                  TrainingEvent(
                                    'request-hint',
                                    <String, Object?>{'level': level},
                                  ),
                                ),
                                child: Text('提示 $level'),
                              ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Feedback extends StatelessWidget {
  const _Feedback({
    required this.success,
    required this.onVariant,
    required this.onComplete,
  });

  final bool success;
  final VoidCallback onVariant;
  final VoidCallback onComplete;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            success ? '对方可以接住你的意思' : '这次还没有完成沟通任务',
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          const Text('自然的相近表达也算成功；下一步换一个信息再试。'),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: <Widget>[
              OutlinedButton(onPressed: onVariant, child: const Text('练习变式')),
              FilledButton(onPressed: onComplete, child: const Text('完成这句')),
            ],
          ),
        ],
      ),
    );
  }
}
