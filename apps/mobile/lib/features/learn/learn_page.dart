import 'package:flutter/material.dart';
import 'package:spanish_mobile/features/training/fakes/fake_training_loop.dart';
import 'package:spanish_mobile/shared/widgets/surface_card.dart';

class LearnPage extends StatefulWidget {
  const LearnPage({super.key});

  @override
  State<LearnPage> createState() => _LearnPageState();
}

class _LearnPageState extends State<LearnPage> {
  var _showTraining = false;

  @override
  Widget build(BuildContext context) {
    if (_showTraining) return const FakeTrainingLoop();

    return LayoutBuilder(
      builder: (context, constraints) {
        final isWide = constraints.maxWidth >= 760;
        final focus = _LearningFocusCard(
          onContinue: () => setState(() => _showTraining = true),
        );
        final evidence = const _EvidenceCard();

        return SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(
            isWide ? 48 : 18,
            28,
            isWide ? 48 : 18,
            40,
          ),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 1100),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const _TodayHeader(),
                  const SizedBox(height: 22),
                  if (isWide)
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Expanded(flex: 7, child: focus),
                        const SizedBox(width: 22),
                        Expanded(
                          flex: 4,
                          child: Column(
                            children: <Widget>[
                              evidence,
                              const SizedBox(height: 16),
                              const _GentleNote(),
                            ],
                          ),
                        ),
                      ],
                    )
                  else ...<Widget>[
                    focus,
                    const SizedBox(height: 16),
                    evidence,
                    const SizedBox(height: 16),
                    const _GentleNote(),
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

class _TodayHeader extends StatelessWidget {
  const _TodayHeader();

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: <Widget>[
        const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              '今天',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
            ),
            SizedBox(height: 4),
            Text(
              'Hola，准备好继续了吗？',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
          ],
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          decoration: BoxDecoration(
            color: colorScheme.surface,
            border: Border.all(color: colorScheme.outlineVariant),
            borderRadius: BorderRadius.circular(99),
          ),
          child: const Text(
            '个人 Alpha',
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
          ),
        ),
      ],
    );
  }
}

class _LearningFocusCard extends StatelessWidget {
  const _LearningFocusCard({required this.onContinue});

  final VoidCallback onContinue;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return SurfaceCard(
      color: const Color(0xFFF8FBFF),
      padding: const EdgeInsets.all(28),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 320),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Text(
              '接下来最值得练习',
              style: textTheme.labelMedium?.copyWith(
                color: colorScheme.primary,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              '问候后自然继续交流',
              style: textTheme.headlineLarge?.copyWith(
                fontWeight: FontWeight.w800,
                height: 1.08,
                letterSpacing: -1.5,
              ),
            ),
            const SizedBox(height: 18),
            Text(
              '你已经会基本问候，下一步练习如何接着分享共同点，让对话自然延续。',
              style: textTheme.bodyMedium?.copyWith(
                color: colorScheme.onSurfaceVariant,
                height: 1.65,
              ),
            ),
            const SizedBox(height: 28),
            SizedBox(
              width: double.infinity,
              height: 54,
              child: FilledButton.icon(
                onPressed: onContinue,
                iconAlignment: IconAlignment.end,
                icon: const Icon(Icons.arrow_forward_rounded),
                label: const Text('继续学习'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EvidenceCard extends StatelessWidget {
  const _EvidenceCard();

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          DecoratedBox(
            decoration: BoxDecoration(
              color: const Color(0xFFEAF7F0),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const SizedBox.square(
              dimension: 44,
              child: Icon(Icons.check_rounded, color: Color(0xFF20875B)),
            ),
          ),
          const SizedBox(height: 18),
          Text(
            '本周获得的能力',
            style: textTheme.labelSmall?.copyWith(
              color: colorScheme.primary,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 7),
          Text(
            '可以独立完成简单自我介绍',
            style: textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          Text(
            '平均开口反应时间从 5.4 秒降到 3.8 秒。',
            style: textTheme.bodySmall?.copyWith(
              color: colorScheme.onSurfaceVariant,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}

class _GentleNote extends StatelessWidget {
  const _GentleNote();

  @override
  Widget build(BuildContext context) {
    return SurfaceCard(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: <Widget>[
          Icon(
            Icons.autorenew_rounded,
            color: Theme.of(context).colorScheme.primary,
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Text(
              '每完成一句都会保存进度，随时停下也不会失去本次练习。',
              style: TextStyle(fontSize: 12, height: 1.45),
            ),
          ),
        ],
      ),
    );
  }
}
