# Web 与 Flutter 多平台客户端架构设计

- 日期：2026-08-20
- 状态：历史设计；个人 Alpha 同步实施决定已由 ADR-0002 取代
- 决策范围：个人 Alpha 与后续客户端平台路线
- 关联 ADR：[ADR-0001](../../adr/0001-nextjs-web-flutter-clients.md)

> 2026-09-11 更新：本文件保留长期多平台方案与历史背景，但不再是当前个人 Alpha 的客户端实施基线。当前只推进响应式 Web/PWA 与 iPhone Safari，详见 [Web 优先的个人学习产品与场景实战设计](2026-09-11-web-first-personal-learning-and-scenario-practice-design.md) 和 [ADR-0002](../../adr/0002-web-pwa-first-personal-alpha.md)。除非新的 ADR 恢复该路线，Flutter 页面、跨语言一致性和原生商店工作均暂停。

## 1. 决策摘要

项目采用两条客户端代码线和一个远程服务端：

- Next.js、React、TypeScript 继续承担完整 Web 学习产品、公开页面和 PWA 能力。
- Flutter、Dart 承担 iOS 客户端，并作为未来 Android、Windows、macOS 客户端的共同代码基础。
- Next.js Route Handlers 与服务端领域模块继续组成远程模块化单体，向 Web 和 Flutter 暴露版本化 API。
- Supabase PostgreSQL 是学习证据、画像、关系记忆和跨设备状态的权威来源。
- 两端不共享 UI 源代码；共享内容源、API 契约、领域语义、算法版本和跨语言一致性样本。
- iOS 不使用 Capacitor WebView。Flutter 无法覆盖的设备能力通过少量 Swift 桥接实现。

这一选择保留已经完成的 Next.js/PWA 基础，同时避免未来把一个 WebView 客户端整体重写为 Swift。Flutter 客户端从 Alpha 开始同步建设，而不是在 Web 产品完成后才启动。

## 2. 平台范围与顺序

### 2.1 正式产品表面

项目长期包含五个用户可见表面：

1. Web：完整浏览器学习产品与公开网站。
2. iOS：Alpha 同步开发的首个 Flutter 客户端。
3. Android：复用 Flutter 客户端代码的后续发布平台。
4. Windows：复用 Flutter 客户端代码的后续桌面平台。
5. macOS：复用 Flutter 客户端代码的后续桌面平台。

“四个平台”指 iOS、Android、Windows、macOS；Web 是独立的正式产品表面，不计入这四个 Flutter 客户端平台。

### 2.2 Alpha 边界

个人 Alpha 同步覆盖：

- Next.js Web 核心学习闭环。
- Flutter 移动端工程、产品壳层和同一核心学习闭环。
- iOS 工程配置及平台能力接口。
- Web 与 Flutter 对同一 API、内容版本和学习证据语义的一致性验证。

个人 Alpha 暂不要求：

- Android、Windows、macOS 的商店发布和完整平台打磨。
- 实时双向语音通话。
- 后台持续录音或复杂后台音频。
- 完整离线学习与离线 ASR。
- 为追求原生比例而重写 Flutter 页面为 SwiftUI/UIKit。

## 3. 总体运行时

```text
Next.js Web / PWA                   Flutter 客户端
├─ React 页面                      ├─ iOS（Alpha）
├─ 浏览器录音与 TTS                ├─ Android（后续）
└─ Web 平台适配器                  ├─ Windows（后续）
          │                        ├─ macOS（后续）
          │ HTTPS / NDJSON         └─ 平台能力适配器
          └──────────┬───────────────────────┘
                     ▼
              远程 Next.js 模块化单体
              ├─ 版本化 HTTP/流式 API
              ├─ Application 用例
              ├─ 纯 TypeScript 服务端领域规则
              ├─ Repository 与 Provider 接口
              └─ 供应商适配器
                     │
              Supabase 与外部供应商
```

Next.js 服务端运行时不会打包进 Flutter 客户端。所有密钥、评分、角色回复规划、长期记忆写入和供应商调用留在服务端。

## 4. 仓库结构

Alpha 采用单仓库，不拆成多个 Git 仓库：

```text
app/                         # Next.js Web 页面与 Route Handlers
src/                         # Web UI、服务端 application/domain/repository/provider
apps/
  mobile/                    # Flutter 客户端；同一工程面向四个客户端平台
contracts/
  openapi/                   # 版本化 API 规范
  fixtures/                  # TS/Dart 共用协议与状态一致性样本
content/                     # 版本化表达、场景、内容包和人物数据
drizzle/                     # 服务端数据库迁移
tests/                       # Web、服务端、契约和 E2E
docs/
```

