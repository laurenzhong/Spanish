import 'package:flutter/material.dart';

class AccountProfilePage extends StatefulWidget {
  const AccountProfilePage({this.displayName, this.publicUid, super.key});

  final String? displayName;
  final String? publicUid;

  @override
  State<AccountProfilePage> createState() => _AccountProfilePageState();
}

class _AccountProfilePageState extends State<AccountProfilePage> {
  late final TextEditingController _nameController = TextEditingController(text: widget.displayName ?? '');
  String _avatarKind = 'initials';
  String? _preset;

  @override
  void dispose() { _nameController.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    const presets = <String>['日光窗边', '赤陶围巾', '绿皮笔记', '纸张拼贴', '夜间工作室', '安静咖啡馆'];
    return Scaffold(appBar: AppBar(title: const Text('账户资料')), body: ListView(padding: const EdgeInsets.all(20), children: <Widget>[
      Text('让别人认出你', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800)),
      const SizedBox(height: 8),
      Text('头像和显示名只用于账户身份。UID 不会因改名或换头像而改变。', style: Theme.of(context).textTheme.bodyMedium),
      const SizedBox(height: 24),
      TextField(controller: _nameController, maxLength: 80, decoration: const InputDecoration(labelText: '显示名', border: OutlineInputBorder())),
      const SizedBox(height: 20),
      const Text('选择头像', style: TextStyle(fontWeight: FontWeight.w800)),
      const SizedBox(height: 12),
      Wrap(spacing: 10, runSpacing: 10, children: <Widget>[
        _avatarChoice(context, '首字母', null),
        ...presets.map((label) => _avatarChoice(context, label, label)),
      ]),
      const SizedBox(height: 24),
      FilledButton(onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('资料保存将在账户 API 可用时完成。'))), child: const Text('保存资料')),
    ]));
  }

  Widget _avatarChoice(BuildContext context, String label, String? preset) {
    final selected = preset == null ? _avatarKind == 'initials' : _avatarKind == 'preset' && _preset == preset;
    return InkWell(onTap: () => setState(() { _avatarKind = preset == null ? 'initials' : 'preset'; _preset = preset; }), borderRadius: BorderRadius.circular(12), child: Container(width: 92, padding: const EdgeInsets.all(10), decoration: BoxDecoration(border: Border.all(color: selected ? Theme.of(context).colorScheme.primary : Theme.of(context).colorScheme.outlineVariant, width: selected ? 2 : 1), borderRadius: BorderRadius.circular(12)), child: Column(children: <Widget>[CircleAvatar(backgroundColor: Theme.of(context).colorScheme.primaryContainer, child: Text(String.fromCharCode(label.runes.first))), const SizedBox(height: 7), Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 11))])));
  }
}
