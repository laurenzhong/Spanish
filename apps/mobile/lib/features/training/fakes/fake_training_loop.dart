import 'dart:async';

import 'package:flutter/material.dart';
import 'package:spanish_mobile/shared/widgets/surface_card.dart';

import '../domain/training_engine.dart';
import '../domain/training_event.dart';
import '../domain/training_state.dart';
import 'fake_evaluator.dart';

class _Expression {
  const _Expression({
    required this.key,
    required this.goalKey,
    required this.goalTitle,
    required this.text,
    required this.translation,
    required this.intent,
  });

  final String key;
  final String goalKey;
  final String goalTitle;
  final String text;
  final String translation;
  final String intent;
}

class FakeTrainingLoop extends StatefulWidget {
  const FakeTrainingLoop({super.key});

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
    ),
    _Expression(
      key: 'relationship.como-se-llama',
      goalKey: 'communication.relationship.ask-name',
      goalTitle: '询问姓名',
      text: '¿Cómo se llama?',
      translation: '您叫什么名字？',
      intent: '礼貌询问初次见面的人的姓名。',
    ),
    _Expression(
      key: 'relationship.me-gusta-viajar',
      goalKey: 'communication.relationship.share-interest',
      goalTitle: '分享兴趣',
      text: 'Me gusta viajar y probar la comida local.',
      translation: '我喜欢旅行和尝试当地美食。',
      intent: '分享个人兴趣，为对方追问创造机会。',
    ),
    _Expression(
      key: 'need.necesito-ayuda',
      goalKey: 'communication.need.ask-help',
      goalTitle: '请求帮助',
      text: 'Necesito ayuda.',
      translation: '我需要帮助。',
      intent: '在需要协助时直接说明核心需求。',
    ),
  ];

  final _evaluator = const FakeEvaluator();
  final _timers = <Timer>[];
  TrainingState _state = TrainingState.initial();
  int _expressionIndex = 0;
  String _draft = '';

  _Expression get _expression => _expressions[_expressionIndex];

  @override
  void initState() {
    super.initState();
    _dispatch(
      const TrainingEvent('content-loaded', <String, Object?>{
        'contentKey': 'start.como-va-todo',
        'goalKey': 'communication.start.check-in',
      }),
    );
  }

  @override
  void dispose() {
    for (final timer in _timers) {
      timer.cancel();
    }
    super.dispose();
  }

  void _dispatch(TrainingEvent event) {
    final result = transition(_state, event);
    if (!mounted) {
      _state = result.state;
      return;
    }
    setState(() => _state = result.state);
    _runEffects(result.effects);
  }

  void _runEffects(List<TrainingEffect> effects) {
    for (final effect in effects) {
      switch (effect.type) {
        case 'play-input':
          _schedule(const Duration(milliseconds: 220), () {
            _dispatch(const TrainingEvent('input-playback-completed'));
          });
          break;
        case 'prepare-variant':
          _schedule(const Duration(milliseconds: 180), () {
            _dispatch(const TrainingEvent('variant-ready'));
          });
          break;
        case 'transcribe':
          final generationId = effect.data['generationId'] as int;
          final simulatedTranscript = _expression.text;
          _schedule(const Duration(milliseconds: 180), () {
            _dispatch(TrainingEvent('transcription-succeeded', <String, Object?>{
              'generationId': generationId,
              'transcript': simulatedTranscript,
              'confidence': 0.96,
            }));
          });
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
            if (mounted && generationId == _state.generationId) _dispatch(event);
          });
          break;
        default:
          break;
      }
    }
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
    setState(() {
      _expressionIndex = nextIndex;
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
    final isProcessing = _state.status == TrainingStatus.transcribing ||
        _state.status == TrainingStatus.evaluating;

    return SingleChildScrollView(
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
                      style: TextStyle(fontSize: 25, fontWeight: FontWeight.w800),
                    ),
                  ),
                  Text('${_expressionIndex + 1}/4', style: const TextStyle(fontWeight: FontWeight.w700)),
                ],
              ),
              const SizedBox(height: 20),
              SurfaceCard(
                color: const Color(0xFFF8FBFF),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(_statusLabel(_state.status), style: TextStyle(color: colors.primary, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 18),
                    Text(_expression.goalTitle, style: TextStyle(color: colors.primary, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 8),
                    Text(_expression.text, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 8),
                    Text(_expression.translation),
                    const SizedBox(height: 6),
                    Text(_expression.intent, style: TextStyle(color: colors.onSurfaceVariant, height: 1.5)),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              SurfaceCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('提示 ${_state.hintLevel}/3', style: TextStyle(color: colors.onSurfaceVariant, fontSize: 12)),
                    const SizedBox(height: 16),
                    if (_state.status == TrainingStatus.presentingInput)
                      const Text('先听输入，听完后用自己的话回应。'),
                    if (_state.status == TrainingStatus.awaitingOutput) ...<Widget>[
                      Row(
                        children: <Widget>[
                          Expanded(child: OutlinedButton(onPressed: () => _dispatch(const TrainingEvent('switch-to-silent')), child: const Text('用文字回答'))),
                          const SizedBox(width: 10),
                          Expanded(child: FilledButton(onPressed: () => _dispatch(const TrainingEvent('start-recording')), child: const Text('开始模拟录音'))),
                        ],
                      ),
                      if (_state.outputMode == TrainingOutputMode.typing) ...<Widget>[
                        const SizedBox(height: 14),
                        TextField(
                          onChanged: (value) => setState(() => _draft = value),
                          minLines: 2,
                          maxLines: 4,
                          decoration: const InputDecoration(labelText: '写下你的回应', border: OutlineInputBorder()),
                        ),
                        const SizedBox(height: 10),
                        SizedBox(width: double.infinity, child: FilledButton(onPressed: _draft.trim().isEmpty ? null : _submitTyping, child: const Text('提交文字回答'))),
                      ],
                    ],
                    if (_state.status == TrainingStatus.recording)
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          const Text('正在等待你的模拟回答'),
                          const SizedBox(height: 12),
                          FilledButton(onPressed: () => _dispatch(TrainingEvent('stop-recording', <String, Object?>{'generationId': _state.generationId})), child: const Text('提交模拟语音')),
                        ],
                      ),
                    if (isProcessing) const Padding(padding: EdgeInsets.only(top: 4), child: Text('正在给出这轮反馈……')),
                    if (_state.status == TrainingStatus.showingFeedback && _state.evaluation != null)
                      _Feedback(
                        success: _state.evaluation!.contextualSuccess,
                        onVariant: () => _dispatch(const TrainingEvent('enter-variant')),
                        onComplete: () => _dispatch(const TrainingEvent('complete-task')),
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
                            onPressed: () => _dispatch(const TrainingEvent('retry')),
                            child: const Text('再试一次'),
                          ),
                        ],
                      ),
                    if (_state.status == TrainingStatus.completed)
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          const Text('这句练习完成了', style: TextStyle(fontWeight: FontWeight.w800)),
                          const SizedBox(height: 8),
                          const Text('完成一次任务不会直接改变能力画像，之后还会用陌生变体复核。'),
                          const SizedBox(height: 12),
                          FilledButton(onPressed: _nextExpression, child: const Text('下一句')),
                        ],
                      ),
                    if (_state.status == TrainingStatus.awaitingOutput) ...<Widget>[
                      const Divider(height: 28),
                      Wrap(
                        spacing: 8,
                        children: <Widget>[
                          for (var level = 1; level <= 3; level++)
                            OutlinedButton(
                              onPressed: () => _dispatch(TrainingEvent('request-hint', <String, Object?>{'level': level})),
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
    );
  }
}

class _Feedback extends StatelessWidget {
  const _Feedback({required this.success, required this.onVariant, required this.onComplete});

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
          Text(success ? '对方可以接住你的意思' : '这次还没有完成沟通任务', style: const TextStyle(fontWeight: FontWeight.w800)),
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
