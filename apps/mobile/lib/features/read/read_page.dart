import 'package:flutter/material.dart';

import '../../core/platform/platform_capabilities.dart';
import '../training/fakes/fake_training_loop.dart';

class ReadArticleSegment {
  const ReadArticleSegment({required this.position, required this.text});

  final int position;
  final String text;
}

class ReadArticle {
  const ReadArticle({
    required this.id,
    required this.title,
    required this.summary,
    required this.locale,
    required this.segments,
    this.sourceName = '',
    this.estimatedReadingMinutes = 1,
    this.oralTransferType = 'none',
  });

  final String id;
  final String title;
  final String summary;
  final String locale;
  final String sourceName;
  final int estimatedReadingMinutes;
  final String oralTransferType;
  final List<ReadArticleSegment> segments;
}

const _transferTypes = <String>[
  'summary',
  'opinion',
  'personal_transfer',
  'character_dialogue',
];

const _transferLabels = <String, String>{
  'summary': '说说文章讲了什么',
  'opinion': '说说你的看法',
  'personal_transfer': '联系到自己的生活',
  'character_dialogue': '和角色聊两句',
};

const _transferDescriptions = <String, String>{
  'summary': '抓住一到两个关键变化，用自己的话复述。',
  'opinion': '选一个细节，说说你赞同、意外或不理解的地方。',
  'personal_transfer': '把文章里的场景换成你真实经历过的一个片段。',
  'character_dialogue': '假设你把文章分享给朋友，自然回应并追问一句。',
};

String _transferPrompt(String type, String title) {
  const prompts = <String, String>{
    'summary': '用自己的话说说这篇文章讲了什么，先说最重要的一件事。',
    'opinion': '选一个文章里的细节，说说你的看法，并补一句为什么。',
    'personal_transfer': '把文章里的一个场景联系到自己的生活，讲一个具体片段。',
    'character_dialogue': '假设你把这篇文章分享给一位朋友，先说你的反应，再追问一句。',
  };
  return '${prompts[type] ?? prompts['summary']}（文章：《$title》）';
}

abstract interface class ReadProgressStore {
  Future<int?> read(String articleId);
  Future<void> write(String articleId, int position);
}

class SecureReadProgressStore implements ReadProgressStore {
  SecureReadProgressStore(this.storage);

  final SecureStorage storage;

  String _key(String articleId) => 'reading-progress:v1:$articleId';

  @override
  Future<int?> read(String articleId) async {
    final value = await storage.read(_key(articleId));
    return value == null ? null : int.tryParse(value);
  }

  @override
  Future<void> write(String articleId, int position) =>
      storage.write(_key(articleId), '$position');
}

typedef ReadSpeech = Future<void> Function(String text, String locale);

class ArticleReaderPage extends StatefulWidget {
  const ArticleReaderPage({
    super.key,
    required this.article,
    this.progressStore,
    this.speak,
    this.onStartTransfer,
  });

  final ReadArticle article;
  final ReadProgressStore? progressStore;
  final ReadSpeech? speak;
  final ValueChanged<String>? onStartTransfer;

  @override
  State<ArticleReaderPage> createState() => _ArticleReaderPageState();
}

class _ArticleReaderPageState extends State<ArticleReaderPage> {
  late final ScrollController _scrollController;
  int _position = 0;
  String _status = '';
  String? _activeTransfer;
  String _transferDraft = '';

  @override
  void initState() {
    super.initState();
    _scrollController = ScrollController()..addListener(_savePosition);
    _restorePosition();
  }

