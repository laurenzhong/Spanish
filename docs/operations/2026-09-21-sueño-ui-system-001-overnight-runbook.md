# UI-SYSTEM-001 夜间无人值守运行手册

- 任务：`UI-SYSTEM-001`
- 适用：本地隔离 worktree、fake/fixture、静态检查、组件测试、Playwright fallback、生产 build
- 禁止：生产数据库、真实学习进度、采集/发布/撤下、收费 Provider、真实录音/转写、数据清理
- 详细断言：[验收矩阵](../testing/2026-09-21-sueño-ui-system-001-acceptance-matrix.md)

当前状态：`UI-SYSTEM-001A–F` 已在当前工作树实施，`001G` 的全量 Vitest、全量 E2E、生产 build、串行 typecheck 和仓库外 artifacts 已完成；`001H` 本地生产预览性能门禁已通过；`001I` 已完成可信 light/dark axe 自动扫描（16/16、四级 violation 均为 0）。最新 `001J-final` 已补齐本地 fixture 的 `before.txt`、batch provenance 和独立运行记录，桌面/移动共 9/9，18 个 artifact 中 14 个 `pass`、4 个 `partial`，最大 action latency 262.7ms，因此 J 总体仍为 `partial`。历史 `001J-current`/`001J-after` 仅保留为对照。全量 lint 仍为 `.tmp-runtime` 生成物 baseline-known；部署、真实设备和真实 Provider 仍未验证。实验室 E2E 使用本机 Chromium fallback，桌面/移动共 `171 passed、1 skipped`；这不是提交、部署、真实 iPhone Safari 或真实 Provider 的结论。每批仍须按本手册重新生成 `before.txt`、`commands.txt`、`acceptance.json` 和 `manifest.json`，不能仅引用聊天摘要。

## 1. 固定运行环境

| 项目 | 要求 |
| --- | --- |
| OS/时区 | Windows 工作区；任务日志使用 `Asia/Shanghai`，同时记录 UTC 时间戳 |
| Node/pnpm | Node 24.x、pnpm 11.x，版本以 `.nvmrc`/`package.json` 为准 |
| 安装 | `pnpm install --frozen-lockfile`；不升级无关依赖，不切换 registry |
| 浏览器 | 优先 Browser plugin；不可用时使用本机 Chromium Playwright fallback，并注明原因 |
| locale/font | 固定 `zh-CN`、`Asia/Shanghai`、仓库测试字体/系统 fallback；截图前等待 `document.fonts.ready` |
| 数据 | fake provider、fixture、隔离测试 DB；禁止读取生产 `.env` 或连接非本地 DB |
| 网络 | 默认拒绝外部请求；允许 localhost、静态测试 fixture 和显式批准的文档/元数据读取；Playwright route 拦截未知 host |
| 进程 | 每批使用独立端口；结束前检查并终止本批创建的 dev/start/Playwright 进程，不触碰不属于本批的进程 |

## 2. 开始前锁定与安全检查

1. 保存 `git status --short --branch`、`git rev-parse HEAD`、`git log -5 --oneline --decorate` 和 `git worktree list` 到 `before.txt`。
2. 记录批次输入 commit、负责人、目标文件 glob、前置批次和回滚 ref。当前工作树有用户/并发 dirty 时，只能在明确归属的文件写入；无法归属就暂停。
3. 检查 `.env*`、token、签名 URL、录音和生产数据是否进入待提交文件或日志；执行 `git diff --check` 和密钥扫描。
4. 建立互斥锁，例如仓库外 `D:\temp\sueno-ui-system-001\run.lock`。已有锁且 owner 仍运行时，不启动第二个 runner；异常退出由人工确认后移除。
5. 只在仓库外创建 artifact 目录：`D:\temp\sueno-ui-system-001\<batch>\`。不得把截图、trace、临时脚本或日志写入仓库。

## 3. 批次执行协议

每批最大 90 分钟；单命令默认 10 分钟，`pnpm build`/`pnpm test:e2e` 最多 20 分钟。超时只允许对同一个幂等命令重试一次，间隔 10 秒；网络、浏览器启动和文件锁类瞬态可以重试，断言/类型/构建失败不得盲目重试。

建议顺序：

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm exec eslint <changed-files> --max-warnings=0
pnpm vitest run <target-tests>
pnpm exec playwright test <target-project-or-test> --reporter=line
pnpm build
git diff --check
```

全量 `pnpm lint`、`pnpm test --run`、`pnpm test:e2e` 只在 `001G` 或明确诊断批次运行。每条命令都写入 `commands.txt`，保留 stdout/stderr、退出码、耗时和重试次数。Playwright 必须保存失败 screenshot/trace；成功批次至少保存桌面/移动截图和 `acceptance.json`。

## 4. 网络与数据隔离

