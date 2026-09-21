# Sueño UI 组合层与动效规范技术调研

- 调研日期：2026-09-21
- 文档类型：技术研究与决策规格
- 关联任务：`UI-SYSTEM-001`
- 当前状态：研究完成；`UI-SYSTEM-001A–F` 已在当前工作树实施，`001G` 全量质量汇总已完成，`001H` 本地生产预览性能门禁通过，`001I` 可信 light/dark 自动扫描 16/16 通过，`001J` 本地交互性能为 `partial`，待用户/合并者复核
- 适用客户端：Next.js 16.3.1、React 19.2.8、Tailwind CSS 4.3.3、响应式 Web/PWA

## 1. 结论先行

Sueño 采用四层组合策略，而不是把所有开源站点同时引入：

1. **基础层：shadcn/ui source distribution + Radix primitives 的行为模式**。只复制需要的组件源码，落到仓库自己的 `src/shared/ui`，由 Sueño 的 token、中文/西语文案和业务状态控制行为；本批使用可审计的本地实现，不把 Radix runtime 作为隐式依赖。第一批只考虑 `Dialog/AlertDialog/Popover/Select/Tabs/Sheet/Tooltip/Skeleton/ScrollArea/Command`。
2. **动效层：Transitions.dev 作为模式目录与 token 参考，CSS 变量作为运行时唯一规范**。不把站点或 CLI 当成运行时依赖；实现只使用 transform/opacity、可取消状态切换和 `prefers-reduced-motion` 分支。
3. **高价值交互层：按需复制 beUI/Rare UI 的单文件组件**。优先消息流、Prompt 输入、Toast/Drawer、阅读进度、Step Player、active sidebar；每个组件先经过 Sueño 的键盘、焦点、状态机和性能验收。禁止整站替换或未经审计的注册表批量安装。
4. **AI 对话参考层：Beautiful UI 和 assistant-ui/AI SDK UI 只作为信息架构与流协议参照**。Sueño 保留自己的 `ConversationNdjsonParser`、`generationId`、消息持久化和角色/记忆安全边界，不把第三方聊天 runtime 作为事实来源。

补充候选：

- 复杂浮层定位优先评估 `@floating-ui/react`，而不是自己维护 viewport 边界算法。
- 大量消息/文章/媒体达到阈值后评估 `@tanstack/react-virtual`；当前数据规模不足以默认引入。
- Toast 可采用 shadcn 的 Sonner 集成或 `sonner`，但只保留一个全局通知出口。
- 移动底部抽屉可评估 `vaul`；仅在 Sheet 的键盘、焦点和 iOS Safari 手势验收通过后使用。
- `cmdk`、Embla、Headless UI、React Aria Components、Base UI 和 Radix 都是可替代方案，不在本任务同时引入。

## 2. 研究范围与证据

以下页面均在 2026-09-21 读取官方页面或官方 GitHub/npm 元数据。版本是研究快照，不是锁定依赖声明。

