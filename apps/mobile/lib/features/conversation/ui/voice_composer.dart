import 'dart:async';

import 'package:flutter/material.dart';
import 'package:spanish_mobile/core/platform/fake_platform_capabilities.dart';
import 'package:spanish_mobile/core/platform/platform_capabilities.dart';

class ConversationVoiceComposer extends StatefulWidget {
  const ConversationVoiceComposer({required this.onSubmit, this.recorder, this.disabled = false, super.key});

  final ValueChanged<String> onSubmit;
  final AudioRecorder? recorder;
  final bool disabled;

  @override
  State<ConversationVoiceComposer> createState() => _ConversationVoiceComposerState();
}
class _ConversationVoiceComposerState extends State<ConversationVoiceComposer> {
  late final AudioRecorder _recorder;
  final _controller = TextEditingController();
  String? _notice;
  bool _recording = false;

  @override
  void initState() {
    super.initState();
    _recorder = widget.recorder ?? FakeAudioRecorder();
  }

  @override
  void dispose() {
    unawaited(_recorder.cancel());
    _controller.dispose();
    super.dispose();
  }

  Future<void> _toggleRecording() async {
    if (widget.disabled) return;
    if (_recording) {
      try {
        await _recorder.stop();
      } catch (_) {}
      if (mounted) {
        setState(() {
          _recording = false;
          _notice = '暂时没有可验证的语音转写，请改用文字发送。录音不会上传或保存。';
        });
      }
      return;
    }
    try {
      await _recorder.start();
      if (mounted) setState(() { _recording = true; _notice = '正在录音；停止后回到文字输入。'; });
    } catch (_) {
      if (mounted) setState(() { _recording = false; _notice = '当前设备暂不支持录音，请改用文字输入。'; });
    }
  }

  void _submit() {
    final text = _controller.text.trim();
    if (text.isEmpty || widget.disabled || _recording) return;
    widget.onSubmit(text);
    _controller.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (_notice != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_notice!, style: Theme.of(context).textTheme.bodySmall)),
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: <Widget>[
            IconButton(tooltip: _recording ? '停止录音' : '使用语音输入', onPressed: widget.disabled ? null : _toggleRecording, icon: Icon(_recording ? Icons.stop_circle_outlined : Icons.mic_none_rounded)),
            Expanded(
              child: TextField(
                controller: _controller,
                enabled: !widget.disabled && !_recording,
                minLines: 1,
                maxLines: 4,
                onSubmitted: (_) => _submit(),
                decoration: const InputDecoration(hintText: '写下你想说的话…', border: OutlineInputBorder()),
              ),
            ),
            const SizedBox(width: 8),
            IconButton(tooltip: '发送消息', onPressed: widget.disabled ? null : _submit, icon: const Icon(Icons.arrow_upward_rounded)),
          ],
        ),
      ],
    );
  }
}
