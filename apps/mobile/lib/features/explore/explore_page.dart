import 'package:flutter/material.dart';
import 'package:spanish_mobile/features/explore/data/explore_api.dart';
import 'package:spanish_mobile/core/platform/flutter_secure_storage_adapter.dart';
import 'package:spanish_mobile/core/platform/platform_capabilities.dart';
import 'package:spanish_mobile/features/content/fakes/fake_content_pack.dart';
import 'package:spanish_mobile/features/training/checkpoints/training_checkpoint.dart';
import 'package:spanish_mobile/features/training/fakes/fake_training_loop.dart';
import 'package:spanish_mobile/shared/widgets/page_intro.dart';
import 'package:spanish_mobile/shared/widgets/surface_card.dart';

class ExplorePage extends StatefulWidget {
  const ExplorePage({
    this.userId = 'local-user',
    this.storage,
    this.textToSpeech,
    this.api,
    super.key,
  });

  final String userId;
  final SecureStorage? storage;
  final TextToSpeech? textToSpeech;
  final ExploreApi? api;

  @override
  State<ExplorePage> createState() => _ExplorePageState();
}

class _ExplorePageState extends State<ExplorePage> {
  var _showPack = false;
  var _query = '';
  var _savedPack = false;

  @override
  void initState() {
    super.initState();
    final api = widget.api;
    if (api != null) {
      api.fetchDashboard().then((snapshot) {
        if (!mounted || snapshot == null) return;
        for (final pack in snapshot.packs) {
          if (pack.stableKey == 'pack.cafe') {
            setState(() => _savedPack = pack.saved);
            break;
          }
        }
      }).catchError((_) {
        // Local discovery remains usable when the API is unavailable.
      });
    }
  }

  void _openPractice() {
    final storage = widget.storage ?? const FlutterSecureStorageAdapter();
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => FakeTrainingLoop(
          checkpointStore: SecureStorageTrainingCheckpointStore(
            storage,
            userId: widget.userId,
          ),
          textToSpeech: widget.textToSpeech,
        ),
      ),
    );
  }

  static const _collections = <({String number, String title, String detail})>[
    (number: '01', title: '开始交流', detail: '问候、认识新朋友、自然开启话题'),
    (number: '02', title: '表达需要', detail: '提出请求、确认信息、解决生活问题'),
    (number: '03', title: '维持对话', detail: '回应、追问、表达兴趣和共同点'),
    (number: '04', title: '安静学习', detail: '阅读短文、听力输入与打字练习'),
  ];

  @override
  Widget build(BuildContext context) {
    if (_showPack) {
      return FakeContentPackExperience(
        onBack: () => setState(() => _showPack = false),
        onOpenPractice: _openPractice,
        storage: widget.storage,
        textToSpeech: widget.textToSpeech,
      );
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final isWide = constraints.maxWidth >= 760;

        return SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(
            isWide ? 48 : 18,
            34,
            isWide ? 48 : 18,
            40,
          ),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 1100),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const PageIntro(
                    eyebrow: '表达资料库',
                    title: '探索真实表达',
                    description: '从真实沟通目的出发，不按孤立的语法章节堆叠内容。',
                  ),
                  const SizedBox(height: 24),
                  TextField(
                    onChanged: (value) => setState(() => _query = value),
                    decoration: const InputDecoration(
                      labelText: '按你现在想说的话查找',
                      hintText: '例如：请求别人重复',
                      prefixIcon: Icon(Icons.search),
                    ),
                  ),
                  const SizedBox(height: 18),
                  GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: isWide ? 4 : 2,
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                      childAspectRatio: isWide ? 0.95 : 0.9,
                    ),
                    itemCount: _collections.length,
                    itemBuilder: (context, index) {
                      final collection = _collections[index];
                      final visible = _query.trim().isEmpty || '${collection.title} ${collection.detail}'.contains(_query.trim());
                      return Opacity(
                        opacity: visible ? 1 : 0.35,
                        child: IgnorePointer(
                          ignoring: !visible,
                          child: SurfaceCard(
                            padding: const EdgeInsets.all(18),
                            child: InkWell(
                              onTap: index == 0 ? _openPractice : () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('这组内容正在整理中。'))),
                              borderRadius: BorderRadius.circular(14),
                              child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              collection.number,
                              style: TextStyle(
                                color: Theme.of(context).colorScheme.primary,
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 1,
                              ),
                            ),
                            const Spacer(),
                            Text(
                              collection.title,
                              style: Theme.of(context).textTheme.titleMedium
                                  ?.copyWith(fontWeight: FontWeight.w800),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              collection.detail,
                              style: Theme.of(context).textTheme.bodySmall
                                  ?.copyWith(
                                    color: Theme.of(context)
                                        .colorScheme
                                        .onSurfaceVariant,
                                    height: 1.45,
                                  ),
                            ),
                          ],
                              ),
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                  const SizedBox(height: 16),
                  SurfaceCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          '沉浸阅读',
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(
                                color: Theme.of(context).colorScheme.primary,
                                fontWeight: FontWeight.w800,
                              ),
                        ),
                        const SizedBox(height: 7),
                        Text(
                          '短文与故事内容包',
                          style: Theme.of(context).textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '适合不方便开口时继续理解语法、搭配和真实语境。',
                          style: TextStyle(
                            color: Theme.of(context)
                                .colorScheme
                                .onSurfaceVariant,
                            height: 1.5,
                          ),
                        ),
                        const SizedBox(height: 14),
                        Row(
                          children: [
                            Expanded(
                              child: FilledButton.icon(
                                onPressed: () => setState(() => _showPack = true),
                                icon: const Icon(Icons.menu_book_outlined),
                                label: const Text('打开咖啡馆内容包'),
                              ),
                            ),
                            const SizedBox(width: 8),
                            IconButton(
                              tooltip: _savedPack ? '取消保存' : '保存内容包',
                              onPressed: () {
                                final nextSaved = !_savedPack;
                                setState(() => _savedPack = nextSaved);
                                final api = widget.api;
                                if (api != null) {
                                  api.savePack(
                                    stableKey: 'pack.cafe',
                                    version: 1,
                                    totalSteps: 5,
                                    completedSteps: 0,
                                    saved: nextSaved,
                                  ).then((ok) {
                                    if (!context.mounted || ok) return;
                                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('已保存在本设备，账号同步失败，可重试。')));
                                  }).catchError((_) {
                                    if (!context.mounted) return;
                                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('已保存在本设备，账号同步失败，可重试。')));
                                  });
                                }
                              },
                              icon: Icon(_savedPack ? Icons.star : Icons.star_border),
                            ),
                          ],
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
