import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/features/profile/profile_page.dart';

void main() {
  testWidgets('selects a skill axis and a heatmap day', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: ProfilePage())),
    );

    expect(find.text('我的进步'), findsOneWidget);
    expect(find.text('八维能力'), findsOneWidget);
    expect(find.textContaining('当前选择：听辨理解'), findsOneWidget);

    await tester.tap(find.widgetWithText(ChoiceChip, '迁移表达'));
    await tester.pump();
    expect(find.textContaining('当前选择：迁移表达'), findsOneWidget);

    final activeDay = find.byTooltip(RegExp('分钟有效学习')).first;
    await tester.ensureVisible(activeDay);
    await tester.tap(activeDay);
    await tester.pump();
    expect(find.byKey(const ValueKey('heatmap-day-detail')), findsOneWidget);
    expect(find.textContaining('分钟有效学习'), findsOneWidget);
  });

  testWidgets('requires confirmation before removing privacy data', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: ProfilePage())),
    );

    final deleteMemory = find.text('删除记忆');
    await tester.ensureVisible(deleteMemory);
    await tester.tap(deleteMemory);
    await tester.pumpAndSettle();
    expect(find.text('删除关系记忆？'), findsOneWidget);

    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(find.text('删除记忆'), findsOneWidget);

    await tester.ensureVisible(deleteMemory);
    await tester.tap(deleteMemory);
    await tester.pumpAndSettle();
    await tester.tap(find.text('确认删除'));
    await tester.pumpAndSettle();
    expect(find.text('删除记忆'), findsNothing);
    expect(find.byKey(const ValueKey('profile-notice')), findsOneWidget);
  });
}
