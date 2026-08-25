import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:spanish_mobile/core/platform/fake_platform_capabilities.dart';
import 'package:spanish_mobile/core/platform/flutter_secure_storage_adapter.dart';
import 'package:spanish_mobile/core/platform/platform_capabilities.dart';
import 'package:spanish_mobile/shared/widgets/surface_card.dart';

const _storageKey =
    'content-pack-progress:v1:immersive.first-cafe-conversation';

class FakeContentPackExperience extends StatefulWidget {
  const FakeContentPackExperience({
    required this.onBack,
    required this.onOpenPractice,
    this.storage,
    this.textToSpeech,
    super.key,
  });

  final VoidCallback onBack;
  final VoidCallback onOpenPractice;
  final SecureStorage? storage;
  final TextToSpeech? textToSpeech;

  @override
  State<FakeContentPackExperience> createState() =>
      _FakeContentPackExperienceState();
}

class _FakeContentPackExperienceState extends State<FakeContentPackExperience> {
  final _draftController = TextEditingController();
  final _transferController = TextEditingController();
  final _completed = <int>{};
  final _expanded = <int>{};
  late final SecureStorage _storage;
  late final TextToSpeech _textToSpeech;
  bool _loading = true;
  bool _speaking = false;
  String? _notice;

  static const _fullText =
      'Después de clase, Marta entra en una cafetería del campus. '
      'Ve a una compañera nueva junto a la ventana y se acerca con una sonrisa.';
  static const _segments = <({String es, String zh})>[
    (es: _fullText, zh: '下课后，Marta 走进校园咖啡馆，看到一位新同学并走过去打招呼。'),
    (
      es: 'Le cuenta que le gusta viajar y probar la comida local.',
      zh: '她告诉对方，自己喜欢旅行和尝试当地美食。',
    ),
    (
      es: 'Quieren seguir en contacto y hablar otro día.',
      zh: '她们希望保持联系，改天继续聊天。',
    ),
  ];

  @override
  void initState() {
    super.initState();
    _storage = widget.storage ?? const FlutterSecureStorageAdapter();
    _textToSpeech = widget.textToSpeech ?? FakeTextToSpeech();
    _restore();
  }

  @override
  void dispose() {
    _draftController.dispose();
    _transferController.dispose();
    unawaited(_textToSpeech.stop());
    super.dispose();
  }

