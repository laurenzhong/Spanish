import 'package:flutter/material.dart';

import '../../core/auth/auth_repository.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({required this.repository, super.key});

  final AuthRepository? repository;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _emailController = TextEditingController();
  final _tokenController = TextEditingController();
  bool _otpSent = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _emailController.dispose();
    _tokenController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final repository = widget.repository;
    if (repository == null || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_otpSent) {
        await repository.verifyEmailOtp(
          email: _emailController.text.trim(),
          token: _tokenController.text.trim(),
        );
      } else {
        await repository.requestEmailOtp(_emailController.text.trim());
        if (mounted) setState(() => _otpSent = true);
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = _otpSent ? '验证码无效或已经过期。' : '验证码发送失败，请稍后重试。';
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final repository = widget.repository;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(28),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'Spanish · 个人 Alpha',
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: Theme.of(context).colorScheme.primary,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        '用邮箱接收验证码',
                        style: Theme.of(context).textTheme.headlineMedium
                            ?.copyWith(fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        repository == null
                            ? '当前构建尚未配置 Supabase Auth。'
                            : '无需设置密码，验证后直接继续学习。',
                      ),
                      const SizedBox(height: 24),
                      TextField(
                        controller: _emailController,
                        enabled: !_busy && !_otpSent && repository != null,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.email],
                        decoration: const InputDecoration(
                          border: OutlineInputBorder(),
                          labelText: '邮箱',
                        ),
                      ),
                      if (_otpSent) ...[
                        const SizedBox(height: 16),
                        TextField(
                          controller: _tokenController,
                          autofocus: true,
                          enabled: !_busy,
                          keyboardType: TextInputType.number,
                          autofillHints: const [AutofillHints.oneTimeCode],
                          maxLength: 6,
                          decoration: const InputDecoration(
                            border: OutlineInputBorder(),
                            labelText: '六位验证码',
                          ),
                        ),
                      ],
                      const SizedBox(height: 18),
                      FilledButton(
                        onPressed: repository == null || _busy ? null : _submit,
                        child: Text(
                          _busy
                              ? '请稍候…'
                              : _otpSent
                              ? '进入学习'
                              : '获取验证码',
                        ),
                      ),
                      if (_otpSent)
                        TextButton(
                          onPressed: _busy
                              ? null
                              : () => setState(() {
                                  _otpSent = false;
                                  _tokenController.clear();
                                  _error = null;
                                }),
                          child: const Text('更换邮箱'),
                        ),
                      if (_error != null) ...[
                        const SizedBox(height: 8),
                        Text(
                          _error!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
