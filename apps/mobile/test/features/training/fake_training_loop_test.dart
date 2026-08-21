import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/features/training/fakes/fake_training_loop.dart';

void main() {
  testWidgets('reaches output selection and completes a typed natural alternative', (
    tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: FakeTrainingLoop()));
    await tester.pump(const Duration(milliseconds: 220));

    expect(find.text('轮到你了'), findsOneWidget);
    await tester.tap(find.text('用文字回答'));
    await tester.pump();
    await tester.enterText(find.byType(TextField), '¿Qué tal todo?');
    await tester.tap(find.text('提交文字回答'));
    await tester.pump(const Duration(milliseconds: 180));
    await tester.pump(const Duration(milliseconds: 1));

    expect(find.text('对方可以接住你的意思'), findsOneWidget);
    await tester.tap(find.text('完成这句'));
    await tester.pump();
    expect(find.text('这句练习完成了'), findsOneWidget);
  });
}
