import 'package:flutter/foundation.dart';

class ShareableMemoryPreview {
  const ShareableMemoryPreview({
    required this.id,
    required this.content,
    this.sensitivity = 'normal',
  });

  final String id;
  final String content;
  final String sensitivity;
}

class CharacterIntroductionOffer {
  const CharacterIntroductionOffer({
    required this.offerKey,
    required this.targetCharacterKey,
    required this.targetName,
    required this.reason,
    required this.memories,
  });

  final String offerKey;
  final String targetCharacterKey;
  final String targetName;
  final String reason;
  final List<ShareableMemoryPreview> memories;
}

class SharedMemoryPermission {
  const SharedMemoryPermission({
    required this.id,
    required this.content,
    required this.sourceCharacterName,
    required this.targetCharacterKey,
    required this.targetName,
  });

  final String id;
  final String content;
  final String sourceCharacterName;
  final String targetCharacterKey;
  final String targetName;
}

class FakeCharacterNetworkState extends ChangeNotifier {
  FakeCharacterNetworkState()
    : _offer = const CharacterIntroductionOffer(
        offerKey: 'intro-mateo-demo',
        targetCharacterKey: 'mateo',
        targetName: 'Mateo Ruiz',
        reason: '你们刚好有一个共同感兴趣的话题，介绍会很自然。',
        memories: <ShareableMemoryPreview>[
          ShareableMemoryPreview(id: 'memory-photography', content: '喜欢摄影'),
        ],
      );

  CharacterIntroductionOffer? _offer;
  final List<SharedMemoryPermission> _permissions = <SharedMemoryPermission>[];
  String? _notice;

  CharacterIntroductionOffer? get offer => _offer;
  List<SharedMemoryPermission> get permissions =>
      List.unmodifiable(_permissions);
  String? get notice => _notice;

  void respondToIntroduction({
    required bool accept,
    required Set<String> memoryIds,
  }) {
    final currentOffer = _offer;
    if (currentOffer == null) return;
    if (accept) {
      for (final memory in currentOffer.memories) {
        if (memoryIds.contains(memory.id)) {
          _permissions.add(
            SharedMemoryPermission(
              id: memory.id,
              content: memory.content,
              sourceCharacterName: 'Lucía',
              targetCharacterKey: currentOffer.targetCharacterKey,
              targetName: currentOffer.targetName,
            ),
          );
        }
      }
      _notice = '已同意介绍；只有你明确选择的资料会共享。';
    } else {
      _notice = '已暂不接受这次介绍。';
    }
    _offer = null;
    notifyListeners();
  }

  void revokePermission(SharedMemoryPermission permission) {
    _permissions.removeWhere(
      (item) =>
          item.id == permission.id &&
          item.targetCharacterKey == permission.targetCharacterKey,
    );
    _notice = '已撤销这条资料对 ${permission.targetName} 的共享。';
    notifyListeners();
  }
}
