import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:spanish_mobile/features/character_network/character_network_panels.dart';
import 'package:spanish_mobile/features/character_network/fake_character_network.dart';
import 'package:spanish_mobile/shared/widgets/page_intro.dart';
import 'package:spanish_mobile/shared/widgets/surface_card.dart';

class ProfilePage extends StatefulWidget {
  const ProfilePage({this.network, super.key});

  final FakeCharacterNetworkState? network;

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  static const _axes = <String>[
    '听辨理解',
    '即时反应',
    '发音清晰',
    '语流节奏',
    '表达准确',
    '交际策略',
    '语块调用',
    '迁移表达',
  ];

  var _selectedAxis = 0;
  var _selectedDay = 0;
  var _showMemory = true;
  var _showAudio = true;
  var _showAccount = true;
  String? _notice;

  List<_LearningDay> get _days {
    final today = DateTime.now();
    return List<_LearningDay>.generate(14, (index) {
      final date = DateTime(
        today.year,
        today.month,
        today.day,
      ).subtract(Duration(days: 13 - index));
      final active = index == 4 || index == 8 || index == 12;
      return _LearningDay(
        date: date,
        minutes: active ? 8 + index : 0,
        scene: active ? (index == 8 ? '咖啡馆初次交流' : '问候后继续对话') : null,
      );
    });
  }

  Future<void> _remove(String kind) async {
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('删除$kind？'),
        content: const Text('这只会移除当前设备上的演示资料，不会修改服务端能力证据。'),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认删除'),
          ),
        ],
      ),
    );
    if (!mounted || accepted != true) return;
    setState(() {
      if (kind == '关系记忆') _showMemory = false;
      if (kind == '保存的录音') _showAudio = false;
      if (kind == '账号数据') _showAccount = false;
      _notice = '已从当前设备移除$kind演示资料。';
    });
  }

  @override
  Widget build(BuildContext context) {
    final isWide = MediaQuery.sizeOf(context).width >= 760;
    final days = _days;
    final skillCard = _SkillMapCard(
      axes: _axes,
      selectedIndex: _selectedAxis,
      onSelected: (index) => setState(() => _selectedAxis = index),
    );
    final proofCard = _AbilityProofCard(axis: _axes[_selectedAxis]);

    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(isWide ? 48 : 18, 34, isWide ? 48 : 18, 40),
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
              const SizedBox(height: 16),
              _HeatmapCard(
                days: days,
                selectedIndex: _selectedDay,
                onSelected: (index) => setState(() => _selectedDay = index),
              ),
              const SizedBox(height: 16),
              if (widget.network != null) ...<Widget>[
                SharedMemoryPermissionsPanel(network: widget.network!),
                CharacterNetworkNotice(network: widget.network!),
                const SizedBox(height: 16),
              ],
              if (_notice != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(_notice!, key: const ValueKey('profile-notice')),
                ),
              _PrivacySection(
                title: '关系记忆',
                detail: '仅当前角色可见 · “我喜欢在周末逛市场”',
                actionLabel: '删除记忆',
                visible: _showMemory,
                onDelete: () => _remove('关系记忆'),
              ),
              _PrivacySection(
                title: '已保存的录音',
                detail: '1 条里程碑录音 · audio/fake · 3 秒',
                actionLabel: '删除录音',
                visible: _showAudio,
                onDelete: () => _remove('保存的录音'),
              ),
              _PrivacySection(
                title: '账号数据',
                detail: '训练、对话和关系资料的删除入口',
                actionLabel: '删除账号数据',
                visible: _showAccount,
                onDelete: () => _remove('账号数据'),
              ),
              if (!_showMemory && !_showAudio && !_showAccount)
                const SurfaceCard(child: Text('当前设备没有可管理的演示资料。')),
            ],
          ),
        ),
      ),
    );
  }
}

class _SkillMapCard extends StatelessWidget {
  const _SkillMapCard({
    required this.axes,
    required this.selectedIndex,
    required this.onSelected,
  });

