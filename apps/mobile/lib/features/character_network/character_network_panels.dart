import 'package:flutter/material.dart';

import '../../shared/widgets/surface_card.dart';
import 'fake_character_network.dart';

class CharacterIntroductionPanel extends StatefulWidget {
  const CharacterIntroductionPanel({required this.network, super.key});

  final FakeCharacterNetworkState network;

  @override
  State<CharacterIntroductionPanel> createState() =>
      _CharacterIntroductionPanelState();
}

class _CharacterIntroductionPanelState
    extends State<CharacterIntroductionPanel> {
  final Set<String> _selectedMemoryIds = <String>{};

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.network,
      builder: (context, _) {
        final offer = widget.network.offer;
        if (offer == null) return const SizedBox.shrink();
        return SurfaceCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const Text(
                '认识一个新朋友',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 6),
              Text(
                offer.targetName,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 6),
              Text(offer.reason),
              const SizedBox(height: 6),
              const Text('当前为客户端演示状态，不会直接修改服务端关系授权。'),
              const SizedBox(height: 14),
              const Text('可以分享给对方的资料（可选）'),
              const SizedBox(height: 4),
              const Text('不勾选就不会共享。私密记忆不会出现在这里。'),
              ...offer.memories.map(
                (memory) => Material(
                  color: Colors.transparent,
                  child: CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    value: _selectedMemoryIds.contains(memory.id),
                    title: Text(memory.content),
                    subtitle: memory.sensitivity == 'sensitive'
                        ? const Text('敏感资料')
                        : null,
                    onChanged: (checked) => setState(() {
                      if (checked == true) {
                        _selectedMemoryIds.add(memory.id);
                      } else {
                        _selectedMemoryIds.remove(memory.id);
                      }
                    }),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: <Widget>[
                  FilledButton(
                    onPressed: () => widget.network.respondToIntroduction(
                      accept: true,
                      memoryIds: _selectedMemoryIds,
                    ),
                    child: const Text('同意介绍'),
                  ),
                  TextButton(
                    onPressed: () => widget.network.respondToIntroduction(
                      accept: false,
                      memoryIds: const <String>{},
                    ),
                    child: const Text('先不认识'),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }
}

class SharedMemoryPermissionsPanel extends StatelessWidget {
  const SharedMemoryPermissionsPanel({required this.network, super.key});

  final FakeCharacterNetworkState network;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: network,
      builder: (context, _) {
        final permissions = network.permissions;
        if (permissions.isEmpty) return const SizedBox.shrink();
        return SurfaceCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const Text(
                '已授权给角色的资料',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 6),
              const Text('这里的授权只对指定角色生效；撤销后，原始记忆仍保留。'),
              const SizedBox(height: 4),
              const Text('当前为客户端演示状态，不代表服务端删除或撤销结果。'),
              const SizedBox(height: 12),
              ...permissions.map(
                (permission) => Material(
                  color: Colors.transparent,
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(permission.content),
                    subtitle: Text(
                      '来源于 ${permission.sourceCharacterName} · 已分享给 ${permission.targetName}',
                    ),
                    trailing: TextButton(
                      onPressed: () => network.revokePermission(permission),
                      child: const Text('撤销授权'),
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class CharacterNetworkNotice extends StatelessWidget {
  const CharacterNetworkNotice({required this.network, super.key});

  final FakeCharacterNetworkState network;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: network,
      builder: (context, _) {
        final notice = network.notice;
        if (notice == null) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Text(notice, key: const ValueKey('character-network-notice')),
        );
      },
    );
  }
}