- 测试环境变量显式使用 `AUTH_E2E_ENABLED=1`、fake repository/provider 和本地测试端口；不得从生产 `.env` 推导连接。
- Playwright 的 `context.route('**/*')` 默认 abort 未列入 allowlist 的 host；页面若需要模拟 API，使用 fixture response，不调用真实 Supabase、MiniMax、OpenAI、YouTube、RSS 或 Bunny。
- 日志 redaction：匹配 email、JWT、`Bearer`、`service_role`、API key、签名 query、原始对话/录音内容后替换为 `[REDACTED]`。失败截图不能包含真实用户数据。
- 不运行 `db:migrate`、content acquire/import/publish、媒体下载/转写、删除/匿名化、真实设备录音或收费 API。
- 商业/闭源/托管 UI、分析 SDK 和云端聊天服务保持 `reference-only`；夜间任务不注册试用、不发送遥测、不上传 DOM/消息/录音。若未来采用，必须先完成价格/许可、DPA/数据流、CVE、bundle/SSR/无障碍、删除/导出和退出回退记录，并由人工批准。

## 5. 失败分类与停止规则

| 分类 | 例子 | 动作 |
| --- | --- | --- |
| 目标代码断言失败 | 组件测试、ARIA、状态机、页面交互 | 批次 `blocked`；保存 trace/log；不自动改断言或继续依赖批次 |
| 类型/lint/build | 新文件类型错误、目标 lint、生产构建失败 | 批次 `blocked`；允许执行独立文档静态检查 |
| 已知 baseline | 预登记的媒体 fixture 4 失败、`.tmp-runtime` lint | 标记 `baseline-known`，确认无新增/扩散；写 owner 和解除条件 |
| Browser/Chromium 不可用 | plugin auth、浏览器启动、字体缺失 | 可执行静态/单测；若计划要求视觉证据则 `not_run`，不能冒充通过 |
| 外部网络/Provider | 非 allowlist 请求、收费服务需要凭据 | 立即停止该命令；不得放宽 allowlist 或重试 |
| dirty/并发冲突 | 目标文件有未知修改、其他 runner 持锁 | 停止写入并回交；不 reset/clean/checkout |
| 进程/磁盘异常 | orphan server、磁盘不足、端口占用 | 只清理本批创建且已记录的进程/临时目录；无法确认目标时交人工 |

相同阻塞条件连续三次失败才可在任务状态中标记 `blocked`；单批失败不允许伪装为完成，也不自动扩大范围修复其他模块。

### 5.1 最近一次全量质量门禁记录

- `pnpm vitest run --reporter=verbose`：退出码 0；220 个文件、950 项全部通过，耗时约 399 秒。此前 4 项媒体 baseline 已修复：podcast PGlite fixture 现在执行 `0034_media_word_timings.sql`，media-processing 测试断言当前稳定的 `MEDIA_PROCESSING_MEDIA_TRANSCRIPTION_FAILED` 错误码。未发现 UI 目标文件新增失败。首次无 reporter 输出的 `pnpm test --run` 运行已按运行手册中断，不能作为通过或失败测试计数。
- `pnpm lint`：退出码 1；ESLint 扫描 `.tmp-runtime` 生成物并产生既有规则错误/警告，目标文件单独 lint 通过。不得用删除生成物、放宽规则或修改无关源码来制造通过。
- `pnpm build`：退出码 0；Next.js 16.3.1 生产构建与 TypeScript 检查通过。该结果只证明本地构建，不证明部署、真实数据库或真实 Provider。
- `pnpm test:e2e`：退出码 0；172 项中 `171 passed、1 skipped`，桌面与移动 Chromium fallback 均覆盖。视频 fixture 页面仍输出已知浏览器日志 `Uncaught Error: 0`，对应断言通过；Browser plugin 因 `apikey` 认证不可用。

### 5.2 UI-SYSTEM-001H 性能基线记录

- 条件：`pnpm build` 后隔离 `next start`、`127.0.0.1:3119`、Chrome、4× CPU throttling、慢 4G 近似、`zh-CN`/`Asia/Shanghai`、每视口 5 次冷上下文。
- 通过：两视口 HTTP 200、`scrollWidth === clientWidth`、CLS 0；桌面 TTFB p75 10.8ms、移动 4.2ms；桌面 LCP/FCP p75 1,724ms、移动 LCP/FCP p75 1,548ms，满足本地 LCP/FCP 预算。
- `not_run`：未执行交互时 INP=0，不能当作 INP 通过；传输大小、帧率、长运行内存、真实 iPhone Safari、部署/CDN 仍未验证。
- `not_run`：传输大小、长任务、帧率、真实 iPhone Safari、部署/CDN。详见 `D:\temp\sueno-ui-system-001\UI-SYSTEM-001H\acceptance.json` 和 `handoff.md`。

## 5.3 无人值守批次边界与当前结果

### 001I：无障碍自动门禁（已执行）

