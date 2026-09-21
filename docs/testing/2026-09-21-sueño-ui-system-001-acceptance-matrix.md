# UI-SYSTEM-001 验收矩阵

- 日期：2026-09-21
- 任务：[UI-SYSTEM-001](../tasks/UI-SYSTEM-001.md)
- 计划：[夜间实施计划](../plans/2026-09-21-sueño-ui-composition-and-motion-overnight-implementation-plan.md)
- 证据目录：仓库外 `D:\temp\sueno-ui-system-001\<batch>\`

## 1. 证据规则

- `pass` 必须有命令、断言结果和 artifact 路径；没有截图/trace/日志的视觉声明不算通过。
- `not_run` 不是 `pass`，必须写原因、替代证据和下一步环境。
- `partial` 表示可交接但仍有门槛缺口；不能作为完整 `pass`，也不能被夜间 runner 自动升级。
- fake/fixture/Chromium mobile viewport 只能证明实验室行为；不能宣称真实 Supabase、生产部署、iPhone Safari、屏幕阅读器或收费 Provider 通过。
- 视觉截图固定字体、locale、时区、随机数、动画时间（默认 `prefers-reduced-motion: reduce` 或等待稳定）和测试数据顺序。建议像素差异阈值：非文字区域 ≤0.1%，文字/反锯齿区域由人工 review；超过阈值必须写出是预期改动还是回归。
- 商业/闭源/托管候选若进入实现，必须有价格/许可、DPA/数据流、版本/CVE、bundle/SSR、无障碍、删除/导出、退出回退和 owner 证据；缺任一字段只能 `reference-only`，不能计入 `pass`。

## 2. 矩阵维度

### 2.1 视口/主题/输入

| 维度 | 必测值 | 证据要求 |
| --- | --- | --- |
| 宽度 | 320×812、375×812、390×844、430×932、768×900、1024×900、1440×900 | 每批涉及响应式布局至少保存最小手机、平板、桌面三组截图；关键批次跑全组 |
| 主题 | light、dark；支持时 `forced-colors: active` | 对比度/边界不能只在 light 通过 |
| 动效 | 默认、`prefers-reduced-motion: reduce` | 内容顺序、焦点和操作结果相同；只跳过装饰动画 |
| 输入 | 鼠标/触摸、真实键盘 Tab/Shift+Tab/Enter/Space/Escape/Arrow/Home/End | 记录焦点元素、`aria-*`、`data-state` 和 URL/文案变化 |
| 网络 | online、慢网（4G 约束）、离线/请求失败/超时 | 显示明确 loading/empty/error/retry/cancel，不显示假成功 |
| 文本 | 中文长文案、西语长句、长 URL/无数据 | 无横向溢出；正文可换行；重要内容不只靠 tooltip |

### 2.2 路由与状态

| 路由/fixture | 必测动作 | 通过断言 | Artifact/测试 ID |
| --- | --- | --- | --- |
| `/` anonymous | 首屏加载、向下、journey 三按钮、登录链接 | HTTP 200；无框架 overlay；首屏可见 `#how-it-works` 的 heading 或其顶部进入 viewport；每 viewport 只请求对应 picture source；按钮 `aria-pressed` 与 proof 文案同步 | `public-home.*.png`, request log；`public-home.test.tsx`, `ui.public-home.*` |
| `/learn` media success | 搜索、筛选、排序、分页、打开卡片 | 资料库是第一主表面；无 Hero/开始/继续 CTA；分页只追加一次；详情 URL 正确 | `learn-success.*`; `media-library.test.tsx`, `e2e.learn-library` |
| `/learn` empty/unavailable/error | 无数据、配置缺失、503、retry | 原因可读；retry 是真实动作；已有列表不被错误清空 | `learn-empty/error.*`; `media-library.empty/error` |
| media detail | 播放/暂停、句子/词级跟随、词语解释 Sheet、Escape | 当前字幕跟随播放器；上一句恢复；技术失败/低置信度不写能力；Sheet 焦点恢复 | trace + screenshot；`media-word-interactions.test.tsx` |
| `/explore` | 搜索、Tabs/视图切换、进入场景、锁定/空态 | 单一进入结果；统计/锁定不是伪按钮；无真实进度不显示 Step Player | `explore.*`; `e2e.explore.*` |
| `/read` | 搜索、筛选、排序、保存/删除、分页、打开文章 | filter state 可读；文章行可进入；错误可重试；正文来源/版权保留 | `read.*`; `e2e.read.*` |
| article reader | 词语解释、朗读/停止、保存、返回 | 浮层不遮住当前正文/焦点；阅读/打字不写口语证据；停止可中断 | trace + screenshot; `article-reader.*` |
| `/chat` success stream | 发送、token 更新、停止、消息滚动 | token 可见；没有 `done` 不显示完成；停止标记未完成；新消息提示/跟随可切换 | `chat-stream.*`; parser/state-machine tests |
| `/chat` error/old generation | 断流、超时、重试、重复提交、旧 generation 回调 | 错误有邻近 retry；重试不重复写消息；旧 generation 不更新当前线程 | `chat-error.*`; `conversation-generation.*` |
| `/me` | 查看能力/隐私、删除/共享确认、错误重试 | 空数据不产生假按钮；AlertDialog title/description/焦点完整；服务端结果决定成功 | `me.*`; `privacy.*`, `profile.*` |
| content workflow | 审核维度、revision、权利、发布/撤下确认 | 客户端不能制造 publishable；失败保留原因；成功只在服务端返回后显示 | `content-workflow.*`; `content-review.*` |

