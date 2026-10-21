# CHAT-ASSIST-003：单输入框翻译交接

2026-10-16，状态 `review`，用户“可以”批准[002三状态方案](CHAT-ASSIST-002.md)。沿用共享分支 `codex/disable-legacy-readlang`，其他任务改动保留。Commit无；未提交、推送或部署。无API、provider、数据库迁移或能力评分变更。

## 完成内容与用户验收

刷新聊天页，直接在原输入框输入中文或中西语混合草稿，点击同一栏内的「译」。西语结果以输入框上方的小预览展示，点「听一遍」可试听；点「使用」后，原输入框替换为可编辑西语并恢复焦点，仍需自行点击发送。只有一个输入框，移除了原「这句怎么说」常驻行、独立中文输入、标题、生成按钮及说明文字；不显示“翻译辅助”标注。

空稿点击「译」只聚焦，不调用供应商；输入文字本身不会自动请求。生成中按钮改为可取消的进度图标，另有屏幕阅读器状态；失败在附近保留短提示和重试，原稿不变。预览可关闭或Escape退出；修改原稿、录音/转写、发送、角色/账户切换、不可用、隐藏/离页均取消并清除预览/朗读。源文绑定和generation隔离使迟到结果无法替换新草稿，改回旧原文也不会复活旧预览。

预览宽度最多480px，手机随输入栏宽度；长译文限高并局部滚动。所有操作至少44px，保留可访问名称、焦点指示、原输入法Enter保护和减少动效设置。输入区在宽度变化时重新计算高度，上限120px，避免中文换行截字；流式回复期间可准备、翻译和排队下一条，译/发送/停止回复保持同一行。

翻译、试听和使用都不会发送聊天消息或生成能力证据；显式发送仍遵循原聊天行为。服务端继续只读取本用户本角色的有界完成历史，临时草稿不由翻译接口写入聊天/记忆/普通日志。MiniMax及统一朗读标准不变；内部辅助来源仍保留并随队列/重试传播，未变成可见标签。

## 修改文件

- `src/modules/conversation/ui/expression-assist.tsx`：从独立表单改为输入栏触发器和临时预览；当前草稿、取消、重试、Escape/恢复焦点、源文/上下文变化时同步失效。
- `src/modules/conversation/ui/expression-assist.css`：输入栏操作组、锚定预览、44px控件、响应式/长文本/浅深主题及减少动效。
- `src/modules/conversation/ui/voice-composer.tsx`：在原输入栏内集成译/发送/停止操作，单输入框及ResizeObserver生命周期。
- `tests/unit/expression-assist.test.tsx`、`tests/unit/chat-expression-assist.test.tsx`：迁移到新交互，新增空稿、改稿/恢复旧稿、不可用清理，保持显式发送、来源、队列、重试与隐私断言。
- `tests/e2e/chat-expression-assist.spec.ts`：新交互桌面/手机回归，增加原稿编辑/Escape/输入法和短屏长结果，布局/主题稳定后的PNG及JSON证据。
- `PROJECT_STATUS.md`、实施计划003章节、`docs/architecture.md`、`docs/testing-strategy.md`、002后续说明及本交接。

共享文件中已有001/002及其他任务改动；此清单仅指本任务增量，不把整份工作树diff归于本任务。

## 验证

先更新单元测试到新交互，旧实现12项失败，再实现。修复过程中出现过局部变量遮蔽导致生成失败，已修复并由最终完整专项覆盖；早期运行不作为通过结果。

```powershell
corepack pnpm exec vitest run tests/unit/expression-assist.test.tsx tests/unit/chat-expression-assist.test.tsx tests/unit/voice-composer.test.tsx tests/unit/conversation-thread.test.tsx tests/unit/conversation.test.ts
corepack pnpm exec playwright test tests/e2e/chat-expression-assist.spec.ts --reporter=list
corepack pnpm exec eslint src/modules/conversation/ui/expression-assist.tsx src/modules/conversation/ui/voice-composer.tsx tests/unit/expression-assist.test.tsx tests/unit/chat-expression-assist.test.tsx tests/e2e/chat-expression-assist.spec.ts --max-warnings=0
corepack pnpm typecheck
```

最终：Vitest **5文件/85项通过**，Playwright桌面/手机Chromium **14/14通过**，5文件专项lint通过，全树typecheck通过。截图人工复核375px浅色、1440px深色；四宽度两主题程序断言无水平溢出、按钮至少44px、预览在输入框上方，短屏长结果可滚到“使用”且不自动发送。录音/TTS和收费provider均使用fake或网络拦截，不能当成真实音质或供应商生成质量证明。

中途同时运行检查时，typecheck因Windows Zone Allocation内存错误exit134、lint有线程启动失败，E2E曾13项通过/1个worker异常退出3221226505；停止本任务并行重活后，分别串行重跑typecheck/lint及完整14项E2E通过。未杀死用户或其他会话进程，未放宽断言或使用类型忽略。

严格生产构建通过：`NEXT_DIST_DIR=.next/chat-assist-build`，未设置 `NEXT_MEASUREMENT_BUILD`。第一次编译与TypeScript通过后，15个页面worker因内存不足退出134；核对本地Next配置实现后，仅在构建命令设置 `CIRCLE_NODE_TOTAL=2`，使其内置CPU配置使用1个页面worker，编译、TypeScript和77/77静态页面生成全部完成，显式读取 `$LASTEXITCODE` 为0。首次降并行运行已完成页面与路由表，但PowerShell因stderr重定向报shell exit1，故用显式子进程退出码完整复跑确认；未改应用配置、未忽略类型错误。构建自动新增的两条专用tsconfig include已定点移除，其他既有include保留，用户3000服务未中断。

仓库外证据：`D:/workspace-artifacts/chat-assist-003-unit.log`、`chat-assist-003-typecheck.log`、`chat-assist-003-lint.log`、`chat-assist-003-e2e-final.log`；`chat-assist-003-build.log`为首次OOM，最终构建为`chat-assist-003-build-serial.log`（外层命令明确输出`BUILD_EXIT_CODE=0`）；截图及布局JSON在 `D:/workspace-artifacts/chat-assist-003/`。早期失败日志不代表最终结果。

## 未执行与下一步

本次只改同一聊天模块的UI及测试，未重复全仓lint/全量Vitest/整个Playwright项目：前轮有OOM与其他模块失败，本次采用相关路径完整回归、全局类型和生产构建门禁；不宣称全仓全绿。未改Flutter、未跑Flutter检查，无真实收费provider/数据库/RLS或iPhone Safari/PWA真机验证。没有部署。

建议下一步由所有者在iPhone Safari实际键盘打开/收起、旋转、中文输入法和真实朗读下体验；Chromium短视口模拟不等于Safari键盘真机验证。无需进一步设计批准即可试用本次已批准并实现的界面。