暂不为了目录整齐把现有 Next.js 根工程整体搬入 `apps/web`。只有当根目录工具链冲突或独立部署需要变得明确时，再通过单独 ADR 评估迁移。

## 5. 共享与不共享的边界

### 5.1 共享的资产

- 稳定内容 ID、内容版本和审核状态。
- 场景、表达、标签、权值和技能点定义。
- OpenAPI/JSON Schema API 契约。
- 认证令牌、分页、错误码和流式消息协议。
- 评分算法版本、训练状态语义和证据字段定义。
- JSON 一致性样本，例如状态转换、证据更新和错误映射样本。
- 角色人物圣经与本地化内容源。

TypeScript 与 Dart 客户端由同一契约生成或校验数据类型，不手写两份含义相近但逐渐漂移的 DTO。

### 5.2 不强行共享的代码

- React 与 Flutter 页面及组件。
- 浏览器录音与 iOS 音频会话实现。
- Web Storage 与 iOS 安全存储实现。
- Web PWA 生命周期与 iOS App 生命周期。
- 手机、桌面和浏览器特有导航与可访问性交互。

UI 重复是有意接受的成本。为了复用 UI 而把完整学习产品放进 WebView，会削弱语音、离线、后台能力和平台体验。

## 6. 训练逻辑与跨语言一致性

服务端拥有不可绕过的业务规则，包括评分、证据写入、画像更新、记忆权限和角色安全。客户端拥有即时交互状态，例如录音、播放、提示展开和页面恢复。

Web 和 Flutter 都需要训练编排器，因此采用“相同规范、两种实现、共同样本”的方式：

1. 训练状态、事件、effect 和错误码形成版本化协议。
2. TypeScript 与 Dart 分别实现本地编排器。
3. `contracts/fixtures/` 保存语言无关的 JSON 转换样本。
4. 两端测试读取同一批样本并断言相同终态和 effect。
5. 服务端再次验证任何会影响证据和画像的提交，客户端状态不能直接成为能力事实。

这比尝试在 Dart 中运行 TypeScript 或把所有交互改成服务端状态机更清晰，也能保留录音和提示的即时响应。

## 7. 平台能力接口

Web 与 Flutter 分别提供平台适配器，但上层训练和聊天 UI 只依赖内部接口：

- `AudioRecorder`
- `AudioPlayer`
- `TextToSpeech`
- `SecureStorage`
- `Notifications`
- `AppLifecycle`
- `Connectivity`
- `FileCache`

Flutter 默认优先使用成熟插件。只有插件无法可靠满足 iOS 音频会话、通知、文件生命周期或商店能力时，才增加小型 Swift Platform Channel。原生桥接必须保持单一职责，并有 Dart 侧契约测试和真机验收说明。

## 8. 数据与同步

- PostgreSQL 是证据、画像、场景状态、关系记忆和消息的权威来源。
- 客户端可以缓存公开内容、当前会话和未发送草稿，但不能自行确认服务端写入成功。
- 每个写请求带稳定 `attemptId`、`generationId` 或幂等键。
- 断网时允许保留草稿和安全断点；恢复后重试不能重复生成证据、消息或供应商费用。
- Alpha 不承诺完整离线训练。离线 ASR、离线评分和复杂冲突合并继续延后。

## 9. API 与认证

- 对 Flutter 开放的公共端点使用 `/api/v1/` 或等价的显式版本策略。
- 请求和响应通过 Zod 在服务端校验，并从同一契约生成或验证 Dart 类型。
- Flutter 使用 Supabase Auth 的移动端会话，向服务端发送短期访问令牌。
- Route Handler 负责身份解析、输入校验、调用 application 用例和协议转换。
- 移动端不能持有服务端密钥，也不能直接写证据、画像和关系记忆。
- 流式聊天沿用带 `meta`、`delta`、`done`、`error` 的明确终态协议。

## 10. iOS 构建约束

当前开发环境有 iPhone、没有 Mac：

- Windows 可以创建 Flutter 工程、实现和测试纯 Dart 逻辑，并运行 Web/Windows 测试宿主。
- Windows 不能可靠完成 iOS 编译、签名、Xcode 调试和真机音频验收。
- 在获得 Mac 前，iOS 任务只能标记为“源代码与跨平台测试完成”，不能标记为“iOS 已验证”。
- 可评估 GitHub Actions macOS runner 或其他云端 macOS 构建生成测试包，但它不能完全替代 Xcode 与真机调试。
- 进入录音、音频会话、通知和商店发布阶段前，必须获得持续可用的 Mac/Xcode 环境和 Apple Developer 账号。

