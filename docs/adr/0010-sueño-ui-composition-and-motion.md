# ADR-0010: Sueño UI Composition and Motion Boundaries

- 日期：2026-09-21
- 状态：Accepted for `UI-SYSTEM-001`
- 影响：Web/PWA shared UI、页面 Server/Client 边界、动效、夜间验收
- 关联：[UI 组合层与动效规范技术调研](../superpowers/specs/2026-09-21-sueño-ui-composition-and-motion-technical-research.md)

## 背景

Sueño 当前是 Next.js 16、React 19、Tailwind v4 的响应式 Web/PWA。页面已经有可用的业务 UI，但基础控件、浮层焦点、动效、错误/空态和移动安全区的行为分散在 feature CSS/组件中。公开首页曾把静态结构和少量交互放进同一个 Client Component；媒体资料库的观察器和滚动更新也有生命周期风险。

调研覆盖 shadcn/ui、Radix、Base UI、React Aria、Headless UI、beUI、Rare UI、Transitions.dev、Beautiful UI、assistant-ui、AI SDK UI、Motion、Floating UI、TanStack Virtual、Sonner、Vaul、cmdk 和 Embla，并扩展核对了 Media Session/WebVTT/Picture-in-Picture、Serwist/Workbox、Playwright/axe/Lighthouse/Web Vitals 以及商业/托管组件、视觉回归、真实设备测试和遥测服务。范围同时包含开源、平台原生和非开源候选，但不把调研快照当作采购或运行时批准。目标不是把候选库全部加入，而是建立可审计、可回退的组合边界。

## 决定

1. **基础层使用 shadcn/ui 的源码分发模式**。需要的 primitive 复制为 Sueño-owned source，放在 `src/shared/ui/primitives`，由本地 token、测试和版本记录负责维护。本任务首批不引入 Radix runtime；若本地行为无法通过焦点/键盘/ARIA 门禁，另行选择一套 primitive runtime，不与 Base UI、Headless UI、React Aria 并行。
2. **动效使用 CSS token 和原生 transition/animation**。Transitions.dev 只作为模式和 reduced-motion 参考，不成为运行时依赖。常规交互只允许 transform/opacity/color 等不会触发布局的属性；动画不能写入评分、消息完成、发布或其他业务事实。
3. **高价值交互按单文件复制**。beUI/Rare UI 只在真实页面有对应工作流且来源、许可证、焦点、键盘、性能测试齐全时复制；Beautiful UI、assistant-ui、AI SDK UI 只参考 AI 对话的信息架构和流协议，不能替换 Sueño 的 parser、`generationId`、显式 `done`、角色安全或记忆权限。
4. **页面采用 Server shell + 最小 Client island**。静态文案、主要内容、LCP 媒体和服务端 DTO 留在 Server Component；只有 state、event handler、browser API 和必要的订阅进入 Client Component。客户端 props 必须可序列化且最小化。
5. **浮层与列表采用门禁式引入**。只有真实定位边界证明需要时才评估 Floating UI；只有稳定超过 100 行或真实设备 INP/内存超标才评估 TanStack Virtual；只有 iPhone Safari 真机证明需要拖拽 snap point 才评估 Vaul；没有真实 carousel 任务不引入 Embla。
6. **媒体资源采用稳定尺寸和单源策略**。公开页用 `picture`/响应式 source 或经验证的 `next/image` 策略，确保每个视口只下载需要的媒体，声明宽高/aspect-ratio，保留版权撤下和远端白名单边界。
7. **夜间执行只使用 fake/fixture/隔离本地浏览器**。不访问生产、真实 Supabase、收费 Provider、内容采集/发布、真实学习进度、录音或清理数据。每批都有独立日志、验收 JSON、回滚 ref 和停止条件。
8. **商业、闭源和托管方案保持 reference-only，除非另立准入记录**。任何商业组件、云端聊天/分析 SDK 或原生客户端能力若要进入运行时，必须先记录价格/许可、DPA/数据流、版本与安全状态、bundle/SSR/无障碍证据、供应商锁定和退出回退路径，并由人工批准新的 ADR 或变更记录；免费试用不视为许可。平台原生 Web API 作为默认回退，不依赖第三方账户或遥测。

## 替代方案

### 同时安装 shadcn、Radix、Base UI、Headless UI 和 React Aria

会重复提供焦点、portal、键盘和状态语义，增加 bundle、升级、样式冲突和供应链面；组件边界也无法判断哪一套行为是权威。拒绝并行安装。

### 直接引入 assistant-ui/AI SDK UI 作为聊天运行时

能快速得到流式消息 UI，但会把第三方的消息生命周期、工具状态和完成语义放到 Sueño 业务边界之上，难以保证 `generationId`、显式 `done`、角色真实性和记忆隔离。拒绝；只复制必要视图交互。

### 以 Motion/GSAP 全面替换 CSS

能表达更多 spring/choreography，但会提高首屏 JS、可访问性和 reduced-motion 的验证成本。保留 CSS 为默认，复杂、可中断且经真实需求证明的交互才单独评估 Motion。

### 用虚拟列表提前重写所有列表

会改变滚动、焦点、定位和读屏语义；当前首屏 18 项和分页不足以证明需要。延后到性能阈值触发。

### 采用商业组件或托管 UI 以减少维护

可能缩短初始开发，但会引入价格、数据处理、供应商变更、SSR/离线限制和退出成本。当前页面没有需要企业表格、托管客服或生产行为分析的事实需求，因此保留为 `reference-only`；若以后要采用，必须先完成研究规格中的非开源准入合同并提供可回滚的本地降级实现。

## 后果

### 正面

- 静态页面和 LCP 内容更早可见，客户端 bundle 与 hydration 范围可测量。
- primitive 的焦点、Escape、滚动锁定、reduced-motion 和主题行为有单一审计位置。
- 高价值交互可以逐步复制而不让 registry 或第三方 runtime 成为业务事实来源。
- 夜间任务在错误批次停止，人工可按最后成功 commit 回滚，不会把视觉失败扩散到评分/发布/记忆模块。

### 代价与限制

- Sueño 需要自己维护复制的 primitive，升级要做逐文件 diff、许可证和回归测试。
- 部分高级定位/手势可能先使用较简单的 native/CSS 版本，直到真实证据支持增加依赖。
- 全局 CSS 的历史重复覆盖不会在本 ADR 中一次性清理；清理必须另立范围和视觉回归。
- Browser plugin、真实 iPhone Safari、部署和生产 Web Vitals 仍需在人工验收批次中验证。

## 回滚与变更条件

- 任意 primitive 无法通过无障碍、焦点、键盘、Safari 或 bundle 门禁时，删除其页面组合引用，回退到已审计的 native/local implementation；不以放宽断言换取通过。
- 若需要改变 API、数据库、评分、权限、角色事实、记忆共享或内容发布语义，必须暂停 UI-SYSTEM-001 并新增/修订 ADR。
- 若要引入第二套 primitive runtime、聊天 runtime、虚拟列表或复杂动效库，必须提供依赖分析、真实场景证据、许可证/CVE 检查、回滚方案和新的 ADR 审阅。
- 若要把商业/闭源/托管候选从 `reference-only` 升级为运行时，必须补充价格与许可核对、DPA/数据流与删除路径、供应商安全状态、真实 bundle/浏览器证据、退出方案和人工批准；夜间任务不得自行升级或注册外部服务。
