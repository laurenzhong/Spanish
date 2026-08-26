import 'package:flutter/material.dart';

class ReadPage extends StatelessWidget {
  const ReadPage({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return LayoutBuilder(
      builder: (context, constraints) {
        final horizontal = constraints.maxWidth >= 760 ? 48.0 : 18.0;
        return SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(horizontal, 34, horizontal, 40),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 900),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    '安静输入',
                    style: TextStyle(
                      color: colors.primary,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.2,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '读一篇真实的西语文章',
                    style: Theme.of(context)
                        .textTheme
                        .headlineMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    '在不方便开口时，先让语言进入耳朵和眼睛。读过的内容不会直接变成口语能力证据。',
                    style: TextStyle(
                      color: colors.onSurfaceVariant,
                      height: 1.6,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: colors.surface,
                      border: Border.all(color: colors.outlineVariant),
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Icon(Icons.menu_book_outlined, color: colors.primary),
                        const SizedBox(height: 14),
                        Text(
                          '可公开阅读的文章正在准备中',
                          style: Theme.of(context)
                              .textTheme
                              .titleMedium
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '每篇文章都会经过来源、版权和语言审核；准备好后会出现在这里。',
                          style: TextStyle(
                            color: colors.onSurfaceVariant,
                            height: 1.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
