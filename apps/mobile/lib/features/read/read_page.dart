import 'package:flutter/material.dart';

import '../../core/platform/platform_capabilities.dart';

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
  });

  final String id;
  final String title;
  final String summary;
  final String locale;
  final String sourceName;
  final int estimatedReadingMinutes;
  final List<ReadArticleSegment> segments;
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
  Future<void> write(String articleId, int position) => storage.write(_key(articleId), '$position');
}

typedef ReadSpeech = Future<void> Function(String text, String locale);

class ArticleReaderPage extends StatefulWidget {
  const ArticleReaderPage({super.key, required this.article, this.progressStore, this.speak});

  final ReadArticle article;
  final ReadProgressStore? progressStore;
  final ReadSpeech? speak;

  @override
  State<ArticleReaderPage> createState() => _ArticleReaderPageState();
}

class _ArticleReaderPageState extends State<ArticleReaderPage> {
  late final ScrollController _scrollController;
  int _position = 0;
  String _status = '';

  @override
  void initState() {
    super.initState();
    _scrollController = ScrollController()..addListener(_savePosition);
    _restorePosition();
  }

  Future<void> _restorePosition() async {
    final saved = await widget.progressStore?.read(widget.article.id);
    if (!mounted || saved == null || widget.article.segments.isEmpty) return;
    setState(() => _position = saved.clamp(0, widget.article.segments.length - 1));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) _scrollController.jumpTo(_scrollController.position.maxScrollExtent * (_position / widget.article.segments.length));
    });
  }

  void _savePosition() {
    if (!_scrollController.hasClients || widget.article.segments.isEmpty) return;
    final next = (_scrollController.offset / (_scrollController.position.maxScrollExtent == 0 ? 1 : _scrollController.position.maxScrollExtent) * widget.article.segments.length).floor().clamp(0, widget.article.segments.length - 1);
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

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final progress = widget.article.segments.isEmpty ? 0 : ((_position + 1) / widget.article.segments.length * 100).round();
    return Scaffold(
      appBar: AppBar(title: const Text('阅读文章')),
      body: SafeArea(
        child: ListView(
          controller: _scrollController,
          padding: const EdgeInsets.fromLTRB(20, 22, 20, 40),
          children: <Widget>[
            Text(widget.article.title, style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            Text(widget.article.summary, style: TextStyle(color: colors.onSurfaceVariant, height: 1.55)),
            const SizedBox(height: 12),
            Text('${widget.article.sourceName} · ${widget.article.estimatedReadingMinutes} 分钟', style: TextStyle(color: colors.onSurfaceVariant, fontSize: 12)),
            const SizedBox(height: 18),
            Semantics(label: '文章阅读进度', value: '$progress%', child: LinearProgressIndicator(value: progress / 100)),
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: <Widget>[
              FilledButton.icon(onPressed: () => _speak(widget.article.segments.map((segment) => segment.text).join(' ')), icon: const Icon(Icons.volume_up_outlined), label: const Text('播放全文')),
              OutlinedButton.icon(onPressed: () => setState(() => _status = '选中词语后可在这里查看上下文辅助。'), icon: const Icon(Icons.translate_outlined), label: const Text('词语辅助')),
            ]),
            if (_status.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 10), child: Text(_status, style: TextStyle(color: colors.primary))),
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
                        style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontSize: 19, height: 1.85),
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
            const Divider(height: 36),
            Text('阅读位置会按文章版本保存；阅读活动不会直接成为口语能力证据。', style: TextStyle(color: colors.onSurfaceVariant, height: 1.55)),
          ],
        ),
      ),
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
                    style: Theme.of(context)
                        .textTheme
                        .headlineMedium
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
                          style: Theme.of(context)
                              .textTheme
                              .titleMedium
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
