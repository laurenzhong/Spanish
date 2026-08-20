import 'package:flutter/material.dart';

enum SurfaceStateType { loading, empty, error, offline }

class SurfaceState extends StatelessWidget {
  const SurfaceState({
    required this.type,
    this.description,
    this.onRetry,
    super.key,
  });

  final SurfaceStateType type;
  final String? description;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final content = _contentFor(type);
    final colorScheme = Theme.of(context).colorScheme;

    return Semantics(
      liveRegion: type == SurfaceStateType.loading,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 34),
        decoration: BoxDecoration(
          color: colorScheme.surface,
          border: Border.all(color: colorScheme.outlineVariant),
          borderRadius: BorderRadius.circular(24),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            DecoratedBox(
              decoration: BoxDecoration(
                color: colorScheme.primaryContainer,
                borderRadius: BorderRadius.circular(14),
              ),
              child: SizedBox.square(
                dimension: 44,
                child: Icon(content.icon, color: colorScheme.primary),
              ),
            ),
            const SizedBox(height: 14),
            Text(
              content.title,
              style: Theme.of(context).textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              description ?? content.description,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium
                  ?.copyWith(color: colorScheme.onSurfaceVariant),
            ),
            if (onRetry != null) ...<Widget>[
              const SizedBox(height: 18),
              OutlinedButton(onPressed: onRetry, child: const Text('重新载入')),
            ],
          ],
        ),
      ),
    );
  }
}

_SurfaceStateContent _contentFor(SurfaceStateType type) {
  return switch (type) {
    SurfaceStateType.loading => const _SurfaceStateContent(
      title: '正在准备内容',
      description: '稍等一下，你的学习位置马上就好。',
      icon: Icons.more_horiz_rounded,
    ),
    SurfaceStateType.empty => const _SurfaceStateContent(
      title: '这里还没有内容',
      description: '完成第一次学习后，这里会出现与你有关的记录。',
      icon: Icons.inbox_outlined,
    ),
    SurfaceStateType.error => const _SurfaceStateContent(
      title: '暂时无法载入',
      description: '本次技术问题不会影响你的能力记录，可以稍后重试。',
      icon: Icons.error_outline_rounded,
    ),
    SurfaceStateType.offline => const _SurfaceStateContent(
      title: '当前处于离线状态',
      description: '已保存内容仍可查看，联网后再继续需要同步的步骤。',
      icon: Icons.cloud_off_outlined,
    ),
  };
}

class _SurfaceStateContent {
  const _SurfaceStateContent({
    required this.title,
    required this.description,
    required this.icon,
  });

  final String title;
  final String description;
  final IconData icon;
}
