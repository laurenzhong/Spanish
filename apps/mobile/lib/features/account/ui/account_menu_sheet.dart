import 'package:flutter/material.dart';

class AccountMenuSheet extends StatelessWidget {
  const AccountMenuSheet({this.displayName, this.publicUid, this.targetLanguage = '西班牙语', super.key});

  final String? displayName;
  final String? publicUid;
  final String targetLanguage;

  static Future<void> show(BuildContext context, {String? displayName, String? publicUid, String targetLanguage = '西班牙语'}) {
    return showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      builder: (_) => AccountMenuSheet(displayName: displayName, publicUid: publicUid, targetLanguage: targetLanguage),
    );
  }

  @override
  Widget build(BuildContext context) {
    final name = displayName?.trim().isNotEmpty == true ? displayName!.trim() : '我的 Sueño';
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: <Widget>[
        Row(children: <Widget>[
          CircleAvatar(radius: 25, backgroundColor: Theme.of(context).colorScheme.primary, child: Text(String.fromCharCode(name.runes.first), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800))),
          const SizedBox(width: 13),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[Text(name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)), const SizedBox(height: 3), Text('$targetLanguage学习者', style: Theme.of(context).textTheme.bodySmall)])),
        ]),
        const SizedBox(height: 16),
        Container(padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(10)), child: Row(children: <Widget>[const Expanded(child: Text('公开 UID', style: TextStyle(fontWeight: FontWeight.w700))), Text(publicUid ?? '暂不可用', style: Theme.of(context).textTheme.bodySmall)])),
        const SizedBox(height: 10),
        _item(context, Icons.edit_outlined, '编辑个人资料', () => Navigator.pop(context)),
        _item(context, Icons.insights_outlined, '我的进步与隐私', () => Navigator.pop(context)),
        _item(context, Icons.tune_rounded, '偏好设置', () => Navigator.pop(context)),
        _item(context, Icons.help_outline_rounded, '帮助与反馈', () => Navigator.pop(context)),
        const Divider(height: 20),
        _item(context, Icons.logout_rounded, '退出登录', () => Navigator.pop(context), destructive: true),
      ]),
    );
  }

  Widget _item(BuildContext context, IconData icon, String label, VoidCallback onPressed, {bool destructive = false}) {
    return ListTile(contentPadding: EdgeInsets.zero, leading: Icon(icon), title: Text(label), trailing: const Icon(Icons.arrow_outward_rounded, size: 17), iconColor: destructive ? Theme.of(context).colorScheme.error : null, textColor: destructive ? Theme.of(context).colorScheme.error : null, onTap: onPressed);
  }
}