## 3. 无障碍门禁

- axe/等价自动扫描：新增页面 `critical/serious` 违规为 0；`moderate` 必须有解释和 owner。自动扫描不能替代人工键盘/读屏。
- WCAG 2.2 AA：正文正常文字对比度 ≥4.5:1；大文字 ≥3:1；非文本控制边界/焦点 ≥3:1；颜色不是唯一状态信号。
- 触控目标：主要控件 ≥44×44 CSS px，控件间距 ≥8px；WCAG 2.2 24px 最低门槛视为下限，不替代移动产品目标。
- 200% 浏览器缩放与 text reflow：无水平滚动（明确的代码/媒体轨道除外）；sticky/fixed UI 不遮挡焦点。
- `forced-colors: active`：selected、error、disabled 仍有边框/文字/原生属性差异。
- modal/sheet/popover：打开聚焦、Tab trap、Escape、遮罩策略、关闭恢复、body overflow 恢复；Popover 不把 tooltip 当关键内容。
- live region：页面级 status 只播报完整上下文句；token、计数和 toast 不重复抢读；错误贴近问题且 `role=alert`。
- 若实现依赖商业/闭源/托管候选，需在同一批次 artifact 中提供数据流、供应商条款/版本、CVE/安全核对、bundle/SSR、无障碍和本地降级证据；仅有官网截图或试用账号不算通过。

## 4. 性能门禁

### 4.1 实验条件

使用生产构建：`pnpm build` → 隔离端口 `pnpm start`，Chrome stable，固定字体/locale，4× CPU throttling 和慢 4G（或在无法稳定复现时记录实际 profile）。每个 route 运行至少 5 次，取 p75；首次冷缓存和暖缓存分开记录。保存 Lighthouse/Playwright trace/Web Vitals JSON 到批次 artifact，不把 dev bundle 当预算。

### 4.2 目标

| 指标 | 目标 | 超标动作 |
| --- | --- | --- |
| LCP | p75 ≤2.5s（匿名首页/主工作流首屏） | 检查 server shell、LCP 图像 preload/尺寸、慢边界 |
| FCP | p75 ≤1.8s | 减少阻塞 CSS/字体/第三方脚本 |
| TTFB | p75 ≤800ms（本地 lab 目标；部署另测） | 检查 server fetch waterfall/cache |
| CLS | p75 <0.10 | 固定媒体/skeleton/font 盒子，避免动画改 layout |
| INP | p75 ≤200ms；样本为筛选、打开 popover、发送/停止 | 追踪长任务/重渲染；延迟非关键模块 |
| 长任务 | 首屏无 >200ms 长任务；交互期间单次 ≤200ms | 拆 client island、memo/ref、移除 layout thrash |
| CSS/JS | 记录 gzip/brotli transfer；新增页面 JS 不得高于拆分前生产基线，新增 shared CSS 以批次 JSON 记录增量 | 产物超标时回退第三方 runtime 或拆分 |
| 滚动 | 长列表 fake fixture 下无重复 fetch；帧预算目标 ≥55fps | 稳定 observer/rAF；达到阈值才评估 virtual list |

这些是个人 Alpha 的 lab 门槛，不代替真实设备 p75。真实 iPhone Safari、生产 CDN、Supabase 和 Provider 必须单独记录。

