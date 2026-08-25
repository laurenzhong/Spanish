import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/features/character_network/fake_character_network.dart';
import 'package:spanish_mobile/shared/widgets/product_shell.dart';

void main() {
  testWidgets('requires explicit memory selection and supports revocation', (
    tester,
  ) async {
    final network = FakeCharacterNetworkState();
    await tester.pumpWidget(MaterialApp(home: ProductShell(network: network)));

    await tester.tap(find.text('对话').last);
    await tester.pumpAndSettle();
    expect(find.text('认识一个新朋友'), findsOneWidget);
    expect(find.byType(CheckboxListTile), findsOneWidget);
    expect(network.permissions, isEmpty);

    final checkbox = find.byType(CheckboxListTile);
    await tester.ensureVisible(checkbox);
    await tester.tap(checkbox);
    final acceptButton = find.widgetWithText(FilledButton, '同意介绍');
    await tester.ensureVisible(acceptButton);
    await tester.tap(acceptButton);
    await tester.pumpAndSettle();
    expect(network.offer, isNull);
    expect(network.permissions, hasLength(1));

    await tester.tap(find.text('我的').last);
    await tester.pumpAndSettle();
    expect(find.text('已授权给角色的资料'), findsOneWidget);
    expect(find.text('喜欢摄影'), findsOneWidget);
    final revokeButton = find.widgetWithText(TextButton, '撤销授权');
    await tester.ensureVisible(revokeButton);
    await tester.tap(revokeButton);
    await tester.pumpAndSettle();
    expect(find.text('喜欢摄影'), findsNothing);
    expect(
      find.byKey(const ValueKey('character-network-notice')),
      findsOneWidget,
    );
  });

  testWidgets('accepting without selection creates no shared permission', (
    tester,
  ) async {
    final network = FakeCharacterNetworkState();
    await tester.pumpWidget(MaterialApp(home: ProductShell(network: network)));

    await tester.tap(find.text('对话').last);
    await tester.pumpAndSettle();
    final acceptButton = find.widgetWithText(FilledButton, '同意介绍');
    await tester.ensureVisible(acceptButton);
    await tester.tap(acceptButton);
    await tester.pumpAndSettle();

    expect(network.permissions, isEmpty);
    await tester.tap(find.text('我的').last);
    await tester.pumpAndSettle();
    expect(find.text('已授权给角色的资料'), findsNothing);
    expect(find.text('我的进步'), findsOneWidget);
  });

  testWidgets('can decline an introduction without creating a permission', (
    tester,
  ) async {
    final network = FakeCharacterNetworkState();
    await tester.pumpWidget(MaterialApp(home: ProductShell(network: network)));

    await tester.tap(find.text('对话').last);
    await tester.pumpAndSettle();
    final declineButton = find.widgetWithText(TextButton, '先不认识');
    await tester.ensureVisible(declineButton);
    await tester.tap(declineButton);
    await tester.pumpAndSettle();

    expect(network.offer, isNull);
    expect(network.permissions, isEmpty);
    expect(
      find.byKey(const ValueKey('character-network-notice')),
      findsOneWidget,
    );
  });
}