| 候选 | 当前证据 | 许可/分发 | Sueño 判断 |
| --- | --- | --- | --- |
| [shadcn/ui](https://ui.shadcn.com/docs) | 官方定位为 accessible components + code distribution platform，不是黑盒 npm 组件库；registry/CLI 可复制源码 | MIT；GitHub `shadcn-ui/ui`；npm `shadcn` 4.21.0 | 采用基础层，复制源码并纳入本地审计 |
| [Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction) | unstyled、可组合、强调 ARIA、焦点管理和键盘导航；可渐进采用 | MIT；`@radix-ui/react-*` 1.1.23（抽查 Dialog/Popover） | 作为 shadcn 基础行为的参考；只有本地实现无法满足门禁时才按组件引入 |
| [Base UI](https://base-ui.com/react/overview/quick-start) | unstyled primitives；提供 portal、iOS Safari stacking context 等指导 | MIT；`@base-ui-components/react` 1.0.0-rc.0 | 不与 Radix 并存；仅在 Radix 组件无法满足时做替代评估 |
| [React Aria Components](https://react-spectrum.adobe.com/react-aria/) | 50+ style-free 组件，适配交互、国际化、拖放和表单验证 | Apache-2.0；`react-aria-components` 1.21.1 | 高风险无障碍组件的备选，不与 Radix 同时作为基础层 |
| [Headless UI](https://headlessui.com/) | fully unstyled，键盘导航和状态 data attributes，和 Tailwind 紧密结合 | MIT；`@headlessui/react` 2.2.10 | 参考模式，不新增第二套 primitives |
| [beUI](https://beui.dev) | shadcn registry；官方首页列出 120 components，页面 registry 当前抽查约 85 项，Motion + Tailwind + React 19；含 toast、tabs、drawer、prompt、message 等 | MIT；GitHub `starc007/ui-components` | P1 单组件复制，适合高价值交互；不批量安装 |
| [Rare UI](https://rareui.com) | shadcn CLI 单文件 registry；首页列出 20+，当前 registry 抽查约 22 项；侧栏、scroll progress、step player、delete/task 等 | MIT；GitHub `swamimalode07/rare-ui` | P1/P2 只选能表达学习进度的组件；避开 WebGL/gooey/复杂拖拽 |
| [Transitions.dev](https://transitions.dev) | CSS/React transition 目录，含 card resize、text swap、panel、modal、skeleton、tabs、error shake，并提供 skill/CLI | MIT；GitHub `Jakubantalik/transitions.dev`；npm `transitions.dev` 0.3.0、refine 0.3.34 | 采用其模式和 reduced-motion 思路，不作为应用运行时依赖 |
| [Beautiful UI](https://beautifului.dev) | MIT showcase；Loading/Thinking/Streaming/Approval/Tool/Task/Context/Prompt 等 AI-native 信息架构 | MIT；公开站点未提供 Sueño 所需的稳定 registry/npm runtime | 视觉与信息架构参考，不引入依赖 |
| [Motion](https://motion.dev/docs/react-quick-start) | React 动效库；支持 spring、gesture、useReducedMotion；现代浏览器优先使用 Web Animations API | MIT；npm `motion` 13.4.0 | 只有需要可中断 spring/gesture 时才加；普通状态优先 CSS |
| [Floating UI](https://floating-ui.com/docs/react) | 定位和交互 primitives，覆盖 tooltip/popover/menu/dialog；不提供预制视觉 | MIT；`@floating-ui/react` 0.27.20 | P1 评估消息菜单、词语解释器和浮层边界 |
| [TanStack Virtual](https://tanstack.com/virtual/latest) | 只渲染 viewport 内容，保持滚动契约；适合长列表 | MIT；`@tanstack/react-virtual` 3.14.13 | 达到明确行数/性能阈值后再引入 |
| [AI SDK UI](https://ai-sdk.dev/docs/ai-sdk-ui/overview) | framework-agnostic chat/completion UI 抽象，覆盖 stream、工具、持久化和错误处理 | Apache-2.0；npm `ai` 7.0.107 | 只参考协议和恢复模式；现有 conversation contract 不迁移 |
| [assistant-ui](https://www.assistant-ui.com) | runtime + primitives，支持 streaming、reasoning、tools、approval、sources、voice | MIT；npm 0.0.117 | 参考 AI 工作台密度；不替换角色关系/记忆实现 |
| [Sonner](https://sonner.emilkowal.ski) | opinionated toast，含 action、promise、swipe 和 headless 模式 | MIT；npm 2.0.8 | 可作为 shadcn Toast 的实现候选，需统一出口 |
| [Vaul](https://vaul.emilkowal.ski) | drawer，支持 snap point、拖拽和移动端手势 | MIT；npm 1.1.2 | 仅在移动 Sheet 需要手势时评估 |
| [cmdk](https://cmdk.paco.me) | fast, unstyled command menu | MIT；npm 1.1.1 | 阅读/内容搜索命令面板的备选，不是首批依赖 |
| [Embla Carousel](https://www.embla-carousel.com) | lightweight、SSR 友好、可扩展 carousel，强调 swipe precision | MIT；npm 8.6.0 | 当前产品没有 carousel 主流程，不引入 |

许可证说明：网站页脚或 GitHub metadata 的 MIT/Apache 标识只说明公开项目的仓库许可；复制具体文件时仍需保留该项目要求的版权/许可声明，并在依赖清单中记录来源和版本。Transitions.dev 的单个示例若包含第三方片段，实施时必须逐文件复核，而不是仅依据站点首页判定。

### 2.1 研究方法与外部标准

本轮结论同时使用三类证据，避免把“站点展示效果”误当成可直接采用的工程事实：

1. **官方实现与元数据**：逐项核对项目官方文档、GitHub/npm 的分发方式、许可证和当前版本快照。版本只用于研究追溯，不作为自动升级承诺。
2. **当前仓库证据**：通过 `rg`、路由/组件阅读、生产 build 和隔离浏览器检查，核对当前页面的 Server/Client 边界、状态模型、列表规模、错误态和资源请求；不以其他分支或历史交接代替当前工作树证据。
3. **平台/无障碍规范**：以 [WCAG 2.2 Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)、[Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)、[Contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)、[WAI-ARIA Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)、[WAI-ARIA Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) 作为行为验收依据，并按仓库锁定的 Next.js 16 文档核对 [Server/Client Components](../../../node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md)、[Image Optimization](../../../node_modules/next/dist/docs/01-app/01-getting-started/12-images.md)、[Lazy Loading](../../../node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md) 和 [Streaming](../../../node_modules/next/dist/docs/01-app/02-guides/streaming.md)。

外部规范用于定义门槛，不意味着本任务已经通过真实设备或部署验收。尤其是 WCAG 的文字/焦点门槛、Web Vitals 预算和 iPhone Safari 行为，必须在对应环境重新测量。

### 2.2 不限于开源库的候选类别

“调研不限于开源工具”不等于把商业 SDK 作为默认方案。下表把平台原生能力、规范/验证工具和商业闭源选项一起放入决策面，记录为何当前采用或不采用。

| 候选类别 | 代表方案 | 适用场景 | 成本/锁定/兼容性 | Sueño 决定 |
| --- | --- | --- | --- | --- |
| 原生 Web | HTML button/link/input、CSS transition、`picture`、IntersectionObserver、`prefers-reduced-motion`、Web Streams | 基础交互、响应式图片、可访问状态、流式 transport | 无许可费和运行时依赖；浏览器差异由测试承担；最适合 Next 16 SSR | 默认采用，作为所有第三方方案的回退 |
| 平台规范 | WCAG 2.2 AA、WAI-ARIA APG、Apple HIG、iOS Safari safe-area/dynamic viewport | 焦点、键盘、触控目标、读屏、移动安全区 | 不是代码库；需要人工/自动验收，不能用组件宣传替代 | 作为强制门禁和设计依据 |
| 浏览器/性能工具 | Chrome DevTools/Lighthouse/Web Vitals、Playwright trace、axe-core | LCP/CLS/INP、长任务、焦点、响应式和视觉回归 | 工具可免费使用；lab 与真实设备结果不同；axe 不能证明全部 WCAG | CI/夜间采用；真实 iPhone 另行人工验收 |
| 可访问性自动化 | `@axe-core/playwright`、Deque axe DevTools | 在 fake fixture 上发现 critical/serious 结构性违规 | 扫描本身不能证明读屏、键盘、对比度全覆盖；新增依赖和规则版本需锁定 | 条件候选；夜间先用本地/脚本扫描，未进入运行时 |
| 实验室性能 | Lighthouse CI、`web-vitals`、Chrome trace | 固定条件下记录 LCP/FCP/CLS/INP、长任务和资源瀑布 | lab 结果与真实 iPhone/CDN 不同；需固定版本、阈值和 artifact 保留 | 条件工具；生产前再接入，不把本批脚本的 INP=0 当通过 |
| 媒体平台 API | Media Session、WebVTT、Picture-in-Picture、Web Audio | 锁屏控制、字幕、系统媒体按钮和渐进增强 | 浏览器权限/实现差异；不能替代播放器状态和证据模型 | 原生能力优先；仅按媒体详情需求验收 |
| PWA 离线/更新 | Serwist、Workbox、Service Worker、Background Sync | 安装、缓存、离线 fallback 和版本更新 | 缓存陈旧、隐私数据滞留、iOS Safari 限制；需要删除/失效策略 | `reference-only`/条件候选；当前不缓存私密学习数据 |
| 可访问性 primitives | Ariakit、Zag.js、React Spectrum/React Aria | 复杂 composite widget、焦点和状态机 | 与本地 primitives 形成第二套行为层；bundle/样式/迁移成本 | 不并行引入；本地行为无法满足门禁时单组件替代评估 |
| 媒体 UI | Vidstack、Shaka Player、原生 `<video>/<audio>` | 可扩展字幕、媒体控制、DRM/多源播放 | 播放器体积、SSR/PWA、托管媒体和现有 Plyr/audio adapter 迁移成本 | 当前保留现有适配器；只有真实媒体需求触发 ADR |
| 错误与性能诊断 | Sentry、OpenTelemetry、Vercel Analytics | 生产错误、trace、Web Vitals 趋势 | 私密对话/录音/URL 脱敏、DPA、保留期、费用和供应商锁定 | `reference-only`；无外部遥测进入 Alpha |
| 商业组件/托管 UI | Kendo UI、MUI X、Syncfusion、PrimeReact、Headless commercial kits | 大型企业表格、复杂日历、长期厂商支持 | 许可证/席位费、主题锁定、bundle 及 SSR 适配需核价；当前页面无此需求 | 不采用；需求范围可由 native/local primitives 覆盖 |
| 商业动效/分析 | GSAP Club、LogRocket/FullStory 等 | 复杂编排或真实用户性能诊断 | 订阅、隐私/数据保留和供应商锁定；可能引入额外脚本 | 不作为 UI runtime；生产分析另立隐私与成本评估 |
| 云端 AI UI/托管聊天 | Vercel AI UI、厂商 conversation kit、第三方客服 widget | 快速搭建通用聊天或客服 | 供应商协议可能改变消息/工具/数据所有权；与角色记忆和 `generationId` 不同 | 只参考协议；不替换 Sueño conversation contract |
| 原生移动路线 | iOS SwiftUI/UIKit、Flutter Material/Cupertino | 真机级录音、系统权限、PWA 不可覆盖的能力 | 新客户端、插件和同步成本；当前 Alpha 明确 Web/PWA 优先 | 延后；本任务不新增原生页面 |

商业/闭源候选的“不采用”是范围与可控性判断，不代表其产品质量较低。若未来需要表格、企业支持、行为分析或原生权限能力，须分别记录价格、数据处理、锁定、bundle、SSR/React 兼容和退出方案后再立 ADR。

#### 2.2.1 非开源与托管方案的准入合同

商业组件、闭源 SDK、托管 UI、分析服务和原生平台能力与 MIT/Apache 代码一样需要可复核记录，但它们不能只用“官网看起来可用”作为证据。进入 Sueño 设计或运行时前，必须把候选标为 `adopt`、`trial`、`reference-only`、`reject` 或 `not-run`，并填齐以下字段：

| 审计维度 | 必须回答的问题 | 缺失时的处理 |
| --- | --- | --- |
| 功能与平台 | 是否解决当前页面的真实工作流；React 19/Next 16 RSC、SSR、PWA、Chromium/iOS Safari 是否有可复现实例 | 只能 `reference-only`，不能进入 bundle |
| 商务与法律 | 价格/席位/用量、试用期限、商业许可、归属与再分发限制、DPA/子处理者、数据区域和保留期 | 暂停采用，交人工核价/法务；夜间任务不注册试用 |
| 运行时成本 | 新增 JS/CSS、网络请求、hydration、长任务、Web Vitals、离线/网络失败行为 | 没有生产 build 或 bundle 证据不得采用 |
| 可访问性与安全 | WCAG/ARIA 证据、键盘/焦点/reduced-motion、CVE/安全公告、遥测默认开关 | 不能用宣传页或 axe 单次结果替代；缺证据即拒绝 |
| 数据与退出 | 是否上传消息、录音、DOM 或用户行为；导出、删除、停用、供应商替换和降级路径是否可行 | 不能触及真实用户数据；无退出路径保持 `reference-only` |
| 所有权与回滚 | owner、版本/合同日期、变更监控、替代实现、移除步骤和回滚 ref | 只允许文档评估，不允许夜间自动引入 |

平台原生能力（HTML/CSS/Web Streams、IntersectionObserver、`picture`、`prefers-reduced-motion`、iOS safe-area）默认作为回退和基线；商业服务即使免费试用，也不能在无人值守任务中创建账户、发送遥测或依赖外部网络。托管服务的价格、条款和供应商安全状态随时间变化，研究快照不等于采购批准。

#### 2.2.2 商业与托管候选快照（2026-09-21）

以下是本轮对官方价格/许可页面的只读快照。金额、试用条件、区域税费和套餐内容会变动，因此这里只记录可影响架构选择的事实，不把快照当作采购承诺。没有把任何候选加入 `package.json`、没有注册试用，也没有向服务上传页面、DOM、消息或录音。

| 候选 | 官方页面观察 | Sueño 风险/适用边界 | 当前决定 |
| --- | --- | --- | --- |
| MUI X | [商业许可与遥测说明](https://mui.com/x/license/)明确区分商业计划、开源组件和可选 telemetry；Data Grid 社区版与 Pro/Premium 的许可需按组件核对 | 复杂 Data Grid/树表有价值，但会增加主题、许可证、bundle 和升级边界；不解决学习/对话核心体验 | `reference-only`；只有真实数据密度需求和逐组件许可核对后再评估 |
| KendoReact / DevCraft | [购买页](https://www.telerik.com/purchase/kendo-ui)在本次快照展示按开发者/年订阅，套餐价格约为 USD 799–1,649；属于商业授权并含不同支持等级 | 适合企业级表格/报表和厂商支持；当前页面没有该规模需求，许可证席位和长期订阅成本不合理 | `reject` for current Alpha；保留企业后台场景参考 |
| Syncfusion React | [官方组件页](https://www.syncfusion.com/react-components)宣传 140+ 组件、React 19 支持和无需信用卡的试用；正式采用仍需核对 Community/商业资格与再分发条款 | “免费试用”不等于生产许可；全量组件会扩大 bundle 和主题面，夜间任务不能创建试用账户 | `reference-only`；若未来需要 DataGrid，先做许可证、bundle 和可退出实现 |
| LogRocket | [价格页](https://logrocket.com/pricing/)将 session replay、产品分析、错误监控打包，价格取决于 seats、保留期和 add-ons；页面说明可条件录制 | 会捕获 DOM、交互和错误上下文，可能触及私密对话/录音/令牌；必须先完成字段脱敏、DPA、保留与删除验证 | `reference-only`；不进入产品 UI runtime 或夜间任务 |
| FullStory | [价格页](https://www.fullstory.com/pricing/)提供 session replay、heatmap、产品分析和移动采集，价格/套餐以销售或动态配置为准 | 行为回放与跨设备采集会扩大隐私和数据区域责任；与个人 Alpha 的最小采集原则冲突 | `reference-only`；只有另立隐私/分析任务并获得明确批准才评估 |
| BrowserStack | [价格页](https://www.browserstack.com/pricing)提供云端真实浏览器/设备测试，页面快照展示从约 USD 12.50/月起的计划并按用户/并发/能力分层 | 测试页面、截图和日志会离开本机；不得把真实账号、私密内容或生产 URL 上传；真实 iPhone 仍需人工数据边界 | `reference-only`；夜间使用本机 Playwright，未来只上传脱敏 fixture |
| Percy | [价格页](https://percy.io/pricing/)是托管视觉回归服务，按团队/快照或用量计费（套餐内容以动态页面为准） | 截图/DOM 上传和快照保留需要数据处理与删除合同；不能用第三方视觉 diff 替代键盘、读屏和状态断言 | `reference-only`；仅在脱敏 fixture 和 DPA 评估完成后考虑 |
| Chromatic | [价格页](https://www.chromatic.com/pricing)本次快照显示 Free、Starter USD 179/月、Pro USD 399/月，并按 billed snapshots/并发能力分层 | Storybook 快照上传、保留和项目权限形成供应商锁定；价格/快照预算需独立审批 | `reference-only`；当前用本地 Playwright/截图 artifact |

这些商业/托管快照只改变“候选的可审计性”，不改变本任务决定：基础 primitive 仍由本地源码所有，动效默认 CSS/native，页面业务事实仍由服务端和现有状态机控制。若价格、许可、DPA、数据保留、CVE/安全公告、SSR/bundle、无障碍或退出路径任一项无法获得证据，候选继续保持 `reference-only`，不得进入夜间运行时。

#### 2.2.3 调研范围完整性与运行时边界

本轮调研不以最初的五个站点为封闭清单，而是按“基础行为、业务/对话、动效、媒体、PWA、验证与商业/托管服务”六类扩展候选。当前结论可按下面的边界复核：

| 类别 | 已覆盖候选 | 当前可用层级 | 仍需补证据的升级条件 |
| --- | --- | --- | --- |
| 基础行为与可访问性 | Radix、Base UI、React Aria Components、Headless UI、Ariakit、Zag.js | shadcn source + Sueño-owned primitives；其余只作单组件替代参考 | 本地组件在真实复合控件/焦点门禁失败，且只选择一套 runtime；需 React 19/Next 16、SSR、ARIA、bundle 和回滚证据 |
| AI 对话信息架构与流 | Beautiful UI、assistant-ui、AI SDK UI | 视觉、流协议、错误恢复和消息密度参考；现有 parser/application 才是事实来源 | 要共享 runtime 时必须另立 ADR，逐项映射 `generationId`、显式 `done`、取消/重试、角色真实性、工具/来源/审批和记忆权限；禁止把 reasoning/voice 状态当作业务事实 |
| 动效与手势 | Transitions.dev、Motion、GSAP 等 | CSS/native token 默认；Motion 只作局部可中断 spring/gesture 候选；商业动效保持 reference-only | 真实交互需要 spring/gesture，且生产 bundle、reduced-motion、键盘/读屏和长任务证据通过；动画不得写评分、发布或完成事实 |
| 媒体与系统能力 | Media Session、WebVTT/TextTrack、Picture-in-Picture、Web Audio、Vidstack/Shaka | 原生 API 与现有播放器适配器优先；第三方播放器只在媒体需求触发 ADR | action handler、音频中断/恢复、字幕、权限和不支持浏览器的降级必须与播放器状态一致；不得把系统播放状态写成学习证据 |
| PWA、离线与更新 | Service Worker、Serwist、Workbox、Background Sync | online-first；当前只允许 manifest/app-shell 评估，不缓存私密业务数据 | 另立 ADR，明确缓存 allowlist、版本失效、登出/删除清理、多标签页和 iOS Safari 行为；不得缓存聊天、证据、画像、记忆、录音、签名 URL 或离线评分写入 |
| 验证与观测 | Playwright、axe/Deque、Lighthouse CI、web-vitals、Percy/Chromatic、BrowserStack、Sentry/LogRocket/FullStory | 本地 Playwright/axe/构建 artifact 为夜间证据；托管测试/遥测只作 reference-only | 测试专用依赖与产品 runtime 分离；固定版本/许可证和脱敏字段；任何 DOM、消息、录音或截图出网都需要人工批准、DPA、保留/删除和退出路径 |

因此，“已调研”不等于“已批准引入”：`adopt` 仅适用于本地源码、原生 API 或已有依赖；`trial` 只能在隔离 fixture 中验证；`reference-only` 不得进入 bundle、锁文件或夜间网络；`reject` 需要记录范围/成本/隐私原因。每个候选的许可证必须按实际复制文件和传递依赖复核，不能用站点页脚、npm 默认标签或一次 axe/Lighthouse 结果替代法律、无障碍、性能和数据处理证据。

### 2.3 可复核证据登记

下表是本轮决策的最小证据索引。它记录“查过什么”和“如何验证”，不把首页宣传、npm 版本或一次本地通过误写成生产保证。版本是 2026-09-21 的研究快照；引入前仍需用锁文件和目标浏览器重测。

| 证据项 | 访问/读取位置 | 复核字段 | 本轮结论 |
| --- | --- | --- | --- |
| shadcn/ui、Radix、Base UI、React Aria、Headless UI | 官方 docs、GitHub/npm 元数据 | source distribution、许可证、React 19/Next 16 适配、焦点/键盘模型 | 采用 shadcn 复制源码；其余不并行作为基础运行时 |
| beUI、Rare UI、Transitions.dev、Beautiful UI | 官方站点与公开 registry/repository | 单文件分发、Motion/Tailwind 依赖、registry 稳定性、reduced-motion 责任 | 只复制有真实页面价值的 recipe；其余作为参考 |
| Motion、Floating UI、TanStack Virtual、Sonner、Vaul、Embla | 官方 docs/npm 元数据 | bundle/运行时边界、SSR、浏览器支持、触摸/定位/虚拟化成本 | 条件候选，不加入首批依赖 |
| WCAG 2.2、WAI-ARIA APG、Apple HIG / WebKit | W3C、ARIA APG、Apple/WebKit 官方规范 | focus not obscured、target size、contrast、dialog/tabs、safe-area/dynamic viewport | 作为验收门禁；不能由组件宣传替代 |
| Next.js 16 本地 guide | `node_modules/next/dist/docs/` 的 Server/Client、Image、Lazy Loading、Streaming 文档 | RSC 边界、可序列化 props、fallback 尺寸、流式完成事实 | server shell + client island；业务 `done` 仍由 parser/服务端定义 |
| 本仓库实现与测试 | 路由、模块、Vitest、Playwright、生产 build | 页面状态、generationId、空/错/重试、资源请求、构建结果 | 以当前工作树证据为准；不借用其他分支完成宣称 |

每次新增依赖或复制文件必须补充以下字段：`sourceUrl`、访问日期、commit/semver、SPDX 许可证、复制文件、传递依赖、React/Next/Tailwind 兼容矩阵、CVE/供应链检查日期、bundle 证据、owner 和回退方式。若字段缺失，条目只能标为 `reference-only`，不得进入生产 bundle。

本轮未执行商业服务试用、BrowserStack/Percy/LogRocket 等托管服务调用，也未以它们的结果证明兼容性；它们只作为未来需要真实设备矩阵、视觉基线或生产诊断时的候选。夜间任务默认不产生付费调用和遥测数据。

## 3. Sueño 当前基线审计

### 3.1 页面与架构

| 表面 | 当前实现事实 | 影响 |
| --- | --- | --- |
| 匿名 `/` | `app/public-home-experience.tsx` 提供 server/static shell；`PublicHomeJourney` 与 `PublicHomeMotion` 是最小 client islands；媒体图片有稳定尺寸 | 静态文案、链接和产品预览留在 server 输出；仅 journey mode、可见性订阅和浏览器动效进入 client bundle |
| 公共 CSS | `app/globals.css` 约 12,540 行、工作树约 475KB；存在多轮 token、媒体和 landing 覆盖 | 级联复杂度、无用选择器和主题回归风险；需要分层与预算，不在本任务一次性重写 |
| 登录后壳 | `AppShell` 同时挂载 skip link、桌面侧栏、移动底栏、网络提示；桌面导航 5 个链接默认 `prefetch` | 每页共享 hydration 和预取成本；应按高意图路由和可见状态收敛 |
| `/learn` | 服务端媒体库，默认 `pageSize=18`，空态/不可用态诚实 | 保持“打开即视频/播客资料库”，不能引入 Hero、开始/继续 CTA |
| `/learn/media/[stableKey]` | 播放器、字幕、词级时间线和 lexical drawer 已有独立组件 | 只引入 Sheet/Popover/Tooltip 等行为，不替换媒体状态机 |
| `/explore` | dashboard 与 library 当前顺序读取 | 可在确认 repository 语义后合并独立读取；UI 仍保持单一决策区 |
| `/read` | 搜索、排序、筛选、添加菜单、保存和分页；文章阅读器为约 495 行 client | 先统一 Popover/Select/Sheet/Skeleton，再拆阅读器高频/低频工具 |
| `/chat` | `ChatThread` 约 44KB/873 行，已有 NDJSON parser、generation 保护、消息搜索、引用、翻译、联系人 rail、voice composer | 不迁移 assistant runtime；优先抽 `MessageScroller/PromptBar/Toast/Sheet` 行为 |
| `/me` 与内容工作流 | 有数据/空/错误/权限门禁和隐私控制 | 组件层不得把状态标签变成可点击假按钮，不得弱化服务端权限 |

### 3.2 已观察的性能/交互风险

- `MediaLibrary` 的 scroll listener 会在滚动时直接 `setState`；load-more `IntersectionObserver` effect 缺少稳定依赖，可能随渲染反复建立 observer。首批修复应使用稳定 callback、单一 observer 生命周期和必要的 rAF/throttle。
- 媒体无限加载目前每次追加 18 项；短期保持行为不变，达到 DOM/INP 门槛后再采用 TanStack Virtual 或窗口化，不能先改变滚动语义。
- `MediaArtwork` 使用带 lazy 的普通 `<img>`；若切换 `next/image`，必须保留远端白名单、版权/withdrawn 语义和固定 aspect-ratio，避免 CLS。
- Explore 的 dashboard/library 顺序读取是潜在等待时间；只有两个 application 查询无事务依赖时才并行。
- `/chat` 与文章阅读器的 client surface 较大；拆分必须保持 `generationId`、显式 `done`、取消/重试和隐私边界。
- 隔离空数据库验证中登录后页面可渲染，但 `/api/v1/me`、saved、conversation、profile 的 503 是环境不可用，不得写成产品错误或真实数据库通过。

### 3.3 当前可复现基线（研究环境）

- 分支：`codex/public-home-001`，HEAD `df3a9dc`；工作树存在用户/并发修改，未覆盖。
- 匿名 `/` 在本地 Chrome fallback 的 `1440x900`、`375x812` 均 HTTP 200，无横向溢出和框架 overlay；journey button 改变 `aria-pressed` 与 proof 文案。
- 当前公开页在 `1440x900` 与 `375x812` 的 Playwright 截图中均露出下一段 journey 顶部；首屏无横向溢出，hero/产品预览与下一段之间保持连续阅读路径。截图和命令记录在 `UI-SYSTEM-001G` 仓库外 artifacts，不把 Chromium mobile viewport 冒充真实 iPhone Safari。
- 公开页已改为单一 `picture` 响应式源；CSS/浏览器选择仍需在每个目标 viewport 记录实际请求 URL，避免未来新增备用节点后重新产生移动端额外下载。
- reduced-motion 下 landing grid 动画被 CSS 关闭，交互仍可用。
- dev 采样约为：globals CSS 78KB、公开页 client chunk 7.5KB；dev bundle 不代表生产预算，但说明整页 client 与全局 CSS 都有优化空间。
  - 未执行真实部署、真实 iPhone Safari、真实生产数据库或收费 Provider 验证。

### 3.4 性能与交互基线（当前工作树）

下表是本轮可复现的工程基线，不是生产承诺；数字来自本地隔离浏览器/构建产物采样，后续批次应以同一脚本复测。

| 指标 | 当前观察 | 目标/门禁 | 处理方式 |
| --- | --- | --- | --- |
| 匿名首页 Client JS | 约 7.5 KB dev client chunk；整页曾由一个 client module graph 承载 | server shell 保持静态；交互只进入 islands；生产产物不得高于拆分前基线 | 用 `next build` 产物比较，不用 dev 数字宣称通过 |
| 全局 CSS | 工作树约 12.5k 行、约 475 KB；dev 编译约 78 KB | 新增选择器必须 scoped；不再增加无界覆盖 | 后续分批清理，不在 UI-SYSTEM-001 一次性重写 |
| 首页媒体请求 | 原先 desktop/mobile 节点可能同时被请求；现改为单一 `picture` source | 每个视口只请求一个公开产品图；宽高/aspect-ratio 稳定 | Playwright 记录请求 URL 和截图 |
| `/learn` 首批列表 | 服务端首屏 18 项，加载更多保持分页语义 | 稳定超过 100 行或真实 INP/内存超标前不虚拟化 | 达到阈值才评估 TanStack Virtual |
| 滚动/观察器 | `MediaLibrary` 已改为稳定 observer 与 rAF/timeout 调度 | 加载更多不重复触发；卸载释放 observer、listener、frame | 单测 + 长列表 fake fixture |
| 动效 | 既有页面存在多轮 CSS 规则；新 token 统一 `transform/opacity` 与 reduced-motion | 常规交互主线程目标 60fps；不以 animation end 写事实 | 超标回退 CSS/native，不自动引入 Motion |
| 固定 UI 与焦点 | 桌面侧栏/移动底栏/Sheet 共存 | 键盘焦点至少部分可见；正文有 `scroll-padding` 或等价偏移 | 375/768/1024/1440 + 键盘验收 |

  Next.js 16 的约束是设计决策的一部分：静态首屏、LCP 图像和正文不应被慢的 Client Component 或 Suspense 边界阻塞；Suspense fallback 必须保留最终内容尺寸；客户端 props 只传可序列化、最小 DTO。对话流可以逐步渲染视觉内容，但 HTTP/NDJSON 的 `done` 仍是业务完成事实。

  本轮 H 性能批次进一步验证了实验室边界：生产构建 + 隔离 `next start` + Chrome 4× CPU/慢 4G 近似下，1440×900 与 375×812 各 5 次冷上下文均 HTTP 200、无横向溢出、CLS p75 为 0；桌面 LCP/FCP p75 为 1,724ms，移动 LCP/FCP p75 为 1,548ms，满足本地 LCP ≤2.5s、FCP ≤1.8s 门禁。H 标记为 `pass` 仅代表本地生产预览实验室证据；脚本没有交互样本产生的 INP=0 仍不能算通过，真实设备/CDN 仍需单独验收。原始 `performance.json`、`acceptance.json`、`manifest.json` 和 `handoff.md` 位于仓库外 `D:\temp\sueno-ui-system-001\UI-SYSTEM-001H\`。

  001I 可信自动扫描随后在本地 fake/fixture Chromium 上覆盖 8 条路由的 light/dark 共 16 个页面；每条路由先断言预期 heading，再运行默认 motion 的 axe `wcag2a/wcag2aa` 检查，四级 violation 均为 0。首页 scroll-reveal 的低不透明度合成问题已修复为只使用 transform。权威结果位于 `D:\temp\sueno-ui-system-001\UI-SYSTEM-001I-final\axe-results.json`。这只证明当前渲染 DOM 的自动门禁，不替代读屏、完整键盘、forced-colors、200% zoom、真实 iPhone Safari 或部署验收；J 总体仍为 `partial`：优化前样本的移动 Explore/Learn 打开动作约 244–256ms，另有一次桌面 Learn 约 248ms；优化后另有本地 fixture `pass` 证据，但不能升级为生产或真机通过。

### 3.5 页面级优化决策（基于当前工作树）

下表把当前网站观察到的结构、交互和性能问题转换为页面与组件的实施边界。`P0` 是保持产品不变量所必需的组合，`P1` 是当前体验/性能收益明确的优化，`P2` 只有达到阈值后才做。表中的“采用”指本地源码或平台能力，不代表把对应站点的整套 runtime 加入项目。

| 页面/表面 | 当前事实与风险 | 优化组合（优先级） | 明确不做 | 关键验收 |
| --- | --- | --- | --- | --- |
| `/` 公共首页 | 静态内容与产品预览已 server-first；首屏 H p75 LCP/FCP 桌面 1,724ms、移动 1,548ms；媒体尺寸稳定 | P0 保留 server shell；P1 仅保留 journey/motion 两个 client island；原生 `picture` + transform reveal | 不引入 landing 动画库、全页 client、额外 hero 视频或第三方分析脚本 | HTTP 200、CLS 0、移动首屏露出下一段、每 viewport 只请求一个媒体源 |
| `/learn` 媒体库 | 默认 18 项分页；学习页必须打开即内容；筛选是高频操作；当前移动 Popover 打开重复样本约 246–249ms | P0 Skeleton/Popover/Select；P1 移动筛选使用稳定 bottom-sheet 样式并减少同步重渲染；P2 超过 100 行或内存/INP 阈值才评估 Virtual | 不加 Hero、开始/继续 CTA、时长/打卡主指标或提前虚拟化 | 375/768/1440 无溢出；筛选焦点恢复；加载更多一次；代表交互 p75 ≤200ms 或有明确 partial 记录 |
| `/learn/media/[stableKey]` | 播放器、字幕、词级时间线和 lexical drawer 已独立；媒体状态不是评分事实 | P0 原生媒体控件 + Sheet/Popover/Tooltip；P1 在浏览器支持时接入 WebVTT/TextTrack、Media Session、PiP | 不用系统播放状态写学习证据；不替换现有播放器适配器；不为手势引入 Vaul | 播放/暂停/seek/字幕/词语解释可取消；字幕缺失/错误可重试；技术失败不扣能力 |
| `/explore` | dashboard 与 library 为服务端 DTO；筛选本地改 URL；当前桌面交互可在预算内，移动打开约 244–256ms | P0 单一搜索/筛选决策区 + Popover；P1 使用 `startTransition`/局部 memo 评估移动反馈；P2 两个无事务查询才并行 | 不把统计做成 button；不引入 Step Player/Progress 作为装饰；不为本地筛选做全页导航 | URL、aria-pressed、空态和返回状态一致；筛选动作不写学习证据；移动触控目标 ≥44px |
| `/read` 与文章阅读器 | 搜索/排序/筛选/保存/解释多，阅读器 client 面较大；文本选择是核心输入 | P0 Popover/Select/Sheet/Skeleton；P1 拆高频工具与低频解释面板；原生 Selection API + 服务端词语解释 | 不把阅读/打字变成口语证据；不使用 carousel 或全局命令面板替代正文导航 | 解释浮层不遮挡选区；保存/删除显示服务端结果；长文正文 60–75 字符宽度 |
| `/chat/[characterId]` | `ChatThread` 约 44KB，已有 generation、NDJSON、取消、联系人和语音状态；最易被通用 AI runtime 越权 | P0 本地 MessageScroller/PromptBar/Sheet；P1 只优化滚动和可见消息；保留现有 parser/application | 不引入 assistant-ui/AI SDK runtime；不把 reasoning/voice 状态当作 done；不在未完成表达时纠错 | token 可见但只有显式 `done` 完成；旧 generation 不更新；停止/断流/重试可读可达 |
| `/me` | 能力、画像、隐私、语音与记忆权限混合；危险动作有删除/共享后果 | P0 Tabs/AlertDialog/Toast；P1 按数据域拆卡片并邻近显示错误；服务器结果才更新 UI | 不把状态标签渲染成假按钮；不把第三方遥测默认打开 | 删除/导出/共享均确认且可恢复；权限失败不改变本地状态；toast 不抢焦点 |
| `/me/content-workflow` | 候选、权利、语言/教学/结构审核和发布是多门禁流程 | P0 Skeleton/AlertDialog/Toast；P1 按审核维度分组并突出服务端结果 | 不在客户端制造 publishable；不以动画或 toast 代替发布结果；不接商业 CMS | draft/review/published/withdrawn 语义清晰；每次发布有 revision/hash/权限证据 |

### 3.6 候选工具准入评分

评分使用 1–5 分：`5` 表示对 Sueño 当前 Alpha 有直接证据，`1` 表示需要重大新增边界或无法审计。它是决策辅助，不是供应商质量排名；任何商业/托管候选仍须先满足非开源准入合同。

| 候选 | 页面匹配 | 控制/退出 | 无障碍证据 | 运行时成本 | 数据/供应商风险 | 当前层级 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| shadcn source + Sueño-owned primitives | 5 | 5 | 4 | 5 | 5 | `adopt`：基础层 |
| Native HTML/CSS/Web Streams/Media APIs | 5 | 5 | 5 | 5 | 5 | `adopt`：默认回退 |
| Radix / Base UI / React Aria / Headless / Ariakit / Zag | 3 | 3 | 4 | 3 | 4 | `trial`：单组件替代，不并行 |
| Transitions.dev patterns | 4 | 5 | 4 | 5 | 5 | `adopt`：模式与 token 参考 |
| beUI / Rare UI single-file recipes | 4 | 4 | 3 | 3 | 4 | `trial`：逐文件复制 |
| Motion / GSAP | 2 | 3 | 4 | 2 | 4 | `trial`：仅有 spring/gesture 证据时 |
| Floating UI | 3 | 4 | 4 | 4 | 5 | `trial`：复杂定位触发时 |
| TanStack Virtual | 2 | 4 | 3 | 4 | 5 | `trial`：列表/内存阈值触发时 |
| Media Session / WebVTT / PiP | 4 | 5 | 3 | 5 | 5 | `adopt`：渐进增强、浏览器能力检测 |
| Serwist / Workbox | 2 | 3 | 3 | 2 | 2 | `reference-only`：另立离线 ADR |
| assistant-ui / AI SDK UI | 2 | 2 | 3 | 2 | 2 | `reference-only`：不替换 conversation contract |
| Sentry / LogRocket / FullStory / Percy / Chromatic / BrowserStack | 2 | 1 | 2 | 1 | 1 | `reference-only`：需 DPA、脱敏、费用与退出证据 |
| MUI X / Kendo / Syncfusion 等商业组件 | 1 | 2 | 3 | 2 | 1 | `reject` for current Alpha；企业后台另评 |

准入结论：当前页面不需要第二套基础 primitives、全量动效 runtime、虚拟列表、离线写入或托管观测。后续若某一页满足触发条件，只能按“单组件、隔离 fixture、生产 build、可回滚”路径升级，不能因为 registry 示例好看就批量复制。

### 3.7 J 交互复测（优化前 partial 与优化后 fixture 证据）

优化前目录 `D:\temp\sueno-ui-system-001\UI-SYSTEM-001J-current\` 来自同一工作树、独立端口 `3140`、本机 Chromium fake/fixture，每个页面/viewport 三次样本，共桌面 9/9、移动 9/9 测试通过。Explore 桌面三次动作均低于 200ms；移动 Explore 打开为 244.4–255.6ms，移动 Learn 打开为 246.3–249.2ms，另有一次桌面 Learn 为 247.9ms，因此该基线为 `partial`。`UI-SYSTEM-001J-after` 保留为 provenance 不完整的历史对照。最新权威目录 `D:\temp\sueno-ui-system-001\UI-SYSTEM-001J-final\` 使用完整 `before.txt`、预热后的隔离 dev server 和批次名 provenance；18 个 artifact 中 14 个 `pass`、4 个 `partial`，最大 action latency 262.7ms、Event Timing p75 最大 104ms、最大长任务 100ms、CLS 0。因此 J 总体保持 `partial`，不能单独作为生产门禁。

这组 action latency 是“用户可见结果完成”的诊断指标，不等同浏览器 INP；它包含 fixture/React 状态完成等待。J-current 与 J-after 的两代证据必须分开引用，不能把优化后 fixture 数值写成生产或真机结论。生产 build 不能使用开发专用 `spanish-e2e-user` 身份，故生产预览只验证匿名页或经人工批准的隔离认证；真实 iPhone Safari、部署/CDN、Lighthouse 和长运行内存继续为 `not_run`。

## 4. 设计系统边界

### 4.1 采用的层级

```text
Sueño tokens + CSS layers
        ↓
shadcn copied components (local source)
        ↓
Radix behavior / Floating UI positioning patterns (only where needed)
        ↓
beUI/Rare single-file interaction recipes
        ↓
Sueño feature components and server-owned DTO/state machines
```

组件分层规则：

- `src/shared/ui` 只放无业务语义的基础行为和视觉 primitive；不把 conversation、media、evidence 规则塞进去。
- `src/modules/*/ui` 组合 shared primitives，负责 feature-specific labels、loading/error/empty state 和服务端 DTO 映射。
- Route Handler、application、domain 和 repository 不依赖 UI registry；客户端不得写评分、画像、记忆或发布事实。
- 复制 registry 文件后立即改为本地命名、token 和测试；不要在页面中直接引用远端 registry URL。

### 4.2 动效 token

以 CSS variables 为唯一可检查合同，推荐初始值：

```css
:root {
  --motion-duration-instant: 100ms;
  --motion-duration-fast: 160ms;
  --motion-duration-standard: 220ms;
  --motion-duration-slow: 320ms;
  --motion-ease-enter: cubic-bezier(0.16, 1, 0.3, 1);
  --motion-ease-exit: cubic-bezier(0.7, 0, 0.84, 0);
  --motion-ease-linear: linear;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-duration-fast: 1ms;
    --motion-duration-standard: 1ms;
    --motion-duration-slow: 1ms;
  }
}
```

约束：只动画 opacity/transform、颜色和可中断的视觉状态；不能依赖 animation end 事件写入业务事实；退出通常短于进入；不让动画阻塞输入；复杂 spring 只在高价值交互中使用 Motion/beUI。

### 4.3 无障碍合同

- 使用原生 button/link/input 优先；icon-only 控件必须有可访问名称，装饰图标 `aria-hidden`。
- Dialog/Sheet/Popover 必须有焦点进入、Escape、关闭后恢复触发点、遮罩和滚动锁定策略。
- Tabs/Select/Command 保持键盘箭头/Enter/Escape 行为和 selected/expanded 状态；不要只做视觉 tab。
- status 使用一个 `aria-live="polite"`，错误使用 `role="alert"`；Toast 不抢焦点。
- 当前/完成/锁定不能只靠颜色；正文对比度目标至少 4.5:1，非文本边界至少 3:1。
- `prefers-reduced-motion` 下保留内容顺序、焦点和可操作性；不以动画结束作为提交成功条件。

## 5. 页面/组件组合方案

| 页面 | P0 结构 | P1 组件与动效 | 明确不做 |
| --- | --- | --- | --- |
| 学习 `/learn` | `MediaLibraryToolbar`、媒体卡、骨架、空/失败/重试 | Skeleton、Tooltip、Popover/Select；卡片只做 160ms hover，加载用 cross-fade | Hero、开始/继续学习 CTA、自动 carousel |
| 媒体详情 | 播放器、字幕、词级跟随、lexical drawer | Sheet/Popover、ScrollArea、Tooltip；当前词只做 opacity/border 状态 | 重写播放器、实时纠错、把词级动画当评分 |
| 探索 `/explore` | 搜索→视图切换→列表/详情 rail 的单一决策层 | Tabs、Command、Popover、Sheet；Rare Scroll Progress/Step Player 仅用于真实练习进度 | 大量 bento 卡、全屏动效背景、伪按钮统计 |
| 阅读 `/read` | 搜索/排序/筛选/添加菜单收敛为 Popover/Select/Command；文章行整体进入 | Tooltip、Sheet、Skeleton、ScrollArea；阅读进度使用 CSS/Rare recipe | 复制全文、无限嵌套卡片、常驻解释器遮挡正文 |
| 文章阅读器 | 正文主表面、词语解释、保存、朗读工具栏 | Popover/Sheet、Floating UI 定位、Transitions text swap | 把阅读/打字记作口语证据 |
| 对话 `/chat` | message scroller、composer、联系人 rail、错误/重试 | beUI Message/Prompt/Toast/Drawer 逐个复制；Transitions text swap/error；Motion 仅 typing/interruptible layout | assistant-ui runtime 替换现有 parser/状态机、reasoning 伪造、自动纠错 |
| 我的 `/me` | 紧凑 capability rows、privacy/data controls、真实空/错误状态 | Tabs、Accordion、AlertDialog、Toast | 空数据渲染伪按钮、雷达图和热力图占位 |
| 内容工作流 | 审核维度、revision、权利/结构/发布门禁 | AlertDialog、Popover、Skeleton、Toast | 动效掩盖发布门禁、客户端决定 publishable |
| 公共 `/` | server shell + journey island + responsive media | transition token、reduced-motion、图片尺寸稳定 | 把公开页伪交互当真实学习状态；整页 client 化 |

### 5.1 页面级组件契约

以下契约是后续夜间批次的拆分边界。`shared` 组件只接收视觉/交互状态；页面组合层才接收业务 DTO，服务端事实仍由 route/application/domain 负责。

| 路由 | Server 责任 | Client island / shared primitive | 必须保留的状态与边界 | 首批验收证据 |
| --- | --- | --- | --- | --- |
| `/learn` | 服务端读取媒体 DTO、首屏 18 项和可用性原因 | `MediaLibraryToolbar` + `Popover/Select/Skeleton/Tooltip` | 打开即资料库；无 Hero、开始/继续学习 CTA；加载更多去重、失败可重试 | fake 成功/空/失败 + 375/1024/1440 无横向溢出 |
| `/learn/media/[stableKey]` | 读取不可变媒体版本、字幕、词级时间线 | `Sheet/Popover/ScrollArea/Tooltip` | 播放器时钟、字幕跟随、词语解释不写评分；技术失败不扣能力 | 播放/暂停、字幕跟随、drawer Escape/焦点恢复 |
| `/explore` | 读取场景目录、真实进度和权限 | `Tabs/Command/Popover/Sheet`；Step Player 仅按门禁启用 | 统计是展示而非按钮；场景进入为唯一主要结果 | 搜索→筛选→进入；锁定/空/错误态可恢复 |
| `/read` 与文章路由 | 读取文章、来源、保存/进度 DTO | `Popover/Select/Sheet/ScrollArea/Skeleton` | 词句与阅读不成为口语证据；解释层不遮挡正文 | 搜索、排序、保存、词语解释、返回焦点 |
| `/chat` | 读取会话/角色/权限；启动流式请求 | `MessageScroller/PromptBar/Drawer/Toast`（按需复制） | `generationId`、显式 `done`、取消、断流重试、记忆隔离不变 | 无 done 不显示完成；旧 generation 不更新当前线程 |
| `/me` | 服务端返回能力、隐私和可用性事实 | `Tabs/AlertDialog/Toast` | 空数据不渲染伪按钮；删除/共享仍需服务端权限与确认 | 真实错误/空态、删除确认、toast 不抢焦点 |
| `/me/content-workflow` | 审核维度、revision、权利与 publishable 由服务端决定 | `AlertDialog/Popover/Skeleton/Toast` | 客户端不能把候选变成已发布；失败不可显示成功 | 审核→确认→服务端结果→可恢复错误 |
| 匿名 `/` | 静态文案、链接、脱敏产品媒体 | `PublicHomeJourney`、`PublicHomeMotion` | 公开交互仅是展示；首屏露出下一段；图片单源 | 200、无 overlay/溢出、reduced-motion、单媒体请求 |

页面组件统一遵循 `loading → ready/empty → error/unavailable → retry` 的显式状态模型。任何状态若没有真实动作或服务端结果，不得用 button、进度动画或“完成”标签伪装。

## 6. 引入门禁与依赖策略

### P0（必须先完成）

- 建立 `components.json` 或等价本地 registry 记录，并添加许可证/来源清单。
- 建立 token/layer、focus ring、reduced-motion 和 `data-state` 约定；不先安装 beUI/Rare 全集。
- 复制并测试最小基础 primitives：Skeleton、Tooltip、Popover、Tabs、Sheet、AlertDialog；每个组件都要有组件测试和键盘 E2E。优先本地源码，只有定位/焦点合同无法满足时才引入对应 runtime。
- 修复 MediaLibrary observer/scroll 生命周期；保持现有 API 和空/失败态。
- 公共页拆分 server/static 与 client island，避免改变公开页文案和登录后不变量。

### P1（核心工作流稳定后）

- 对话：MessageScroller、PromptBar、Toast、Drawer；每项都保留 `generationId`、显式 `done` 和取消/重试。
- 阅读：筛选/解释浮层和进度；使用 Floating UI 仅解决定位，不复制全套交互。
- 探索/学习：Step Player/Scroll Progress 仅在真实目标/进度存在时引入。
- 用 bundle analyzer 或构建产物记录 Motion、Floating UI、registry 复制代码的成本；超过预算则回退 CSS/原生实现。

### P2（有真实证据才做）

- TanStack Virtual：当任一长列表稳定超过 100 行，或真实设备 INP/内存超过门槛时。
- Vaul：移动 Sheet 有明确拖拽需求并完成 iPhone Safari 真机验收时。
- Embla：只有产品出现需要 carousel 的真实内容结构时。
- assistant-ui/AI SDK UI：只有现有 conversation contract 明确要共享多 runtime，且补 ADR 后才评估。

### 6.1 候选引入决策矩阵

| 候选 | 现在的决定 | 只有满足以下条件才升级 | 退出/回退 |
| --- | --- | --- | --- |
| shadcn/ui source distribution | 采用；组件源码归 Sueño 所有 | 每个复制文件记录 URL、commit/version、许可证和本地测试 | 删除组合引用，保留 native control |
| Radix / Base UI / Headless UI / React Aria | 不并行引入；行为参考或单组件替代 | 本地 primitive 无法通过焦点/键盘/ARIA，且只选一套 | 回到已审计本地实现，不能混装两个基础运行时 |
| Transitions.dev | 采用模式/token，不引入 runtime | 需要的模式能由 scoped CSS 表达且有 reduced-motion | 删除装饰动画，不影响业务事实 |
| beUI / Rare UI | P1 按单文件复制 | 真实页面有对应高价值工作流，并通过键盘、性能、许可证门禁 | 换成本地组合，保留现有状态机 |
| Beautiful UI / assistant-ui / AI SDK UI | 只参考信息架构/流协议 | 另有 ADR 证明要共享 runtime，且不替换 Sueño conversation contract | 不引入，继续使用现有 parser/application |
| Floating UI | P1 定位候选 | 词语解释/消息菜单在真实 viewport 边界下需要自动定位 | 简化为 Popover/native control |
| Sonner / Vaul / Motion | 条件评估 | 单一通知出口、移动拖拽或可中断 spring 有真实需求 | 保留现有 Toast/Sheet/CSS |
| TanStack Virtual | P2 性能候选 | 稳定 >100 行或真实设备 INP/内存超过门槛 | 保持分页与滚动语义，不为预想规模提前复杂化 |
| Embla / WebGL / 全局 blur | 拒绝当前范围 | 出现明确 carousel/3D 任务且另立规格 | 不以装饰价值增加首屏成本 |

### 6.2 供应链与复制清单合同

任何新 runtime 依赖或复制文件在进入页面前必须有一条清单记录。清单可以位于批次 `handoff.md`，也可以在未来建立 `docs/ui-sources.json`，但字段必须保持一致：

```json
{
  "name": "example-component",
  "kind": "copied-source|runtime-dependency|platform-api|reference-only",
  "sourceUrl": "https://…",
  "sourceCommitOrVersion": "commit-or-semver",
  "license": "MIT",
  "spdx": "MIT",
  "files": ["src/shared/ui/primitives/example.tsx"],
  "transitiveDependencies": [],
  "reactNextTailwindMatrix": "React 19 / Next 16 / Tailwind 4 verified",
  "securityReview": "pnpm audit / advisory lookup date",
  "bundleEvidence": "artifact path or not measured",
  "owner": "UI-SYSTEM-001",
  "rollback": "remove page composition and restore local/native implementation"
}
```

锁文件变更必须由人工逐行审阅；默认使用仓库现有 pnpm registry 和 lockfile，不在夜间任务切换镜像或升级无关包。`pnpm audit`、许可证/SBOM 扫描可作为夜间只读门禁，但发现与本任务无关的已有 advisory 时要登记 baseline，不得通过删除依赖或放宽扫描隐藏。复制文件保留上游版权/许可证要求，并记录本地修改差异。

## 7. 失败边界

- Registry 下载失败：保留已复制源码和 lockfile，不在夜间任务中重试无限次；记录 URL、commit/version 和缺失组件，回退本地 primitive。
- 第三方组件无法满足焦点/键盘/性能：不强行修到“看起来能用”；删除其组合层引用，改用本地 CSS/native control，并记录差异。
- Next.js/React 新版本 API 不确定：先阅读 `node_modules/next/dist/docs/` 对应 guide，再写代码；不以旧训练知识推断。
- 真实数据库、Provider、部署或 iPhone Safari 不可用：夜间任务只运行 fake/fixture/本地浏览器门禁，明确标记未验证项。

## 8. 关联文档

- [ADR-0010：Sueño UI 组合层与动效边界](../../adr/0010-sueño-ui-composition-and-motion.md)
- [页面/组件契约与状态矩阵](2026-09-21-sueño-ui-component-contracts-and-state-matrix.md)
- [电脑端 Web 界面密度与操作层级收敛设计](2026-09-12-desktop-web-interface-density-and-action-hierarchy-design.md)
- [学习页桌面 Web 设计](2026-08-28-learning-page-desktop-web-design.md)
- [公开产品页视觉重设计规格](2026-09-20-public-home-visual-redesign-design.md)
- [UI-SYSTEM-001 夜间实施计划](../../plans/2026-09-21-sueño-ui-composition-and-motion-overnight-implementation-plan.md)