## 5. 失败与基线规则

2026-09-21 最新全量 `pnpm vitest run --reporter=verbose` 已退出 0：220 个文件、950 项全部通过（约 399 秒）。此前 4 项媒体 baseline 已关闭：`podcast-acquisition-publish.test.ts` fixture 执行 `0034_media_word_timings.sql` 补齐 `media_segments.words`；`media-processing-orchestrator.test.ts` 对齐当前 `MEDIA_PROCESSING_MEDIA_TRANSCRIPTION_FAILED` 错误码。全量 lint 仍会扫描 `.tmp-runtime` 生成物并失败；这不是 Vitest baseline。移动 `product-shell` 先前的 6 项入口/确认断言失败已在当前工作树修复并复测为 25/25。首次无 reporter 输出的 `pnpm test --run` 运行已中断，不计入测试结果；后续每次全量运行仍需记录命令、退出码和新增失败；不得删除测试、放宽断言或清理用户/并发代理文件来制造绿色结果。

## 6. 用户验收记录模板

```md
### UI-SYSTEM-001D / /read / 375x812 / light / reduced-motion
- 环境：Chromium <version>；fake fixture <name>；Browser plugin 或 Playwright fallback（原因）
- 流程：打开 → 搜索 → 筛选 → 打开文章 → 解释词语 → 返回
- 结果：pass | fail | not_run
- 断言：<test id / URL / visible text / aria state>
- Artifact：<absolute path to screenshot/trace/log>
- 未验证：真实 iPhone Safari、生产部署、真实 DB（如适用）
- 后续：<owner / next task / rollback ref>
```

## 7. 当前工作树执行记录（2026-09-21）

以下是本轮已实际运行的定向与全量证据；全量结果仍须结合仓库外 manifest/handoff 阅读，不能替代真实设备或部署验收：

| 范围 | 环境/命令 | 结果 | 限制 |
| --- | --- | --- | --- |
| 桌面 product shell | Playwright Chromium fallback，`product-shell.spec.ts --project=desktop-chromium` | `25/25` | Browser plugin 因 `apikey` 认证不可用；不是部署或真实设备证据 |
| 移动 product shell | Playwright Chromium Pixel 7 viewport，独立端口/Next dist | `25/25` | 只能证明实验室 viewport；不是 iPhone Safari |
| 移动核心页面 | conversation、explore、content workflow 定向 E2E | `23/23` | fake/fixture 与隔离 API route |
| 公共首页与阅读 | public home `1/1`；read shelf/article `1/1` | 通过 | 本地 Chromium fallback |
| 本轮 UI 单元回归 | 12 个受影响 Vitest 文件 | `70/70` | fake/fixture；包含 article Popover 9/9 |
| 静态与组件 | `pnpm typecheck`、目标 ESLint、`git diff --check` | 通过（串行当前工作树） | 全量 lint 仍受 `.tmp-runtime` baseline 影响；并行 build/typecheck 曾有 `.next` 竞态，串行 typecheck 已复跑通过 |
| 全量 Vitest | `pnpm vitest run --reporter=verbose`（2026-09-21） | `pass`：220/220 文件，950/950 tests | 4 项媒体 fixture/schema/error-code 历史失败已修复；未访问生产 |
| 全量 E2E | `pnpm test:e2e`（2026-09-21） | `pass`：171/172 passed，1 skipped | 本机 Chromium fallback；视频 fixture 输出已知 `Uncaught Error: 0`，对应断言通过 |
| 生产构建 | `pnpm build`（2026-09-21） | 通过 | 未代表部署或真实环境通过 |
| 全量 lint | `pnpm lint`（2026-09-21） | `baseline-known`：`.tmp-runtime` 生成物触发既有规则错误/警告（约 1,102 errors、9,908 warnings） | 目标文件 ESLint 已通过；不得放宽规则或删除生成物 |

### 7.1 性能批次 H（2026-09-21）

