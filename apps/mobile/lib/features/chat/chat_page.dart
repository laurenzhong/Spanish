import 'package:flutter/material.dart';
import 'package:spanish_mobile/features/conversation/ui/chat_thread.dart';
import 'package:spanish_mobile/shared/widgets/page_intro.dart';

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
              const ConversationChatThread(),
            ],
          ),
        ),
      ),
    );
  }
}