  Future<void> _restorePosition() async {
    final saved = await widget.progressStore?.read(widget.article.id);
    if (!mounted || saved == null || widget.article.segments.isEmpty) return;
    setState(
      () => _position = saved.clamp(0, widget.article.segments.length - 1),
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.jumpTo(
          _scrollController.position.maxScrollExtent *
              (_position / widget.article.segments.length),
        );
      }
    });
  }

  void _savePosition() {
    if (!_scrollController.hasClients || widget.article.segments.isEmpty) {
      return;
    }
    final next =
        (_scrollController.offset /
                (_scrollController.position.maxScrollExtent == 0
                    ? 1
                    : _scrollController.position.maxScrollExtent) *
                widget.article.segments.length)
            .floor()
            .clamp(0, widget.article.segments.length - 1);
    if (next == _position) return;
    setState(() => _position = next);
    widget.progressStore?.write(widget.article.id, next);
  }

  Future<void> _speak(String text) async {
    if (widget.speak == null) {
      setState(() => _status = '移动端暂时无法朗读，你仍可以继续阅读。');
      return;
    }
    try {
      await widget.speak!(text, widget.article.locale);
      if (mounted) setState(() => _status = '朗读完成。');
    } catch (_) {
      if (mounted) setState(() => _status = '朗读暂时失败，正文阅读不受影响。');
    }
  }

  void _startTransfer(String type) {
    if (widget.onStartTransfer != null) {
      widget.onStartTransfer!(type);
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => FakeTrainingLoop(
          articleTransferType: type,
          articleTitle: widget.article.title,
        ),
      ),
    );
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final progress = widget.article.segments.isEmpty
        ? 0
        : ((_position + 1) / widget.article.segments.length * 100).round();
    return Scaffold(
      appBar: AppBar(title: const Text('阅读文章')),
      body: SafeArea(
        child: SingleChildScrollView(
          controller: _scrollController,
          padding: const EdgeInsets.fromLTRB(20, 22, 20, 40),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                widget.article.title,
                style: Theme.of(context).textTheme.headlineMedium
                    ?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 10),
              Text(
                widget.article.summary,
                style: TextStyle(color: colors.onSurfaceVariant, height: 1.55),
              ),
              const SizedBox(height: 12),
              Text(
                '${widget.article.sourceName} · ${widget.article.estimatedReadingMinutes} 分钟',
                style: TextStyle(color: colors.onSurfaceVariant, fontSize: 12),
              ),
              const SizedBox(height: 18),
              Semantics(
                label: '文章阅读进度',
                value: '$progress%',
                child: LinearProgressIndicator(value: progress / 100),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: <Widget>[
                  FilledButton.icon(
                    onPressed: () => _speak(
                      widget.article.segments
                          .map((segment) => segment.text)
                          .join(' '),
                    ),
                    icon: const Icon(Icons.volume_up_outlined),
                    label: const Text('播放全文'),
                  ),
                  OutlinedButton.icon(
                    onPressed: () =>
                        setState(() => _status = '选中词语后可在这里查看上下文辅助。'),
                    icon: const Icon(Icons.translate_outlined),
                    label: const Text('词语辅助'),
                  ),
                ],
              ),
              if (_status.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Text(_status, style: TextStyle(color: colors.primary)),
                ),
              const SizedBox(height: 20),
              SelectionArea(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: widget.article.segments.map((segment) {
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 22),
                      child: Semantics(
                        label: '第 ${segment.position + 1} 段',
                        child: Text(
                          segment.text,
                          style: Theme.of(context).textTheme.bodyLarge
                              ?.copyWith(fontSize: 19, height: 1.85),
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ),
              const Divider(height: 36),
              Text(
                '阅读位置会按文章版本保存；阅读活动不会直接成为口语能力证据。',
                style: TextStyle(color: colors.onSurfaceVariant, height: 1.55),
              ),
              const SizedBox(height: 24),
              _TransferSection(
                title: widget.article.title,
                activeType: _activeTransfer,
                draft: _transferDraft,
                recommendedType: widget.article.oralTransferType == 'none'
                    ? null
                    : widget.article.oralTransferType,
                onSelect: (type) => setState(() {
                  _activeTransfer = type;
                }),
                onDraftChanged: (value) => setState(() {
                  _transferDraft = value;
                }),
                onSaveDraft: () => setState(() {
                  _status = '草稿已保存；尚未进入口语评估，也不会改变口语能力画像。';
                }),
                onSkip: () => setState(() {
                  _activeTransfer = null;
                  _transferDraft = '';
                  _status = '已跳过这次口语迁移；阅读完成不会产生口语能力证据。';
                }),
                onStart: _startTransfer,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TransferSection extends StatefulWidget {
  const _TransferSection({
    required this.title,
    required this.activeType,
    required this.draft,
    required this.recommendedType,
    required this.onSelect,
    required this.onDraftChanged,
    required this.onSaveDraft,
    required this.onSkip,
    required this.onStart,
  });

  final String title;
  final String? activeType;
  final String draft;
  final String? recommendedType;
  final ValueChanged<String> onSelect;
  final ValueChanged<String> onDraftChanged;
  final VoidCallback onSaveDraft;
  final VoidCallback onSkip;
  final ValueChanged<String> onStart;

  @override
  State<_TransferSection> createState() => _TransferSectionState();
}

class _TransferSectionState extends State<_TransferSection> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.draft);
  }

  @override
  void didUpdateWidget(covariant _TransferSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.draft != widget.draft && _controller.text != widget.draft) {
      _controller.value = TextEditingValue(
        text: widget.draft,
        selection: TextSelection.collapsed(offset: widget.draft.length),
      );
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final options = _transferTypes.map((type) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: OutlinedButton(
          onPressed: () => widget.onSelect(type),
          style: OutlinedButton.styleFrom(
            alignment: Alignment.centerLeft,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            side: BorderSide(
              color: widget.activeType == type
                  ? colors.primary
                  : colors.outlineVariant,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                _transferLabels[type]!,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              Text(
                _transferDescriptions[type]!,
                style: TextStyle(color: colors.onSurfaceVariant, fontSize: 12),
              ),
              if (widget.recommendedType == type)
                Text(
                  '这篇文章的推荐方向',
                  style: TextStyle(
                    color: colors.primary,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
            ],
          ),
        ),
      );
    }).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          '读到口语',
          style: TextStyle(
            color: colors.primary,
            fontSize: 12,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          '把读到的内容说出来',
          style: Theme.of(context).textTheme.titleLarge
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        Text(
          '选一个自然的方向。跳过、阅读和打字都只留在阅读状态里；只有主动进入口语复核才会开始训练。',
          style: TextStyle(color: colors.onSurfaceVariant, height: 1.5),
        ),
        const SizedBox(height: 14),
        ...options,
        if (widget.activeType != null) ...<Widget>[
          const SizedBox(height: 8),
          Text(
            _transferPrompt(widget.activeType!, widget.title),
            style: const TextStyle(height: 1.5),
          ),
          const SizedBox(height: 10),
          TextField(
            onChanged: widget.onDraftChanged,
            controller: _controller,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(
              labelText: '口语迁移草稿（可选）',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: <Widget>[
              FilledButton(
                onPressed: () => widget.onStart(widget.activeType!),
                child: const Text('进入口语复核'),
              ),
              OutlinedButton(
                onPressed: widget.onSaveDraft,
                child: const Text('先保存草稿'),
              ),
              TextButton(onPressed: widget.onSkip, child: const Text('跳过这一步')),
            ],
          ),
        ],
      ],
    );
  }
}

class ReadPage extends StatelessWidget {
  const ReadPage({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return LayoutBuilder(
      builder: (context, constraints) {
        final horizontal = constraints.maxWidth >= 760 ? 48.0 : 18.0;
        return SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(horizontal, 34, horizontal, 40),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 900),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    '安静输入',
                    style: TextStyle(
                      color: colors.primary,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.2,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '读一篇真实的西语文章',
                    style: Theme.of(context).textTheme.headlineMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    '在不方便开口时，先让语言进入耳朵和眼睛。读过的内容不会直接变成口语能力证据。',
                    style: TextStyle(
                      color: colors.onSurfaceVariant,
                      height: 1.6,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: colors.surface,
                      border: Border.all(color: colors.outlineVariant),
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Icon(Icons.menu_book_outlined, color: colors.primary),
                        const SizedBox(height: 14),
                        Text(
                          '可公开阅读的文章正在准备中',
                          style: Theme.of(context).textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '每篇文章都会经过来源、版权和语言审核；准备好后会出现在这里。',
                          style: TextStyle(
                            color: colors.onSurfaceVariant,
                            height: 1.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