证据目录：`D:\temp\sueno-ui-system-001\UI-SYSTEM-001H\`。

| 检查 | 结果 | 证据/限制 |
| --- | --- | --- |
| 1440×900 HTTP、overflow、CLS、TTFB | `pass` | 隔离 `next start` `performance.json`；5 次冷上下文，HTTP 全为 200，CLS 0，TTFB p75 10.8ms |
| 375×812 HTTP、overflow、CLS、TTFB | `pass` | 隔离 `next start` `performance.json`；5 次冷上下文，HTTP 全为 200，CLS 0，TTFB p75 4.2ms |
| 移动 LCP ≤2.5s | `pass` | 隔离 `next start` p75 1,548ms；仅为本地实验室近似 |
| 桌面 LCP ≤2.5s | `pass` | 隔离 `next start` p75 1,724ms；仅为本地实验室近似 |
| FCP ≤1.8s | `pass` | 隔离 `next start` 桌面 p75 1,724ms、移动 p75 1,548ms；仅为本地实验室近似 |
| INP ≤200ms | `not_run` | 脚本没有执行筛选、Popover、发送/停止等交互，INP=0 不构成证据 |
| CSS/JS transfer、长任务、帧率 | `not_run` | H 脚本未采集，下一批补测 |
| 真实 iPhone Safari、CDN/部署 p75 | `not_run` | 需要部署和真实设备，不由夜间 runner 代验 |

H 批次总体状态：本地生产预览 `pass`。它证明了固定实验室条件下首屏没有布局溢出、CLS 为 0 且 LCP/FCP 预算通过；不证明部署/CDN、真实设备或交互性能预算通过。

## 8. 已执行批次与待人工验收

### 001I：无障碍自动门禁

| 检查 | 目标 | 状态 |
| --- | --- | --- |
| `@axe-core/playwright` 关键路由扫描 | fake/fixture 路由 `critical/serious = 0`；`moderate` 有 owner、解释和回归项 | `pass`：8 条路由 × light/dark 共 16/16 扫描通过，四级 violation 均为 0；每条路由先断言预期 heading，避免空壳假绿。证据：`D:\temp\sueno-ui-system-001\UI-SYSTEM-001I-final\axe-results.json` |
| JSX 静态语义 | `eslint-plugin-jsx-a11y` 对新增 JSX 的误用有可处理结果，不放宽规则 | `not_run`：本批未新增该插件；changed-file ESLint 通过 |
| 人工键盘与焦点 | Tab/Shift+Tab/Enter/Space/Escape/Arrow/Home/End；浮层打开聚焦、关闭恢复、滚动锁定 | `partial`：本批覆盖基础 focus/Tab、reduced-motion 和不可用 `/chat` disabled 语义；读屏、完整键盘矩阵和真实设备未执行 |
| 设备/辅助技术 | VoiceOver/NVDA、`forced-colors`、200% zoom、真实 iPhone Safari/PWA | `partial`：forced-colors Chromium 扫描已记录 serious contrast baseline；VoiceOver/NVDA、200% zoom、iPhone Safari/PWA 未执行 |

自动扫描不得替代人工证据，也不得通过排除路由、忽略规则或改变语义来制造通过。

001I 当前批次交接：`@axe-core/playwright` 使用本地 fake/fixture 与 Chromium fallback；默认 motion、light/dark 主题下 16/16 通过，严格结果为 0 violations。首页 scroll-reveal 的 `.72` opacity 已改为只使用 transform 后复扫通过。该结果仍不替代读屏、完整键盘矩阵、forced-colors、200% zoom、真实 iPhone Safari 或部署验收。完整产物为 `D:\temp\sueno-ui-system-001\UI-SYSTEM-001I-final\axe-results.json`；旧 `UI-SYSTEM-001I` 目录是修复前 baseline，不能作为当前结论。

### 001J：本地交互复测与生产预览待验

| 检查 | 目标 | 状态 |
| --- | --- | --- |
| 代表性交互 INP | 实际执行筛选、Popover、消息发送/停止；p75 ≤200ms | `partial`（总体 J）：J-final 桌面/移动各 9/9 测试通过，但 4/18 artifact 的完成动作超过 200ms，最大 action latency 262.7ms；Event Timing p75 最大 104ms。不等同真实设备 INP |
| 长任务/资源成本 | 首屏无 >200ms 长任务；记录 CSS/JS transfer、资源瀑布和 trace | `partial`（总体 J）：J-final 记录长任务、CLS、paint/navigation 和资源字节，18 个 artifact 的 CLS 均为 0、最大长任务 100ms；dev server 仍非生产，Lighthouse waterfall/帧率/长运行内存仍未采集 |
| Lighthouse/Web Vitals | 生产 build、固定 CPU/网络、冷/暖缓存各 5 次；保存 JSON artifact | `not_run`：001J 使用本地 fake/fixture Event Timing；未运行 Lighthouse，未使用部署/CDN |
| 部署预览 | 重复 H 的匿名首页采样，区分本地 server、CDN、字体和媒体影响 | `not_run`：需要人工批准的部署预览；本地 `next start` 的受保护 J 路由尝试因生产环境明确拒绝 E2E cookie 而回到登录页，未计入交互通过 |
| 观测隐私 | 仅允许 route/build/metric/value/correlation 等脱敏字段；失败 fail-open，不改变业务事实 | `not_run` |

PWA 后续只允许先做 manifest-only/online-first 文档评估；若未来批准 Serwist/Workbox，必须另立 ADR，限定 app-shell/公开静态缓存，并禁止缓存聊天、证据、画像、记忆、录音、签名 URL 或离线评分写入。

J-current 与 J-after 两代历史证据均保留：`D:\temp\sueno-ui-system-001\UI-SYSTEM-001J-current\` 是优化前 `partial` 基线，`D:\temp\sueno-ui-system-001\UI-SYSTEM-001J-after\` 是优化后的本地 fixture `pass`。J-after 的 provenance 缺口不能被忽略。最新可追溯批次为 `D:\temp\sueno-ui-system-001\UI-SYSTEM-001J-final\`：`acceptance.json`、`manifest.json`、`handoff.md`、`commands.txt`、`before.txt` 和 18 个 `interaction-*.json` 均使用 `UI-SYSTEM-001J-final`，并记录了完整输入快照；14 个 artifact 为 `pass`、4 个为 `partial`。因此总体 J 仍为 `partial`，任何一代结果都不得升级为真实设备或生产性能通过。

### 001J-final：provenance 完整的本地交互复测

| 检查 | 结果 |
| --- | --- |
| 服务器与输入 | 预热后的隔离 Next dev server `127.0.0.1:3144`；`before.txt` 记录分支、HEAD、最近提交和 worktree；未访问生产 |
| 测试覆盖 | `/learn` 筛选、`/explore` 筛选、`/chat/lucia` 发送/停止；桌面 9/9、移动 9/9，三次样本/路由 |
| 交互预算 | 14/18 pass、4/18 partial；最大 action 262.7ms，超过 200ms 门槛的动作如实保留 |
| 其他指标 | Event Timing p75 最大 104ms；最大长任务 100ms；18/18 CLS 为 0 |
| 限制 | dev server fixture；真实 iPhone Safari、部署/CDN、Lighthouse、真实 Provider、帧率和长运行内存未执行 |

权威 artifact：`D:\temp\sueno-ui-system-001\UI-SYSTEM-001J-final\acceptance.json`、`manifest.json`、`handoff.md`、`commands.txt`、`before.txt`。

本轮 primitive 审计补充（2026-09-21）：`tests/unit/ui-primitives.test.tsx` `7/7`；Popover 外点点击会阻止默认焦点转移并恢复 trigger；两个同时打开的 Sheet 在最后一个关闭前持续保持 `body` 滚动锁；`prefers-reduced-motion` 的 primitive CSS 规则保留无动画/无过渡回退（`app/globals.css:12853`）。这些是 jsdom/静态证据，真实浏览器读屏、forced-colors 和真实 iPhone Safari 仍为 `not_run`。

回滚后最终 UI 严格复测（2026-09-21）：`tests/e2e/ui-system-001i-accessibility.spec.ts` 在桌面/移动 Chromium 共 8/8 通过；修复移动 `/me` 实际导航入口、浅色 muted 对比度、暗色学习当前导航对比度，以及 `/read` 禁用分页箭头的 `aria-label` 语义。证据目录：`D:\temp\sueno-ui-system-001\UI-SYSTEM-001I-after-rollback-strict-final-2`。这仍不替代 VoiceOver/NVDA、真实 iPhone Safari、200% zoom 或部署验收。

本轮移动隐私用例曾因测试使用 `force: true` 将按钮滚入固定底部导航覆盖区而失败；已改为居中滚动并复跑通过。该修复属于测试坐标/焦点证据，不改变业务删除逻辑。真实 iPhone Safari、屏幕阅读器、生产部署、生产数据库和收费 Provider 仍为 `not_run`。全量 E2E 的 alpha-flow 画像断言已对齐当前真实空态（`0 / 8`、无能力轴列表），断流用例使用“可用但空历史”fixture，未放宽历史不可用时的禁用发送契约。