- 允许在隔离测试环境评估 `@axe-core/playwright`（MPL-2.0，测试专用）和 `eslint-plugin-jsx-a11y`（MIT）；未获得人工批准和锁定版本前不得修改 `package.json` 或 lockfile。
- 扫描关键 fake/fixture 路由，`critical/serious = 0`；`moderate` 建立 owner/截止批次台账。axe 不能替代键盘、读屏、forced-colors、200% zoom 或 iPhone Safari。
- 失败即 `blocked`；不得通过忽略规则、减少路由或把 `not_run` 改成 `pass`。
- 当前权威结果：`tests/e2e/ui-system-accessibility.spec.ts` 在隔离端口完成 8 条路由的 light/dark 共 16/16 扫描，均有 heading 身份断言，`critical/serious/moderate/minor` 均为 0。Artifact：`D:\temp\sueno-ui-system-001\UI-SYSTEM-001I-final\axe-results.json`。这不替代读屏、完整键盘、forced-colors、200% zoom、真实 iPhone Safari 或部署验收。

### 001J：交互性能与预览复测

- 只在生产 build、隔离端口或人工批准的预览环境运行。交互脚本必须实际执行筛选、Popover 开关、消息发送/停止，并保存 trace 与 Web Vitals；INP=0 且无交互时只能是 `not_run`。
- 当前本地 fixture 入口：`pnpm exec playwright test tests/e2e/ui-system-001j-interaction-performance.spec.ts --project=desktop-chromium --reporter=line` 与 `--project=mobile-chromium`。它使用 fake/fixture 路由，采集 action latency、Event Timing（若浏览器支持）、long task、CLS、navigation/paint 和资源字节。`UI-SYSTEM-001J-current\` 与 `UI-SYSTEM-001J-after\` 保留历史对照；最新权威批次为 `UI-SYSTEM-001J-final\`，桌面/移动各 9/9，18 个 artifact 中 14 个 `pass`、4 个 `partial`，最大 action latency 262.7ms、Event Timing p75 104ms、最大长任务 100ms、CLS 0。J-final 使用完整 `before.txt` 和批次名 provenance，但仍是 dev server 本地 fixture，不能作为生产或真实设备性能结论。
- 生产构建复测可先独立运行 `pnpm build`，再以 `NEXT_DIST_DIR=<同一构建目录> pnpm exec next start --hostname 127.0.0.1 --port <独立端口>` 启动服务，并设置 `SUENO_UI_SKIP_WEBSERVER=1` 让 Playwright 使用外部服务器。该开关只改变测试服务器编排，默认不启用；生产 `NODE_ENV` 会故意拒绝 `spanish-e2e-user` 测试身份，因此只有匿名页面或人工批准的隔离测试认证可进入生产预览 J，不能把失败的测试 cookie 当作真实登录证据。
- Lighthouse CI/`web-vitals` 只作为可选测试/诊断工具；字段只允许 route template、metric、value、navigation type、build/correlation ID，不记录消息、录音、DOM、邮箱或完整 URL/query。
- 预览/真实设备验收需要人工批准；不得用 BrowserStack、Percy、Chromatic、Sentry、LogRocket 或 FullStory 的免费试用替代本地证据，也不得在夜间上传私密页面。

## 6. 批次 manifest 与回滚

每批结束生成 `manifest.json`：

```json
{
  "task": "UI-SYSTEM-001",
  "batch": "UI-SYSTEM-001C",
  "inputHead": "<sha>",
  "outputHead": "<sha-or-uncommitted>",
  "owner": "Codex",
  "files": ["app/public-home-experience.tsx", "src/modules/media/ui/media-library.tsx"],
  "status": "pass|blocked|baseline-known|not_run",
  "commands": ["pnpm typecheck", "pnpm vitest run …"],
  "artifacts": ["D:\\temp\\sueno-ui-system-001\\UI-SYSTEM-001C\\acceptance.json"],
  "rollbackRef": "<last-known-good-sha>",
  "rollbackCommand": "git revert <batch-commit> (人工确认后执行)",
  "unverified": ["real iPhone Safari", "production deployment"]
}
```

没有 commit 时写 `outputHead: uncommitted`，并在交接中逐文件列出所有权；不得把另一个分支的 SHA 当成当前完成。每批结束更新 `PROJECT_STATUS.md` 的当前核对、测试、限制和下一批；状态页同步由执行者负责，合并者另行对账 main。

## 7. 结束清单

- [x] 目标进程/端口已检查；只清理本批创建的进程和仓库外临时目录。
- [x] `acceptance.json`、截图、日志和 manifest 已脱敏并可复现；本批无失败 trace。
- [x] `git status --short --branch`、`git diff --check` 已重新记录。
- [x] 修改文件、未提交状态、测试退出码、已知 baseline、未执行真实环境和回滚点已写入 handoff。
- [x] 没有生产访问、收费 Provider、采集/发布、真实录音或数据清理发生。
- [x] 001I 自动无障碍批次已运行并生成 `UI-SYSTEM-001I-final\axe-results.json`；当前默认 light/dark 路由门禁通过，人工辅助技术与 forced-colors/zoom 仍未完成。
- [x] 001J-final 本地 fake/fixture 交互性能批次已运行并生成完整 provenance artifact；18 个 artifact 中 14 个 `pass`、4 个 `partial`，J 总体仍为 `partial`，部署预览、Lighthouse、真实 iPhone Safari 和长运行内存仍需人工批准/另批次执行。