  final List<String> axes;
  final int selectedIndex;
  final ValueChanged<int> onSelected;

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
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('八维能力', style: TextStyle(fontWeight: FontWeight.w800)),
                    SizedBox(height: 7),
                    Text('正在建立你的基线'),
                  ],
                ),
              ),
              Chip(
                label: const Text('数据不足'),
                side: BorderSide(color: colorScheme.outlineVariant),
                visualDensity: VisualDensity.compact,
              ),
            ],
          ),
          const SizedBox(height: 18),
          Center(
            child: Semantics(
              label: '八维能力数据尚不足',
              child: SizedBox.square(
                dimension: 210,
                child: Stack(
                  alignment: Alignment.center,
                  children: <Widget>[
                    CustomPaint(
                      size: const Size.square(200),
                      painter: _OctagonGridPainter(colorScheme.outlineVariant),
                    ),
                    Text(
                      '${axes[selectedIndex]}\n待验证',
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Wrap(
            spacing: 4,
            runSpacing: 4,
            children: axes.asMap().entries.map((entry) {
              return ChoiceChip(
                label: Text(entry.value),
                selected: entry.key == selectedIndex,
                onSelected: (_) => onSelected(entry.key),
              );
            }).toList(),
          ),
          const SizedBox(height: 8),
          Text(
            '点击维度查看当前状态；证据不足时不绘制虚假掌握度。',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

class _AbilityProofCard extends StatelessWidget {
  const _AbilityProofCard({required this.axis});

  final String axis;

  @override
  Widget build(BuildContext context) {
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            '最近证据',
            style: TextStyle(
              color: Theme.of(context).colorScheme.primary,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            '可以独立完成简单自我介绍',
            style: TextStyle(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          Text('当前选择：$axis\n发音与语流仍会随着新口语样本继续更新。'),
        ],
      ),
    );
  }
}

class _LearningDay {
  const _LearningDay({required this.date, required this.minutes, this.scene});

  final DateTime date;
  final int minutes;
  final String? scene;
}

class _HeatmapCard extends StatelessWidget {
  const _HeatmapCard({
    required this.days,
    required this.selectedIndex,
    required this.onSelected,
  });

  final List<_LearningDay> days;
  final int selectedIndex;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    final selected = days[selectedIndex];
    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('有效学习', style: TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          const Text('学习时长只用于活动记录，不参与能力评分。'),
          const SizedBox(height: 14),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: days.asMap().entries.map((entry) {
              final day = entry.value;
              final label =
                  '${day.date.month}月${day.date.day}日，${day.minutes > 0 ? '${day.minutes}分钟有效学习' : '没有有效学习'}';
              final scheme = Theme.of(context).colorScheme;
              return Semantics(
                button: true,
                label: label,
                child: IconButton(
                  tooltip: label,
                  onPressed: () => onSelected(entry.key),
                  isSelected: entry.key == selectedIndex,
                  style: IconButton.styleFrom(
                    backgroundColor: day.minutes == 0
                        ? Colors.transparent
                        : scheme.primaryContainer,
                    side: BorderSide(
                      color: entry.key == selectedIndex
                          ? scheme.primary
                          : scheme.outlineVariant,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(6),
                    ),
                  ),
                  icon: Text(
                    day.minutes == 0 ? '·' : '${day.minutes}',
                    style: const TextStyle(fontSize: 11),
                  ),
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 14),
          Text(
            '${selected.date.month}月${selected.date.day}日 · '
            '${selected.minutes > 0 ? '${selected.minutes} 分钟有效学习' : '暂无场景记录'}'
            '${selected.scene == null ? '' : ' · ${selected.scene}'}',
            key: const ValueKey('heatmap-day-detail'),
          ),
        ],
      ),
    );
  }
}

class _PrivacySection extends StatelessWidget {
  const _PrivacySection({
    required this.title,
    required this.detail,
    required this.actionLabel,
    required this.visible,
    required this.onDelete,
  });

  final String title;
  final String detail;
  final String actionLabel;
  final bool visible;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    if (!visible) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: SurfaceCard(
        child: Row(
          children: <Widget>[
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    title,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 5),
                  Text(detail, style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            ),
            TextButton(onPressed: onDelete, child: Text(actionLabel)),
          ],
        ),
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