  Future<void> _restore() async {
    try {
      final raw = await _storage.read(_storageKey);
      if (raw != null) {
        final value = jsonDecode(raw);
        if (value is Map) {
          final completed = value['completed'];
          final draft = value['draft'];
          final transferDraft = value['transferDraft'];
          if (completed is List) {
            _completed.addAll(
              completed
                  .whereType<num>()
                  .map((item) => item.toInt())
                  .where((item) => item >= 0 && item < 5),
            );
          }
          if (draft is String) _draftController.text = draft;
          if (transferDraft is String) _transferController.text = transferDraft;
        }
      }
    } catch (_) {
      // Corrupt progress is ignored so the content pack remains usable.
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _persist() async {
    try {
      await _storage.write(
        _storageKey,
        jsonEncode(<String, Object?>{
          'completed': _completed.toList()..sort(),
          'draft': _draftController.text,
          'transferDraft': _transferController.text,
        }),
      );
    } catch (_) {
      // In-memory progress remains usable when secure storage is unavailable.
    }
  }

  void _complete(int activity) {
    if (_completed.add(activity)) {
      if (mounted) setState(() {});
      unawaited(_persist());
    }
  }

  Future<void> _speak() async {
    setState(() {
      _speaking = true;
      _notice = null;
    });
    try {
      await _textToSpeech.speak(_fullText, languageTag: 'es-ES');
      _complete(0);
    } catch (_) {
      _complete(0);
      if (mounted) {
        setState(() => _notice = '当前无法朗读，已保留听力步骤，你可以展开文本继续。');
      }
    } finally {
      if (mounted) setState(() => _speaking = false);
    }
  }

  void _toggleSegment(int index) {
    final wasExpanded = _expanded.contains(index);
    setState(() {
      if (wasExpanded) {
        _expanded.remove(index);
      } else {
        _expanded.add(index);
      }
    });
    if (!wasExpanded) _complete(index == 0 ? 1 : 2);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    final completedCount = _completed.length;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(18, 28, 18, 40),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              TextButton.icon(
                onPressed: widget.onBack,
                icon: const Icon(Icons.arrow_back_rounded),
                label: const Text('返回探索'),
              ),
              const SizedBox(height: 8),
              Text(
                '沉浸内容包 · A2',
                style: Theme.of(context).textTheme.labelMedium,
              ),
              const SizedBox(height: 6),
              Text(
                '咖啡馆里的新朋友',
                style: Theme.of(context).textTheme.headlineMedium
                    ?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              const Text('听懂一段初次认识的对话，再用自己的话继续交流。'),
              const SizedBox(height: 18),
              SurfaceCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const Text(
                      '当前进度',
                      style: TextStyle(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 8),
                    Text('$completedCount/5 个步骤'),
                    const SizedBox(height: 8),
                    LinearProgressIndicator(value: completedCount / 5),
                  ],
                ),
              ),
              if (_notice != null) ...<Widget>[
                const SizedBox(height: 12),
                Text(_notice!, key: const ValueKey('content-pack-notice')),
              ],
              const SizedBox(height: 16),
              _step(
                number: 1,
                title: '先听全文',
                child: FilledButton.icon(
                  onPressed: _speaking ? null : _speak,
                  icon: const Icon(Icons.volume_up_outlined),
                  label: Text(_speaking ? '正在朗读' : '播放全文'),
                ),
                completed: _completed.contains(0),
              ),
              _step(
                number: 2,
                title: '看懂一段',
                child: _segmentButton(0),
                completed: _completed.contains(1),
              ),
              _step(
                number: 3,
                title: '写下回复',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    TextField(
                      controller: _draftController,
                      minLines: 2,
                      maxLines: 4,
                      onChanged: (_) {
                        setState(() {});
                        unawaited(_persist());
                      },
                      decoration: const InputDecoration(
                        border: OutlineInputBorder(),
                        labelText: '你的回复',
                        hintText: '用自己的话继续这段对话。',
                      ),
                    ),
                    const SizedBox(height: 10),
                    FilledButton(
                      onPressed: _draftController.text.trim().length >= 12
                          ? () => _complete(3)
                          : null,
                      child: const Text('完成这一步'),
                    ),
                  ],
                ),
                completed: _completed.contains(3),
              ),
              _step(
                number: 4,
                title: '准备开口',
                child: FilledButton(
                  onPressed: () {
                    _complete(4);
                    widget.onOpenPractice();
                  },
                  child: const Text('进入口语复核'),
                ),
                completed: _completed.contains(4),
              ),
              _step(
                number: 5,
                title: '换个情境',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    const Text('把人物和兴趣换成你真实会遇到的情境。'),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _transferController,
                      minLines: 2,
                      maxLines: 4,
                      onChanged: (_) {
                        setState(() {});
                        unawaited(_persist());
                      },
                      decoration: const InputDecoration(
                        border: OutlineInputBorder(),
                        labelText: '你的新情境',
                        hintText: '换一个人物、地点或兴趣再写一句。',
                      ),
                    ),
                    const SizedBox(height: 10),
                    FilledButton(
                      onPressed: _transferController.text.trim().length >= 12
                          ? () => _complete(2)
                          : null,
                      child: const Text('完成迁移'),
                    ),
                  ],
                ),
                completed: _completed.contains(2),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _segmentButton(int index) {
    final expanded = _expanded.contains(index);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        OutlinedButton(
          onPressed: () => _toggleSegment(index),
          child: Text(expanded ? '收起文本' : '展开西语和中文'),
        ),
        if (expanded) ...<Widget>[
          const SizedBox(height: 10),
          Text(
            _segments[index].es,
            key: const ValueKey('content-pack-spanish'),
          ),
          const SizedBox(height: 6),
          Text(_segments[index].zh),
        ],
      ],
    );
  }

  Widget _step({
    required int number,
    required String title,
    required Widget child,
    required bool completed,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: SurfaceCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                CircleAvatar(radius: 14, child: Text('$number')),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
                if (completed) const Text('已完成'),
              ],
            ),
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}
