# 认证与会话

本文记录 ALPHA-004 的认证实现、安全边界和本地运行方式。当前活动客户端只有响应式 Web/PWA，普通用户主入口为邮箱六位 OTP；已有 Flutter 认证代码保留但暂停同步。

> 2026-09-11 策略更新：个人 Alpha 改为私有、单账号使用。当前邮箱 OTP 可以继续使用，但自由创建新用户必须在独立认证任务中关闭，并增加服务端邮箱 allowlist。完成该任务前，不能把现有登录配置描述为已经限制为单账号。

## 1. 产品入口

- `/` 是公开介绍页。
- `/login` 是普通用户邮箱 OTP 登录页。
- `/login/password` 只用于预建测试账号，不在普通登录页展示入口。
- `/learn`、`/explore`、`/chat` 和 `/me` 需要有效用户会话。
- 未登录访问私人页面会跳到 `/login?next=...`；当前 Alpha 验证成功后统一进入 `/learn`。

邮箱 OTP 默认允许创建用户。Supabase 的新用户触发器会同步创建一条 `profiles` 和一条 `user_preferences`，避免客户端自行补写基础账号数据。

## 2. Web 会话

Web 浏览器通过 `@supabase/ssr` 持有 Cookie 会话：

1. 客户端 Auth Repository 请求和验证 OTP。
2. `proxy.ts` 在受保护页面前刷新 Supabase Cookie，并做快速跳转。Auth 返回 401/无效或过期 JWT 时按匿名会话跳转到 `/login`；只有网络、超时或 5xx 等可重试错误才进入“暂时无法验证登录”的恢复页，避免旧 Cookie 永久卡在故障状态。恢复页另提供仅清除本地会话并重新登录的操作，不依赖 Auth 服务在线。
3. 产品服务端布局再次调用 Supabase `auth.getUser()`，不把 proxy 或客户端状态当作权威身份；如果验证遇到可重试的网络或 5xx 错误，只短暂重试一次，401/无效会话不会重试。
4. Route Handler 对 Bearer Token 调用 `auth.getUser(token)`；不接受客户端声明的 user ID，也不只做本地 JWT 解码。

UI 组件不散落直接调用 Supabase；当前登录行为通过 `WebAuthRepository` 隔离，后续可注入 fake 做组件测试。

## 3. Flutter 会话与 Token Gate

Flutter 使用 `supabase_flutter`，但持久会话通过 `flutter_secure_storage` 交给系统安全存储。当前 OTP 是手工输入六位验证码，因此禁用 URI 自动会话检测。

所有后端请求先经过 `AccessTokenCoordinator`：

- access token 在到期前 60 秒视为需要刷新。
- 多个并发请求共享同一次刷新。
- 刷新期间若登录、退出或身份变化，旧请求收到 `identityChanged`，不能携带新用户令牌继续原用户操作。
- 无会话、身份变化和临时刷新失败使用不同错误类型，便于 UI 给出正确恢复路径。
- 刷新默认 15 秒超时。

`AuthenticatedApiClient` 默认不在 401 后重放请求。调用者必须明确开启一次重试；POST 只有提供幂等键时才能开启，且同一幂等键会保留到重试请求。

## 4. 环境变量

Web 在未提交的 `.env` 中配置：

```text
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Flutter 通过构建参数使用相同公开值：

```powershell
flutter run `
  --dart-define=SUPABASE_URL=https://your-project.supabase.co `
  --dart-define=SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

publishable key 可以存在于客户端；service role key、数据库密码、真实 access/refresh token 不得写入仓库、日志或客户端构建。未配置公开 Auth 参数时，Web 和 Flutter 会显示明确的“尚未配置”状态，不伪造登录成功。

## 5. 本地与自动测试

Web 单元测试通过注入 fake repository/verifier 验证 OTP 和服务端 token 验证。Playwright 启动的非生产测试服务器会临时启用 `AUTH_E2E_ENABLED=1`，并使用 `spanish-e2e-user` Cookie 测试受保护路由和 API；此后门在 production 环境无效，不能在手工部署中启用。

Flutter 测试使用内存 Auth source、secure storage 和 HTTP transport，覆盖并发刷新、切换身份、超时、默认不重试及幂等重试。默认测试不连接真实 Supabase，也不发送邮件。

上线前还需要在目标 Supabase 项目完成：

- 执行版本化迁移并复查 RLS。
- 配置邮件发送方、OTP 模板、有效期和限流。
- 六位验证码入口必须使用包含 `{{ .Token }}` 的邮件模板；不要只发送 `{{ .ConfirmationURL }}`。后者是 magic link，不能复制其中的内容到六位验证码输入框中完成 `verifyOtp`。
- 使用两个真实测试用户复验跨用户隔离。
- 验证退出、令牌撤销和账号删除路径。

当前 Windows 环境可以验证 Dart 公共代码和 Widget 测试，但不能宣称 iOS Keychain、签名、真机登录或 App 生命周期已经验证；这些必须在 Mac/Xcode 和 iPhone 上补做。
