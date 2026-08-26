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
}
