import 'package:flutter/material.dart';
import 'package:spanish_mobile/shared/widgets/page_intro.dart';
import 'package:spanish_mobile/shared/widgets/surface_card.dart';
import 'package:spanish_mobile/shared/widgets/surface_state.dart';

class ChatPage extends StatelessWidget {
  const ChatPage({super.key});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(18, 34, 18, 40),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 900),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const PageIntro(
                eyebrow: '长期陪伴',
                title: '你的西语好友',
                description: '聊天首先是自然交流，学习目标只在后台创造合适的话题机会。',
              ),
              const SizedBox(height: 24),
              SurfaceCard(
                child: Row(
                  children: <Widget>[
                    const CircleAvatar(
                      radius: 32,
                      backgroundColor: Color(0xFFFFD4B9),
                      foregroundColor: Color(0xFF67442F),
                      child: Text(
                        'L',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Row(
                            children: <Widget>[
                              Expanded(
                                child: Text(
                                  'Lucía Martín',
                                  style: Theme.of(context).textTheme.titleMedium
                                      ?.copyWith(fontWeight: FontWeight.w800),
                                ),
                              ),
                              const Text('马德里', style: TextStyle(fontSize: 11)),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(
                            '今天想聊聊你到西班牙后最期待的事。',
                            style: TextStyle(
                              color: Theme.of(context)
                                  .colorScheme
                                  .onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            '主要好友 · 原型预览',
                            style: TextStyle(
                              fontSize: 11,
                              color: Color(0xFF7A8495),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              const SurfaceState(
                type: SurfaceStateType.empty,
                description: 'Lucía 了解你的兴趣后，会以介绍朋友的方式自然扩展联系人。',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
