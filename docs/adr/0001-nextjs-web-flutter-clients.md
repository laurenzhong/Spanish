# ADR-0001：Next.js Web 与 Flutter 多平台客户端

- 日期：2026-08-20
- 状态：Accepted

## 背景

项目最初计划以 Next.js PWA 完成个人 Alpha，并在学习闭环验证后开发原生 iOS。随后确认长期需要 Web、iOS、Android、Windows、macOS，并希望 iOS 不以 WebView 为主要运行方式，避免未来整体重写 Swift。

参考 Echo-Loop 后确认：Flutter 可以让主要产品代码保持在 Dart，仅在音频、通知和商店等平台能力上使用少量 Swift/Kotlin。Echo-Loop 的宣传网站与 Flutter 客户端也是分离的技术表面。当前决策只采用通用架构原则；如未来复用源码，必须先记录用户所述作者授权的具体范围，并处理其他贡献者代码和 AGPL-3.0 义务。

## 决定

1. Next.js、React、TypeScript 继续承担完整 Web 学习产品、PWA 和远程模块化单体。
2. Flutter、Dart 从个人 Alpha 开始同步承担 iOS 客户端，并作为 Android、Windows、macOS 的共同客户端代码线。
3. 不采用 Capacitor 作为 iOS 主架构，也不要求以 SwiftUI/UIKit 重写主要页面。
4. Web 与 Flutter 不共享 UI 源代码；共享版本化 API 契约、内容源、错误码、算法版本和 JSON 一致性样本。
5. Supabase PostgreSQL 是学习证据、画像和关系记忆的权威来源；客户端不能直接写这些事实。
6. Flutter 无法覆盖的 iOS 能力通过小型、单一职责的 Swift Platform Channel 实现。
7. 当前无 Mac，因此 iOS 编译、签名和真机验收在获得 Mac/Xcode 或可用云端构建条件前不能标记完成。

## 替代方案

- PWA + Capacitor：UI 复用最高，但与非 WebView 客户端和长期语音能力目标不一致。
- SwiftUI + Next.js：原生程度最高，但不利于未来 Android、Windows、macOS，共有成本过高。
- Flutter Web + Flutter 客户端：复用最高，但当前不替换完整 Next.js Web 产品；后续可单独评估。

## 后果

- 保留现有 Next.js 投资，新增 Flutter/Dart 工具链和客户端测试。
- Flutter 四平台之间共享主要客户端代码，但 Web 与 Flutter 页面需要分别实现。
- 跨语言业务语义依赖版本化契约和共同测试样本，不能依靠人工同步。
- iOS/macOS 发布长期需要 Mac、Xcode 和 Apple Developer 账号。
- 服务端接口从仅面向同源 Web 的内部接口升级为受版本控制的多客户端 API。
