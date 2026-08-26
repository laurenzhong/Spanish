import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/features/read/read_page.dart';

class _MemoryProgressStore implements ReadProgressStore {
  final values = <String, int>{};

  @override
  Future<int?> read(String articleId) async => values[articleId];

  @override
  Future<void> write(String articleId, int position) async => values[articleId] = position;
}

void main() {
  testWidgets('renders normalized article reader controls and progress', (tester) async {
    final store = _MemoryProgressStore()..values['article-1'] = 1;
    const article = ReadArticle(
      id: 'article-1',
      title: 'Una conversación',
      summary: 'Una historia breve.',
      locale: 'es-ES',
      sourceName: 'Sueño Editorial',
      oralTransferType: 'personal_transfer',
      segments: <ReadArticleSegment>[
        ReadArticleSegment(position: 0, text: 'Primera parte.'),
        ReadArticleSegment(position: 1, text: 'Segunda parte.'),
      ],
    );

    await tester.pumpWidget(MaterialApp(home: ArticleReaderPage(article: article, progressStore: store)));
    await tester.pumpAndSettle();

    expect(find.text('Una conversación'), findsOneWidget);
    expect(find.text('Segunda parte.'), findsOneWidget);
    expect(find.bySemanticsLabel('文章阅读进度'), findsOneWidget);
    await tester.tap(find.text('词语辅助'));
    await tester.pump();
    expect(find.text('选中词语后可在这里查看上下文辅助。'), findsOneWidget);
  });

  testWidgets('offers optional transfer and keeps typed draft outside oral evaluation', (tester) async {
    const article = ReadArticle(
      id: 'article-2',
      title: 'Una conversación',
      summary: 'Una historia breve.',
      locale: 'es-ES',
      segments: <ReadArticleSegment>[ReadArticleSegment(position: 0, text: 'Primera parte.')],
    );
    String? startedType;
    await tester.pumpWidget(MaterialApp(home: ArticleReaderPage(article: article, onStartTransfer: (type) => startedType = type)));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('说说你的看法'));
    await tester.tap(find.text('说说你的看法'));
    await tester.pump();
    await tester.ensureVisible(find.bySemanticsLabel('口语迁移草稿（可选）'));
    await tester.enterText(find.bySemanticsLabel('口语迁移草稿（可选）'), 'Creo que...');
    await tester.tap(find.text('先保存草稿'));
    await tester.pump();
    expect(find.textContaining('尚未进入口语评估'), findsOneWidget);
    await tester.tap(find.text('进入口语复核'));
    expect(startedType, 'opinion');
    await tester.tap(find.text('跳过这一步'));
    await tester.pump();
    expect(find.text('已跳过这次口语迁移；阅读完成不会产生口语能力证据。'), findsOneWidget);
  });
}
