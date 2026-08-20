import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:spanish_mobile/shared/widgets/page_intro.dart';
import 'package:spanish_mobile/shared/widgets/surface_card.dart';

class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key});

  static const _axes = <String>['听懂', '反应', '清晰', '语流', '准确', '语用', '迁移', '互动'];

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isWide = constraints.maxWidth >= 760;
        final skillCard = const _SkillMapCard(axes: _axes);
        final proofCard = const _AbilityProofCard();

        return SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(
            isWide ? 48 : 18,
            34,
            isWide ? 48 : 18,
            40,
          ),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 1000),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const PageIntro(
                    eyebrow: '真实能力',
                    title: '我的进步',
                    description: '画像会区分掌握程度与证据可信度，不用学习时长制造虚假进步。',
                  ),
                  const SizedBox(height: 24),
                  if (isWide)
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Expanded(flex: 3, child: skillCard),
                        const SizedBox(width: 16),
                        Expanded(flex: 2, child: proofCard),
                      ],
                    )
                  else ...<Widget>[
                    skillCard,
                    const SizedBox(height: 16),
                    proofCard,
                  ],
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _SkillMapCard extends StatelessWidget {
  const _SkillMapCard({required this.axes});

  final List<String> axes;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      '八维能力',
                      style: TextStyle(
                        color: colorScheme.primary,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 7),
                    Text(
                      '正在建立你的基线',
                      style: Theme.of(context).textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                  ],
                ),
              ),
              Chip(
                label: const Text('数据不足'),
                labelStyle: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
                side: BorderSide(color: colorScheme.outlineVariant),
                backgroundColor: colorScheme.surfaceContainerLowest,
                visualDensity: VisualDensity.compact,
              ),
            ],
          ),
          const SizedBox(height: 24),
          Center(
            child: Semantics(
              label: '八维能力数据尚不足',
              child: SizedBox.square(
                dimension: 250,
                child: Stack(
                  alignment: Alignment.center,
                  children: <Widget>[
                    CustomPaint(
                      size: const Size.square(230),
                      painter: _OctagonGridPainter(colorScheme.outlineVariant),
                    ),
                    Container(
                      width: 108,
                      height: 108,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: colorScheme.primaryContainer,
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        '完成诊断后显示',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: colorScheme.primary,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: axes
                .map(
                  (axis) => Chip(
                    label: Text(axis),
                    labelStyle: const TextStyle(fontSize: 10),
                    visualDensity: VisualDensity.compact,
                    side: BorderSide.none,
                  ),
                )
                .toList(),
          ),
        ],
      ),
    );
  }
}

class _AbilityProofCard extends StatelessWidget {
  const _AbilityProofCard();

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            '最近证据',
            style: TextStyle(
              color: colorScheme.primary,
              fontSize: 11,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '可以独立完成简单自我介绍',
            style: Theme.of(context).textTheme.titleMedium
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          Text(
            '已通过自由表达验证；发音与语流仍会随着新口语样本继续更新。',
            style: TextStyle(color: colorScheme.onSurfaceVariant, height: 1.55),
          ),
        ],
      ),
    );
  }
}

class _OctagonGridPainter extends CustomPainter {
  const _OctagonGridPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;

    for (final scale in <double>[0.36, 0.64, 0.92]) {
      canvas.drawPath(_octagon(center, size.shortestSide * scale / 2), paint);
    }

    final radius = size.shortestSide * 0.46;
    for (var index = 0; index < 8; index++) {
      final angle = -math.pi / 2 + index * math.pi / 4;
      canvas.drawLine(
        center,
        Offset(
          center.dx + math.cos(angle) * radius,
          center.dy + math.sin(angle) * radius,
        ),
        paint,
      );
    }
  }

  Path _octagon(Offset center, double radius) {
    final path = Path();
    for (var index = 0; index < 8; index++) {
      final angle = -math.pi / 2 + index * math.pi / 4;
      final point = Offset(
        center.dx + math.cos(angle) * radius,
        center.dy + math.sin(angle) * radius,
      );
      if (index == 0) {
        path.moveTo(point.dx, point.dy);
      } else {
        path.lineTo(point.dx, point.dy);
      }
    }
    return path..close();
  }

  @override
  bool shouldRepaint(covariant _OctagonGridPainter oldDelegate) =>
      oldDelegate.color != color;
}
