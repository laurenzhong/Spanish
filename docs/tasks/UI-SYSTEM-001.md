# UI-SYSTEM-001：Sueño UI 组合层与动效规范

- 状态：`review`（P0 + D–F 页面切片已在当前工作树实现；G 全量门禁与仓库外 artifacts 已完成；H 本地生产预览性能门禁通过；I 可信 light/dark axe 扫描通过；J-final provenance 完整但本地 fixture 仍为 `partial`，待用户/合并者复核）
- 负责人：Codex
- 研究日期：2026-09-21
- 研究规格：[UI 组合层与动效规范技术调研](../superpowers/specs/2026-09-21-sueño-ui-composition-and-motion-technical-research.md)
- 实施计划：[夜间实施计划](../plans/2026-09-21-sueño-ui-composition-and-motion-overnight-implementation-plan.md)
- 架构决策：[ADR-0010](../adr/0010-sueño-ui-composition-and-motion.md)
- 页面/组件契约：[页面/组件契约与状态矩阵](../superpowers/specs/2026-09-21-sueño-ui-component-contracts-and-state-matrix.md)
- 运行手册：[夜间运行手册](../operations/2026-09-21-sueño-ui-system-001-overnight-runbook.md)
- 验收矩阵：[UI-SYSTEM-001 验收矩阵](../testing/2026-09-21-sueño-ui-system-001-acceptance-matrix.md)

## 目标

建立 Sueño 可控、可审计的基础组件层和统一动效合同，并按学习、探索、阅读、对话、我的、内容工作流和公共页分批降低交互密度与性能风险。

## 范围

- 采用 shadcn/ui source distribution；按需使用 Radix/Floating UI 行为。
- 以 Transitions.dev 模式建立 CSS motion tokens 和 reduced-motion 规则。
- 按需复制 beUI/Rare 的单文件高价值交互。
- 参考 Beautiful UI、assistant-ui、AI SDK UI 的 AI 对话信息架构，不替换 Sueño conversation contract。
- 记录商业/闭源/托管和平台原生候选的准入、数据、商务、性能、退出与回滚条件；当前不引入商业运行时或外部遥测。
- 修复公共页 server/client 边界和 MediaLibrary observer/scroll 生命周期。
- 建立组件、页面、无障碍、性能、夜间执行和交接验收标准。

## 当前实施批次

