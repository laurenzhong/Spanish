import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spanish_mobile/shared/widgets/surface_state.dart';

void main() {
  for (final state in <SurfaceStateType, String>{
    SurfaceStateType.loading: '正在准备内容',
    SurfaceStateType.empty: '这里还没有内容',
    SurfaceStateType.error: '暂时无法载入',
    SurfaceStateType.offline: '当前处于离线状态',
  }.entries) {
    testWidgets('renders ${state.key.name}', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: SurfaceState(type: state.key)),
        ),
      );

      expect(find.text(state.value), findsOneWidget);
    });
  }
}