## 11. 错误处理

- 平台不支持某项能力时返回稳定内部错误，不向 UI 暴露插件原始异常。
- 麦克风拒绝后立即提供打字入口，不重复弹权限。
- 低置信度转写和平台录音失败不产生负面能力证据。
- 客户端协议版本过旧时阻止危险写入，并提示更新或使用 Web。
- iOS 原生桥接失败必须能够降级到文字输入或服务端能力。
- 未收到流式 `done` 的消息不能提交长期记忆或完整学习证据。

## 12. 测试策略

### Web 与服务端

- Vitest：纯 TypeScript 领域和 application 规则。
- React Testing Library：Web 交互和可访问性。
- Playwright：Web 关键纵向路径。

### Flutter

- `flutter analyze`：静态分析。
- `flutter test`：Dart 单元、Widget 和状态编排测试。
- Flutter integration test：移动端关键纵向路径。
- 平台桥接测试：Dart 契约测试加 iOS 真机人工/自动验收。

### 跨客户端一致性

- TS 与 Dart 同时读取 `contracts/fixtures/`。
- API Schema 在 CI 中检查生成物或客户端类型未漂移。
- 同一个内容版本、任务和输出在两端产生相同的提交 DTO。
- 服务端始终对证据和权限重新校验。

## 13. 实施顺序

1. 保留已完成的 Next.js/PWA 基础工程。
2. 建立 Flutter 工程、五项导航壳层、平台接口和测试基线。
3. Web 与 Flutter 同步完成五项导航和“继续学习”静态首页。
4. 建立版本化 API 契约与共享 JSON 一致性样本。
5. 配置服务端数据库、认证、RLS 和内容导入。
6. 以相同内容和 API 纵向打通 Web 与 Flutter 的第一个训练微循环。
7. 接入 Web 浏览器语音与 Flutter/iOS 语音适配器。
8. 在具备 Mac/Xcode 条件后完成 iOS 真机验收和 TestFlight 流程。
9. 核心闭环稳定后按 Android、Windows、macOS 的顺序完成平台发布打磨，具体顺序由真实用户需求决定。

## 14. 替代方案

### PWA + Capacitor

优点是 React/TypeScript UI 复用最高、初期最快。拒绝作为 iOS 主路线，因为核心产品长期依赖录音、音频会话、通知和实时语音，且用户明确希望避免 WebView 主客户端与未来整体重写。

### SwiftUI iOS + Next.js Web

平台体验最原生，但会立即形成 React 与 Swift 两套客户端，Android、Windows、macOS 还需继续增加技术栈。对于个人 Alpha 和未来四平台目标，开发与维护成本过高。

### Flutter 同时承担正式 Web

学习 UI 复用最高，但正式浏览器产品在 SEO、文本交互、可访问性、首屏体积和浏览器音频兼容方面存在额外权衡。保留为未来可评估方案，当前不替换已完成的 Next.js Web 基础。

## 15. 后果

正面后果：

- Flutter 四个客户端平台共享主要 UI 和业务编排代码。
- iOS 不依赖 WebView，也不需要未来整体重写 Swift。
- 已完成的 Next.js 工程继续产生价值。
- 服务端业务规则、内容和用户数据只有一个权威来源。

需要接受的成本：

- Web 与 Flutter 页面需要分别实现和测试。
- TypeScript 与 Dart 的客户端状态编排需要通过共同样本保持一致。
- CI、依赖升级和发布流程同时覆盖 Node/pnpm 与 Flutter/Dart。
- iOS 和 macOS 最终仍然依赖 Mac、Xcode、签名和真机验证。

## 16. Echo-Loop 源码复用边界

用户说明自己曾参与 Echo-Loop 贡献，并得到作者允许在需要时使用源码。当前架构设计不依赖复制该仓库代码；未来若某项 Flutter 音频、状态机或发布能力确实值得复用，先建立独立审查任务并记录：

- 授权人及其对目标文件的权利。
- 可验证的授权文本或记录。
- 覆盖的文件、目录和原始提交。
- 是否允许修改、商业使用、闭源发布和再许可。
- 署名、通知、源码公开或其他条件。
- 目标代码是否包含未被授权人覆盖的其他贡献者代码。

没有被额外授权明确覆盖的部分继续按 AGPL-3.0 处理。在审查记录完成前，不直接复制 Echo-Loop 源码或资源。