- `UI-SYSTEM-001A–F` 已在 `codex/public-home-001` 当前工作树实现，尚未形成该任务的独立 commit、合并或部署结论：本地 source-distribution primitives（Popover、Select、Tabs、Sheet、AlertDialog、Tooltip、Skeleton、ScrollArea）、motion/focus/reduced-motion token、媒体 toolbar 接入、MediaLibrary observer/scroll 生命周期修复、公开首页 server shell + journey/motion client islands、`/chat` 消息流/Prompt/移动联系人 Sheet、`/me` Tabs/隐私确认，以及内容工作流的服务端结果确认。Explore/Read 页面级浮层改造已按用户视觉复核撤回，保留原有原生 `details`/`select` 结构。
- 未引入 Radix runtime；`package.json`/lockfile 保持单一本地行为层。公共页媒体使用原生 `picture` 响应式源，避免移动端额外请求桌面截图。
- `001H` 性能证据只在仓库外保存：`pnpm build` + 隔离 `next start` + Chrome 4× CPU/慢 4G 近似，1440×900 和 375×812 各 5 次冷上下文；两视口 HTTP 200、无横向溢出、CLS 0，桌面 LCP/FCP p75 1,724ms、移动 LCP/FCP p75 1,548ms，H 为本地生产预览 `pass`。INP=0 因无实际交互样本，不能算通过；传输大小、长任务、帧率和真实设备未运行。Artifacts：`D:\temp\sueno-ui-system-001\UI-SYSTEM-001H\`。
- `001J` 保留历史对照：优化前 `UI-SYSTEM-001J-current` 为 `partial`（移动 Explore/Learn 约 244–256ms，另有一次桌面 Learn 约 248ms）；`UI-SYSTEM-001J-after` 为 provenance 不完整的历史 fixture `pass`。最新权威批次为 `UI-SYSTEM-001J-final`：桌面/移动各 9/9，18 个 artifact 中 14 个 `pass`、4 个因 action latency 超过 200ms 为 `partial`，最大 action 262.7ms、Event Timing p75 最大 104ms、最大长任务 100ms、CLS 全为 0。J 总体仍为 `partial`，不能升级为生产或真机通过。结果、命令和限制位于 `D:\temp\sueno-ui-system-001\UI-SYSTEM-001J-final\`；Lighthouse、部署预览、真实 iPhone Safari、CDN/字体、帧率和长运行内存仍未执行。
- `001J-final` 已补齐 J 的 provenance 缺口：使用完整 `before.txt`、预热后的隔离 Next dev server 和可注入批次名；桌面/移动各 9/9，18 个 artifact 均标记 `UI-SYSTEM-001J-final`。14 个 artifact 为 `pass`、4 个因 action latency 超过 200ms 为 `partial`，最大 action 262.7ms、Event Timing p75 104ms、最大长任务 100ms、CLS 全为 0。该批次使 J 的本地结论更可追溯，但总体仍为 `partial`，不能升级为生产或真机通过。Artifacts：`D:\temp\sueno-ui-system-001\UI-SYSTEM-001J-final\`。
- `001J` 生产预览尝试已验证当前安全边界：在 `next build` + `next start` 上使用隔离端口运行 J 测试时，`src/shared/auth/server.ts` 的 `testUserFromCookie` 在 `NODE_ENV=production` 明确拒绝 `spanish-e2e-user`，受保护路由正确回到登录页；该尝试未产生有效交互 artifact，也未放宽认证门禁。因此 J 仍为 `partial`，部署/真实账号验收需另行批准。
- `001I` 可信无障碍复核已重跑：在本地 fake/fixture Chromium、默认 motion、light/dark 主题下，8 条路由共 16/16 扫描通过，critical/serious/moderate/minor 均为 0；heading 身份断言确保扫描到真实页面而非空壳。此前启用 `.72` scroll-reveal opacity 时的首页 contrast baseline 已由只使用 transform 的动效修复关闭；本轮视觉 pass 发现并修复公共首页脚注 4.21:1 对比度回归，最新视觉复扫仍为 16/16。权威 artifact：`D:\temp\sueno-ui-system-001\UI-SYSTEM-001I-final-visual-pass\axe-results.json`。该批次仍不等同读屏、完整键盘、forced-colors、200% zoom 或真实 iPhone Safari 通过。
- 组件测试覆盖 Popover 外点/Escape/焦点恢复、Tabs 键盘切换、Sheet/AlertDialog 关闭恢复与遮罩阻断、Tooltip hover；对话、隐私、内容审核和页面状态测试保持 generation/done、权限、revision/hash/publishable 门禁。
- 本轮定向证据：`pnpm typecheck`、目标文件 ESLint、`git diff --check` 通过；桌面 `product-shell` 25/25、移动 `product-shell` 25/25，移动核心 conversation/explore/content workflow 23/23，公开首页 1/1，阅读 shelf/article 1/1。全量 Vitest 使用 `pnpm vitest run --reporter=verbose` 通过；`pnpm lint`、`pnpm build`、`pnpm test:e2e` 已在 2026-09-21 重跑；最新全量 Vitest 220/220 文件、950/950 项通过，媒体 baseline 已关闭；全量 E2E 171/172（1 skip），仓库外 acceptance artifacts 已生成。首次无 reporter 输出的 `pnpm test --run` 运行已中断，不计入通过计数。

## 本轮验证

- 通过：`pnpm typecheck`；目标文件 `pnpm exec eslint ... --max-warnings=0`；`pnpm vitest run tests/unit/public-home.test.tsx tests/unit/ui-primitives.test.tsx tests/unit/media-library.test.tsx`（13 tests）。
- 通过：本地 Playwright fallback（Browser plugin 因 `apikey` 认证不可用）：`/` 1440×900、375×812 HTTP 200、无横向溢出、hero 底部露出 journey、journey button 可操作、两种 viewport 各只请求一个响应式媒体源、无 console/page error。
- 结果补充（2026-09-21 重跑）：`pnpm build`、串行 `pnpm typecheck` 通过；并行 build/typecheck 的一次 `TS6053` 为 `.next` 重建竞态，串行复跑已通过。本轮受影响的 12 个 Vitest 文件为 70/70，通过包含 Explore/Read 原生结构回归的定向单测 18/18。最新全量 `pnpm vitest run --reporter=verbose` 通过：220 个文件、950 项全部通过；此前媒体数据库 fixture/schema 与错误码 4 项 baseline 已修复并关闭。全量 `pnpm test:e2e` 通过：172 项中 171 passed、1 skipped；视频 fixture 仍有已知 `Uncaught Error: 0` 浏览器日志但断言通过。全量 `pnpm lint` 仍会扫描既有 `.tmp-runtime` 生成物并失败（目标文件 lint 已通过）。可信 I 扫描为 16/16、0 axe violations；J-final 本地 fixture 复测为 18/18，14 pass、4 partial，最大 action latency 262.7ms、Event Timing p75 104ms、最大长任务 100ms、CLS 全为 0，因此 J 总体保持 `partial`。真实 iPhone Safari、部署、真实数据库/Provider 仍未执行。
- H 批次证据：`D:\temp\sueno-ui-system-001\UI-SYSTEM-001H\acceptance.json`、`manifest.json`、`handoff.md`、`commands.txt` 和 `before.txt` 已生成；状态为本地生产预览 `pass`，不等同部署/真实设备性能通过。I 当前证据为 `D:\temp\sueno-ui-system-001\UI-SYSTEM-001I-final\axe-results.json`；J-current 与 J-after 保留为历史对照，J-final 是最新完整 provenance 证据但仍为 `partial`。权威 J-final 目录为 `D:\temp\sueno-ui-system-001\UI-SYSTEM-001J-final\`；Lighthouse、部署、真实 iPhone Safari、真实 Provider、读屏、完整键盘、forced-colors、200% zoom、PWA 与长运行内存仍未执行。
- 用户视觉复核后，移除 Explore/Read 新增的页面级 `page-intro` 头部（包括“场景索引”和“阅读书架”），撤掉本轮对应的 Explore/Read scoped visual pass，并恢复原生 `details`/`select` 控件与原有页面结构和样式；保留业务组件和既有可访问性语义。回滚后的 Explore/Read 定向单测为 18/18；此前相关 Explore + product-shell 桌面/移动 E2E 证据为 62/62。
- 回滚后最终 axe 复扫：`D:\temp\sueno-ui-system-001\UI-SYSTEM-001I-after-rollback\axe-results.json`，8 路由 × light/dark 共 16/16，通过且 critical/serious/moderate/minor 均为 0；仅代表本地 fake/fixture Chromium，不替代真机或部署验收。
- 回滚后严格交互无障碍复测：`UI-SYSTEM-001I-after-rollback-strict-final-2` 桌面/移动共 8/8 通过，覆盖键盘焦点、无横向溢出、reduced-motion、forced-colors 和严格 critical/serious axe；期间修复移动 `/me` 账户入口选择器、低对比度 token，以及阅读禁用分页箭头的 ARIA 语义。

## 不在范围

- 不新增支付、实时双向语音、开放角色创建、独立微服务或 Flutter 功能同步。
- 不改变 mastery/confidence、证据、评分、角色真实性、记忆共享、内容审核/发布或 API 语义。
- 不同时引入 Radix、Base UI、Headless UI、React Aria、assistant-ui 等多套基础运行时。
- 不访问生产、不调用收费 Provider、不采集/发布/清理数据，不把 fake 或 Chromium mobile viewport 当成真实 iPhone Safari 验收。

## 当前基线

- 分支基线：`codex/public-home-001`，当前核对 HEAD `df3a9dc`；工作树存在用户/并发 dirty，未覆盖。
- 工作树已有 `PROJECT_STATUS.md`、`app/globals.css`、`app/public-home-experience.tsx` 等用户/并发修改，实施分支必须重新核对，不覆盖。
- 当前本地匿名 `/` 桌面/移动无横向溢出；公开页已拆为 server shell + client islands，媒体使用单一 `picture` 响应式源；全局 CSS 约 12.5k 行/工作树约 475KB；MediaLibrary observer/scroll 生命周期已修复，仍需在 G 批次复核产物预算。

## 交接要求

完成时必须报告：批次/提交、修改文件、许可证和来源、运行命令与结果、未执行检查及原因、真实数据/部署/真机限制、用户验证路径和下一步。实现未领取前，本文件不表示功能已经存在或已部署。
