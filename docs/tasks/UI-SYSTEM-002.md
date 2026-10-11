# UI-SYSTEM-002：UI 组件采用与交互/动效补齐

- 状态：`in_progress`（S1–S8 主体全部完成，两个开放问题已于 2026-10-11 上午结清并落地；唯一未做项是 CSS 改动的**浏览器视觉快照复核**）
- 来源：[UI 组件与动效缺口审计](../reviews/2026-10-10-ui-component-and-effects-gap-audit.md)（2026-10-10，只读，基准 `HEAD` = `327f6e9`）
- 目标：让已实现的 UI 系统真正被采用，并补齐四类决定产品可信度的交互（麦克风电平、破坏性操作、错误恢复、动效一致性）
- 单一任务 ID；每个分片可独立成一次提交，**一次只做一片**

## 0. 本次改动与提交状态（2026-10-10 ~ 10-11 凌晨）

当前工作树含他人数百项改动、仓库有 60 个 worktree 并行作业，因此**本轮全部改动未提交**，且**不得**用 pathspec 单独提交 `app/globals.css`——该文件同时含另一会话已暂存的 53+/33− 改动，`git commit -- app/globals.css` 会把两者混进同一个提交。

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `public/public-home/media-learning-workbench-public.png`、`...-mobile-public.png` | 已暂存（`A`） | 从 `e15c844` 恢复，哈希与 blob 逐一核对；修复落地页首屏 404 |
| `app/globals.css` | 未暂存 | 删除两个被完全覆盖的早期 `:root` 令牌块（3+/33−），无渲染变化 |
| `src/shared/ui/confirm-action-dialog.tsx`、`tests/unit/ui-primitives.test.tsx` | 未跟踪 | 自 `e15c844` 定向移植（S2） |
| `src/modules/profile/ui/{account,memory,voice}-data-controls.tsx` + 三个测试 | 未暂存 | 5 个删除入口改用共享对话框（S2） |
| `src/modules/conversation/ui/chat-thread.tsx`、`tests/unit/conversation-thread.test.tsx` | 未暂存 | 消息删除/撤回改用共享对话框（S2 收口） |
| `src/modules/media/ui/media-library-toolbar.tsx`、`media-library.tsx` | 未暂存 | 恢复筛选/排序工具栏并修好 `query` 接线（D1 反转） |
| `src/modules/media/{domain,schemas,repositories}/*`、`src/shared/db/schema/media.ts`、采集侧 8 处枚举 | 未暂存 | 媒体难度扩为 A1–B2 |
| `drizzle/0041_media_cefr_four_levels.sql`、`drizzle/meta/0041_snapshot.json`、`drizzle/meta/_journal.json` | 未跟踪 / 未暂存 | 迁移与快照已写；**已实测确认应用到目标库**（见 §2 的迁移状态核实） |
| `contracts/schemas/v1/media-item.schema.json`、`contracts/openapi/v1/openapi.json` | 未暂存 | 契约同步四档 |
| `src/modules/lexicon-corpus/ui/vocabulary-view-switcher.tsx` + 测试、`read/vocabulary/page.tsx`、`lexicon-corpus/index.ts` | 未跟踪 / 未暂存 | 词汇三视图切换（S7） |
| `src/modules/providers/speech/audio-level-meter.ts`、`browser-recorder.ts`、`index.ts`、`voice-composer.tsx`、`fake-training-loop.tsx` + 测试 | 未跟踪 / 未暂存 | 真实麦克风电平（S4） |
| `src/modules/media/ui/*`（播放器适配器、`media-plyr.ts`、`media-learning-workbench.tsx`、`segment-transcript.tsx`）+ 测试 | 未暂存 | 播放器恢复入口与控件（S5） |
| `src/shared/ui/toast.tsx`、`motion.ts`、`app-shell.tsx`、`app/(product)/read/read-shelf.tsx`、`app/(product)/chat/page.tsx` + 测试 | 未跟踪 / 未暂存 | Toast+撤销（S3）、动效与减少动效（S6）、`/chat` 空态（S7） |
| `app/globals.css` 的 S3/S6/S7/S8 追加与摘除 | 未暂存 | 见 S8 三轮：令牌合并为单一语义层、删除 340 条死规则/10 个 at-rule，581,796 → 541,460 字节 |
| **删除** `src/shared/ui/theme-initializer.tsx` | 已删除（未暂存） | 0 处引用的死文件（S8） |
| `docs/superpowers/specs/2026-09-12-...-redesign.md` | 未暂存 | 难度筛选口径改为 A1–B2 |
| 本文件与 `docs/reviews/2026-10-10-...-audit.md` | 未跟踪 | 审计与任务页 |
| `.tmp-globals-pretokens.css` | 未跟踪（临时） | CSS 收敛前的完整快照，供回退；**不要提交** |

可由分支负责人按片提交（示例）：

```powershell
git add src/shared/ui/confirm-action-dialog.tsx tests/unit/ui-primitives.test.tsx `
        src/modules/profile/ui/account-data-controls.tsx src/modules/profile/ui/memory-data-controls.tsx `
        src/modules/profile/ui/voice-data-controls.tsx src/modules/conversation/ui/chat-thread.tsx `
        tests/unit/account-data-controls.test.tsx tests/unit/memory-data-controls.test.tsx `
        tests/unit/voice-data-controls.test.tsx tests/unit/conversation-thread.test.tsx
git commit -m "feat(ui): wire destructive confirmations through shared primitives"
```

```powershell
git add src/modules/media src/shared/db/schema/media.ts drizzle/0041_media_cefr_four_levels.sql `
        drizzle/meta/0041_snapshot.json drizzle/meta/_journal.json `
        contracts/schemas/v1/media-item.schema.json contracts/openapi/v1/openapi.json `
        tests/unit/media-library.test.tsx tests/unit/learn-page.test.tsx `
        "docs/superpowers/specs/2026-09-12-automated-content-supply-and-lexical-learning-redesign.md"
git commit -m "feat(media): restore the filter toolbar and widen CEFR to four levels"
```

## 1. 背景事实（以 HEAD 为准）

**已知既有失败（与本任务无关，已实测确认）**：`tests/unit/voice-composer.test.tsx` 的「uses the same trailing control position for stopping a stream」在 HEAD 上就失败——把组件与测试同时切回 HEAD 后重跑，结果仍是 3 例中 1 例失败。根因是 HEAD 的组件在 `disabled`（AI 正在回复）时**同时**渲染"发送消息"与"停止回复"两个按钮，而测试断言只应存在后者。这不是本任务引入的，也未擅自改动任一侧：`chat-thread.tsx:484-496` 在流式期间会**排队**消息，因此"隐藏发送按钮"会去掉鼠标/触摸用户的排队入口，属产品取舍，需产品本人决定后再动。

- `src/shared/ui/primitives/` 8 个 primitive 已实现（焦点陷阱、Escape、滚动锁、焦点归还齐备，`primitives/utils.ts:48`），但 HEAD 上只有 `media-library-toolbar.tsx` 引用（popover + select）；其余 6 个零引用。
- 工作树中 `media-library-toolbar.tsx` 被在途改动改写成 `return null`（`git diff HEAD`：−56/+7），使唯一消费者消失。**这不是本任务引入的改动，处理前必须先确认归属。**
- 提交 `e15c844`（`codex/perf-navigation-001` 工作树，未合并）已实现本任务的一部分：`confirm-action-dialog.tsx`、`chat-surface.tsx`、`prompt-bar.tsx`、`ui-primitives.test.tsx`、UI-SYSTEM-001 文档与验收矩阵、两张落地页预览图。
- 5 处破坏性操作仍用 `window.confirm()`；全仓无 toast/snackbar；无 service worker / 离线页 / `not-found.tsx` / `global-error.tsx`；录音"波形"无 `AnalyserNode`；全站仅 1 条 `:active`。

## 2. 前置决策（阻塞 S2 及之后）

| # | 决策 | 选项 | 影响 |
| --- | --- | --- | --- |
| D1 | 工作树中 `media-library-toolbar.tsx` 的剥离是否为产品意图？ | **已确认并已被产品本人推翻（2026-10-10）**：先确认是有意移除（频道分类已够用），随后决定「加回来，如果用不着再要求去掉」，并要求把难度从 A2/B1 扩展为 **A1/A2/B1/B2 四档**。 | 已恢复筛选/排序工具栏并把难度扩为四档（见下方"筛选工具栏决策记录"）。 |
| D2 | `e15c844` 的 UI 系统成果如何处置？ | **已确认：(a) 定向移植需要的部分** | 已移植 `confirm-action-dialog` 与 primitives 契约测试，按当前分支结构适配。 |

在 D1/D2 有结论前，S2–S8 保持 `blocked`。**两个决策已于 2026-10-10 结清，S2–S8 解锁。**

### 筛选工具栏决策记录（D1，2026-10-10，含当日反转）

1. 产品本人先确认「有意移除」：`/learn` 已有「全部 / 视频 / 播客」频道分类，筛选看起来无用，源码保留。
2. 同日随后推翻该决定：**「加回来吧，如果用不着我再要求去掉」**，并要求难度分档从 A2/B1 扩展为 **A1/A2/B1/B2**。
3. 因此本任务的结论是：**恢复工具栏 + 四档难度**，并保留原判断作为观察项——如果四档筛选在真实使用中仍无人使用，产品可再次要求移除（届时只需把 `MediaLibraryToolbar` 换回不渲染，并回退本页测试断言）。

实现要点（已落地，未提交）：

- `src/modules/media/ui/media-library-toolbar.tsx` 从 HEAD 恢复，并把难度选择改为 A1/A2/B1/B2（可见弹层与 sr-only 兜底各一处）。
- 调用处 `media-library.tsx:295` 恢复 `query={activeQuery}`（`b20bf94` 曾把该 prop 改断；别分支的 `8ddd5a4` 是同类修复，本分支未取用）。
- 排序下拉补上 `onChange → form.requestSubmit()`：此前该表单没有提交按钮，只改下拉不会生效。
- 筛选触发按钮改为显式 `aria-label`（`筛选` / `筛选，已应用 N 个条件`），计数徽标 `aria-hidden`，避免徽标文字污染可访问名称。
- **数据侧**：媒体 CEFR 从 A2/B1 扩为 A1–B2，与文章、场景、生成故事的 A1–B2 口径一致。改动：`src/shared/db/schema/media.ts`（check 约束）、`drizzle/0041_media_cefr_four_levels.sql` + `drizzle/meta/0041_snapshot.json` + journal idx 41、`src/modules/media/domain|schemas|repositories`、采集侧 8 个枚举（youtube/podcast/language-reactor 策略与 normalizer、`media-revision`）、`contracts/schemas/v1/media-item.schema.json`、`contracts/openapi/v1/openapi.json`、`docs/superpowers/specs/2026-09-12-automated-content-supply-and-lexical-learning-redesign.md:107`。
- **迁移状态核实（2026-10-11 15:20，对目标库只读）**：`0041` **已应用到目标库**，未由本任务执行 `db:migrate`。证据：
  - `drizzle.__drizzle_migrations` 中 `created_at = 1791647744830` 的行（id 46）存储 hash = `eb5b28abdd38c87519caf36b93656e45148229dcb1d4ab574bd716bc516f3d29`，与该文件 sha256 **完全一致**（`hashMatchesFile: true`）；
  - 线上约束 `pg_get_constraintdef` = `CHECK (((cefr IS NULL) OR (cefr = ANY (ARRAY['A1','A2','B1','B2']))))`；
  - journal 共 43 条、已应用 45 行，**pending = 0**（journal 末尾是另一会话的 `0042_stale_starbolt`，同样已应用）；
  - 现有数据分布 `A2=326`、`B1=247`（尚无 A1/B2 行，符合"只放宽约束、未回填"）。
  - 另有两条已应用记录不在当前 journal 中（历史遗留，与 `LEX-INDEX-001` 记录一致），不影响前向迁移。
  - 因此 `pnpm db:migrate` 现在是无操作；**本任务不再需要执行迁移**。空库/副本演练仍由 `tests/database/media-cefr-migration.test.ts` 在 PGlite 上覆盖（旧约束只认 A2/B1 → 应用后四档可写、C1 被拒、NULL 允许）。


## 3. 非目标

- 不引入新框架：不加动画库（framer-motion 等）、不加图标库依赖、不加图表库。
- 不移除 Tailwind preflight（其复位被现有规则依赖，属高风险，需独立视觉回归）。
- 不做雷达图（`globals.css:8121` 已隐藏且被四板块取代）、不做游戏化特效、不做视差/粒子/滚动劫持、不做 View Transitions。
- 不改评分、证据、隐私、角色安全与内容发布语义；本任务只动呈现层。

## 4. 分片

### S0 协调与冻结（无代码）

- 范围：取得 D1/D2 结论；确认 `app/globals.css` 当前在途改动的归属；确认本任务分支名并登记 `PROJECT_STATUS.md`。
- 验收：审计报告 §0/§6 的事实被产品确认；本任务在状态页有唯一负责人与分支。
- 写入范围：`PROJECT_STATUS.md`（登记行）。

### S1 恢复落地页预览图（**已完成**）

- 范围：从 `e15c844` 恢复 `public/public-home/media-learning-workbench-public.png`（1353×760）与 `...-mobile-public.png`。
- 验收：`app/public-home-experience.tsx:34-36` 的两个路径均可解析；`git hash-object` 等于 `f534d61a…` / `79201a79…`；图片尺寸与 `<img width="1353" height="760">` 一致（无 CLS）。
- 验证：`Get-ChildItem public/public-home`；浏览器访问 `/` 确认首屏无破图。
- 状态：文件已恢复并暂存，**未提交**（分支属其他任务）。

### S2 采用 primitives：破坏性操作改用 `AlertDialog`（进行中）

- 范围：`chat-thread.tsx:671,684`、`account-data-controls.tsx:55`、`memory-data-controls.tsx:62`、`voice-data-controls.tsx:82` 的 `window.confirm()` 全部替换为共享确认对话框；确认后焦点归还原触发控件。
- 不变量：删除/撤回语义、二次确认门槛、错误与重试文案不变；账号删除仍不可逆且必须显式确认。
- 验收：
  - `git grep -n "window.confirm" -- src app` = 0；
  - 5 个确认流程有单测：打开（焦点进入对话框）、Escape 关闭并归焦、Tab 循环不逃逸、确认后调用原有 API、取消不调用；
  - 既有 `account-data-controls` / `memory-data-controls` / `voice-data-controls` / `conversation-thread` 单测保持通过。
- 验证：`pnpm exec vitest run tests/unit/account-data-controls.test.tsx tests/unit/memory-data-controls.test.tsx tests/unit/voice-data-controls.test.tsx tests/unit/conversation-thread.test.tsx`；`pnpm exec tsc --noEmit`；改动文件 ESLint。
- 写入范围：上述 4 个组件 + 新确认对话框（若采用 `e15c844` 版本则为 `src/shared/ui/confirm-action-dialog.tsx`）+ 相关测试。

#### S2 进展（2026-10-10）

已完成（**未提交**，见 §0 的暂存说明）：

- 定向移植 `src/shared/ui/confirm-action-dialog.tsx`（自 `e15c844`，按当前分支 primitives 适配；`AlertDialogAction` 的 `preventDefault` 使"服务端未成功就不关闭"成立）。
- 定向移植 `tests/unit/ui-primitives.test.tsx`（7 例）——此前 8 个 primitive **零测试**，现在契约有守卫。
- `account-data-controls.tsx` / `memory-data-controls.tsx` / `voice-data-controls.tsx` 三个组件的 5 个删除入口全部改为共享对话框；`deleteData`/`remove` 改为返回 `boolean`，失败留在对话框内、页面不再声称半成功。
- 单测改为走对话框，并新增"取消不删除""服务端拒绝时对话框保持打开且展示错误"两类断言。

验证结果（全部改动合并后重跑）：

| 命令 | 结果 |
| --- | --- |
| 聚焦 `vitest run`（19 文件：媒体 / 词汇 / 删除确认 / 对话） | **19 files / 112 tests 全绿** |
| `vitest run tests/contracts`（31 文件） | **31 files / 129 tests 全绿** |
| `tsc --noEmit`（全仓，`--max-old-space-size=3584`） | **exit 0，零诊断** |
| ESLint `--max-warnings=0`（全部改动文件） | **exit 0** |
| `drizzle-kit check` | **Everything's fine**（`0041` 迁移与 journal/snapshot 一致） |
| `git grep -n "window.confirm" -- src app` | **0 命中** |

S2 完成范围：

- `account-data-controls.tsx` / `memory-data-controls.tsx` / `voice-data-controls.tsx` 的 5 个删除入口改用共享对话框，处理函数返回 `boolean`，失败留在对话框内、页面不声称半成功。
- `chat-thread.tsx` 的消息删除/撤回改用同一对话框：对话框渲染在消息菜单 portal 内、菜单项仍是触发器，菜单在阻塞遮罩下保持挂载直到请求结算；焦点在结算后归还——撤回保留行时回到消息行，删除移除行时回到消息列表（为此给列表加 `tabIndex={-1}`）。菜单的延迟聚焦与 Escape 处理都改为"对话框优先"（`defaultPrevented` 即让位），409 撤回超时仍保留专属文案。
- 新增"取消不删除""服务端拒绝时对话框保持打开并展示错误"两类断言（对话侧 27 例含新增）。

未逐条复测：Escape 关闭并归焦、Tab 循环不逃逸在 primitive 层由 `ui-primitives.test.tsx` 覆盖，组件层未单独断言。

**测试基建发现（影响面大于本任务）**：`vitest.config.ts` 未开启 `globals`，且 `tests/setup.ts` 只导入 `jest-dom`，因此 `@testing-library/react` 的自动 `cleanup` 不会执行——同一文件内的多个用例会共享 DOM（本轮新增用例曾因此报"找到多个同名按钮"）。已在本次改动的测试文件里显式加 `afterEach(cleanup)`。建议后续在 `tests/setup.ts` 统一注册清理，但那会影响全部套件，需单独一片。


### S3 Toast / 撤销 / 状态提示统一（依赖 S2）

- 范围：新增一个最小 `Toast`（`role="status"`、`aria-live="polite"`、3–5 秒自动消失、可手动关闭、不抢焦点、渲染在 portal）；把"保存成功/删除成功/同步失败"这类跨页重复的内联提示接入；对**可逆**操作提供"撤销"（至少：取消收藏、删除已保存词句、退出引用/撤回消息）。
- 不变量：`证据/画像/记忆` 的删除仍不可逆；撤销只能回滚客户端已提交且服务端支持的操作，不得伪造服务端成功。
- 验收：toast 有单测（自动消失计时使用 fake timers、Escape/关闭按钮、`aria-live` 存在、不抢焦点）；删除类操作提供撤销入口且有"撤销失败"回退文案。
- 写入范围：`src/shared/ui/toast*.tsx`、`app/globals.css`（新增规则，追加在文件末尾，避免与他人改动冲突）、接入点组件。

### S4 真实麦克风电平（独立，可与 S2/S3 并行）

- 范围：录音期用 `AudioContext` + `AnalyserNode` 驱动电平条（`voice-composer.tsx:186`、`fake-training-loop.tsx:794`），替换装饰动画；录音结束后释放 AudioContext 与 stream；`prefers-reduced-motion` 下降级为低幅静态指示。
- 不变量：不采集、不上传、不保留音频；失败/无权限/不支持时回退为现有文案与打字入口；不得因电平渲染影响录音启停延迟。
- 验收：单测覆盖"无 `AudioContext` 时回退""权限被拒时回退""停止录音后 context 被 close"；`grep -c AnalyserNode` ≥ 1 且仅出现在录音组件；真机（iPhone Safari）确认电平随说话变化、静音时归零。
- 写入范围：`voice-composer.tsx`、`fake-training-loop.tsx`、录音 provider 适配层、`app/globals.css`（追加）。

### S5 媒体与播放器恢复入口

- 范围：播放错误重试按钮（复活 `.media-player-retry` 语义，`globals.css:11905`）；进度冲突可操作化（`media-learning-workbench.tsx:250`）；可见倍速控件；单句循环；字幕跟随开关（`segment-transcript.tsx:41`）；渲染"当前片段"卡片（`learn/media/[stableKey]/loading.tsx:15` 已画骨架）。
- 不变量：键盘快捷键 A/S/D/Q 语义不变；不自动播放；进度同步冲突仍以服务端为准。
- 验收：每条各有单测或 e2e（重试后重新加载、冲突提示出现按钮、倍速改变 `playbackRate`、循环在同一句内重复、关闭跟随后阅读位置不被拽回）；`tests/unit/video-learning-workbench.test.tsx`、`tests/unit/podcast-audio-player.test.tsx`、`tests/unit/segment-transcript.test.tsx` 保持通过。
- 写入范围：`src/modules/media/ui/**`、`app/(product)/learn/media/[stableKey]/loading.tsx`、`app/globals.css`（追加）。

### S4 / S5 进展（2026-10-10 ~ 10-11 凌晨，已完成）

**S4 真实麦克风电平（Lead 实现）**

- 新增 `src/modules/providers/speech/audio-level-meter.ts`：用 `AudioContext` + `AnalyserNode` 读取录音期真实时域信号，输出归一化 0..1 电平；不连接 destination（不监听、不回放、不产生第二份音频）、不缓存、最后一个订阅者退出即 `close()`。
- `BrowserAudioRecorder` 新增 `isLevelMeterSupported` 与 `subscribeLevel()`；`reset()`（停止/取消/页面隐藏中断）会统一关闭全部订阅，组件忘记退订也不会泄漏 AudioContext。
- `voice-composer.tsx`（7 条）与 `fake-training-loop.tsx`（18 条）改为由真实电平驱动条高；**无法测量时保持原装饰动画**，`data-live="false"` 表明这是回退而非真实电平。训练页因为引擎异步开麦，采用 20×100ms 退避等待（与播放器注入控件的重试形状一致）。
- 顺带修正：录音计时器加了 `aria-hidden`，`role="status"` 现在只播报"正在录音"，不再每秒打扰读屏。
- 测试：`tests/unit/audio-level-meter.test.ts`（6 例：归一化、削顶/静音、节流、退订清理、无 AudioContext 回退、支持判定）与 `voice-composer.test.tsx` 新增 2 例（真实电平驱动、回退不伪装）。

**S5 播放器恢复入口与控件（委派子代理产出，Lead 复核并修完遗留缺陷）**

六项全部落地：播放错误"重试播放"（复活此前闲置的 `.media-player-retry`）、进度冲突"重新读取服务器进度"（不再要求刷新整页）、可见倍速控件（0.75x/1x/1.25x，快捷键 1/2/3，经 Plyr `speed` 应用）、循环当前句（L 键）、字幕跟随开关（默认开）、加载骨架承诺的"当前片段"卡片真实渲染。

Lead 在复核中修掉了子代理留下的 4 类缺陷（这也是它未收尾的原因）：

1. 兜底"自动暂停" `<input>` 丢了 `type="checkbox"` → 可访问角色变成 textbox，3 个既有测试失败；已补回。
2. 悬空引用 `playerSpeedRef`（只写不读）→ `tsc` 报错；已删除，速度统一由 `speed` prop 驱动。
3. `applyPlyrSpeed(player: Readonly<PlyrInstance>)` 内赋值 `player.speed` → TS2540；已去掉 `Readonly`。
4. `TrainingAudioCapabilities.recorder` 未包含新增的电平成员 → 训练页 3 个 TS 错误；已把两个成员并入（`Partial`，既有 fake 不受影响）。
5. 另外补：`segment-transcript.test.tsx` 缺必填 `follow`、进度冲突测试断言更新为新文案 + 断言恢复按钮、双语断言改为限定在字幕区域内（"当前片段"卡片会同时显示该句翻译）。

### S3 Toast / 撤销 / 状态提示统一（已完成，接入面仍在扩展）

已落地：

- 新增 `src/shared/ui/toast.tsx`：每个 toast 自成一个 `role="status"` + `aria-live="polite"` 区域；**从不抢焦点**；默认 4 秒自动消失（落在 3–5 秒区间内）；可手动关闭；最多同屏 3 条；只在真的有内容时挂到 `document.body`（服务端与首帧不渲染 portal，避免水合不一致）。
- `useToast()` 在**没有 Provider 时降级为空操作**而不是抛错——大量组件单测与孤立预览都在无 Provider 下渲染，这里不能因为缺少基础设施就崩。
- `AppShell` 挂载 `ToastProvider`（覆盖全部产品页）。
- 首个真实接入点：`read-shelf.tsx` 的收藏/取消收藏成功后不再只弹一条死提示，而是带「撤销」；撤销重新发起同一个服务端动作（`saved: !当前值`），失败仍走原有的乐观回滚与错误提示。
- 测试：`tests/unit/toast.test.tsx`（5 例：礼貌播报且不抢焦点、4 秒自动消失、手动关闭、撤销执行后关闭、最多 3 条）与 `article-library.test.tsx` 新增「撤销会以相反值重申服务端动作」。

未做（按分片内注明即可）：`saved-items-library` 的删除没有服务端恢复接口，因此**不提供撤销**；撤回消息同理。其余内联提示保留，迁移是增量的。

### S6 动效对齐（已完成）

- **按压反馈**：对主要按钮、句子控件、媒体卡、消息气泡、toast 控件加 `scale: .98` 的 `:active`。刻意使用**独立的 `scale` 属性**而非 `transform`，因此不会覆盖任何既有 `transform`/`transition`，也不需要过渡（按压反馈保持即时，远快于 100ms）。
- **进入动效统一**：新增 `sueno-enter-up`（`opacity + translateY(8px)`，240ms，`--motion-*` 令牌），用于新消息、消息提示/翻译、恢复条、持久化提示、播放器重试按钮与进度状态；媒体网格、词表网格、学习词表网格的**前 4 项 40ms 递增**。
- **JS 动效尊重减少动效**：新增 `src/shared/ui/motion.ts`（`prefersReducedMotion()` / `preferredScrollBehavior()`），`chat-thread.tsx` 与 `media-library.tsx` 的 `scrollTo({behavior:"smooth"})` 改为按偏好返回 `auto`——此前 CSS 的全局兜底管不到命令式滚动。
- CSS 全部**追加在 `app/globals.css` 末尾**，不改动任何既有 hunk（该文件为多会话共享），并在结尾补了一段 `prefers-reduced-motion` 兜底把上述动画显式关掉并保留最终态。

对账（原验收项）：`prefers-reduced-motion` 现在在 `.tsx` 中至少 1 处（`motion.ts` 的 `matchMedia`），两处命令式平滑滚动都改为按偏好返回 `auto`；新增动效全部使用 `--motion-*` 令牌；**未做浏览器目视确认无布局跳动**（见文末限制）。

### S7 移动端可用性（三视图切换已完成；热力图与 `/chat` 空态待做）

- 范围：热力图 14×14px 单元在移动端改为周/月列表或 ≥44px（`globals.css:6216-6221`）；`/chat` 右栏空态（`chat/page.tsx:14`）；`/read/vocabulary` 三视图切换控件（`read/vocabulary/page.tsx:104-127`）。
- 验收：375×667 与 iPhone 12 Pro 视口下热力图任一单元命中区 ≥44px；`/chat` 有无会话两条空态文案；三视图切换保留 `search`/`pageSize`、重置 `page`。
- 写入范围：`learning-heatmap.tsx`、`app/(product)/chat/page.tsx`、`app/(product)/read/vocabulary/page.tsx`、`app/globals.css`（追加）、对应测试。

#### S7 进展（2026-10-10/11）：三视图切换、热力图移动端命中区、`/chat` 空态

- **三视图切换**：新增 `src/modules/lexicon-corpus/ui/vocabulary-view-switcher.tsx`：`学习词表 / 语料高频词 / 正式词元` 三个目的地，URL 仍是唯一真源；`search` 与 `pageSize` 跨视图保留，`page` 重置，`intent`/`lemmaStatus` 只在 lexicon 视图保留。**实现方式与原计划的偏差（有意）**：没有用 `role="tab"`——三个视图是三个不同 URL、各自服务端渲染，`role="tab"`+`aria-controls` 会承诺并不存在的面板切换；改为 `<nav aria-label="词汇视图">` + 真实链接 + `aria-current="page"`，与阅读区既有导航语义一致，外观复用 `sueno-tabs*` 类。
- **热力图移动端命中区**：此前单元 14×14px、84 个停靠点，手机上基本点不中。`<700px` 时格子改为 44×44px、6px 间距（50px 步距），并沿用已有的横向滚动容器；图例用的是 `<i>`，选择器限定 `button.learning-heatmap__cell` 所以图例保持小尺寸。
- **`/chat` 空态**：右栏此前 `return null`。现在渲染 `.conversation-empty`（"选择一个好友开始对话"）并在 `<960px` 用 CSS 隐藏——小屏由联系人栏占位，两者不会抢同一块空间；`aria-labelledby` 指向标题。既有测试从"右栏必须为空"改为断言该提示存在。
- 测试：`vocabulary-view-switcher.test.tsx`（7 例）、`vocabulary-page.test.tsx`、`chat-workspace-layout.test.tsx`（8 例）全绿。

### S8 设计系统收敛（主体完成；仅剩浏览器视觉快照复核）

已完成（分三轮，全部附结构化自证）：

**轮 1 — 令牌补定义与死文件**

- 补上两个"用了但从未定义"的令牌：`--font-serif`（9 处使用）与 `--shadow-lg`（1 处使用）此前静默回退到继承值/无阴影。
- 删除死文件 `src/shared/ui/theme-initializer.tsx`（0 处 import；`app/layout.tsx:35-40` 早已内联同一段脚本）。
- 删除两个被完全覆盖的 `:root` 令牌块（蓝色 `#f4f7fb` 与绿色 `#f4f6f5` 两套历史主题），3+/33−，无渲染变化。

**轮 2 — 死 CSS 摘除（`.public-home__*` 系统）**

- 方法与理由：它**不是连续区间**（首条命中 L1271、末条 L13236，中间夹 11,614 行无关规则），因此不能手工整块删；改用一次性脚本按规则摘除 + 结构化校验（脚本已删除，回退快照见轮 3）。
- 结果：删除 **198 条规则 + 6 个 at-rule**（581,796 → 558,906 字节）。
- 校验：postcss 解析两份文件均 OK，规则 4536 → 4338（恰好 −198）、at-rule 194 → 188（恰好 −6）；选择器集合**新增 0 个**；消失的 84 个中仅 4 个非 `.public-home` 前缀，且都只是"同一选择器在别处仍存在、此处少一处重复"；`.landing-` 323 → 323、`@keyframes` 31 → 31 不变。
- 残留 7 行（3 条裸 `.public-home` 规则 + 一个 `@media` 内的 3 条 `.public-home__hero*`），原因是脚本把"注释 + 规则"当成一条语句、以 `/*` 开头即跳过。轮 3 解决。

**轮 3 — 单一令牌层 + 剩余死选择器（2026-10-11）**

- **令牌收敛**：把 4 个并列的顶层 `:root` 块（① Quiet Madrid 主题 ② UI-006 样板令牌 ③ UI-SYSTEM-001 动效令牌 ④ 上一轮追加的 `--font-serif`/`--shadow-lg`）合并为**唯一的语义层**，保留 `:root[data-theme="dark"]` 与 `@media (prefers-reduced-motion)` 内作用域的 `:root` 覆盖。
- **剩余死选择器与配套死代码**：分析发现 60 处 `var(--public-*)` 引用全在另一代被废弃的落地页 mock 规则里（`.product-preview__*`、`.proof-console__*`、`.conversation-preview__*`、`.product-ui__*`、`.workbench__*`、`.mini-workbench__*`），它们依赖的 `--public-*` 恰好定义在那些死 `.public-home` 选择器上（定义在选择器匹配不到任何元素上，所以这些引用**本来就已经解析不到值**）。全仓（app/src/tests）对这些家族引用为 0，故一并摘除：**142 条规则 + 4 个 at-rule**，另删除无人引用的 `@keyframes public-home-reveal`。
- 结果：`app/globals.css` 558,906 → **541,460 字节**（本轮 −17.4 KB；本任务累计 581,796 → 541,460，−6.9%）；`.public-home` 选择器 **0**、`--public-*` 定义 **0**、悬空 `var(--public-*)` **0**（剩 5 处仅为历史注释文字）。
- 校验：
  1. **令牌生效值逐一相等**：脚本按文档顺序计算 `:root`（44 个属性）、`:root[data-theme="dark"]`（23 个）、`@media (prefers-reduced-motion) :: :root`（4 个）三个作用域的最终生效值，合并前后 **71 项逐一相等、0 处不一致**；
  2. postcss 解析两份文件均 OK；规则 4338 → 4193、at-rule 188 → 184；
  3. 选择器集合比对：**新增 0 个**，消失的 99 个**全部**属于上述死家族；
  4. `.landing-` 323 → 323、大括号 4375/4375 平衡、`@keyframes` 31 → 30（仅减去确认无引用的那一个）。
- 快照：本轮改动前的完整文件保留为 `.tmp-globals-pretokens.css`（未跟踪，未提交），如需回退可直接取用。

**仍未做（需浏览器）**：以上全部为结构证明，**没有像素级复核**。CSS 不参与单测，真正的回归门禁是在能跑桌面+移动视觉快照的环境里对 `/`、`/learn`、`/read`、`/me`、`/chat`、`/explore` 做一次对比。

## 5. 已决问题与实施（2026-10-11 上午，产品本人已答复）

1. **AI 回复期间的"发送消息"按钮 → 决定：保持原设定，且不做任何排队提示（产品本人 2026-10-11 两次确认）。**
   最终状态：`VoiceComposer` / `chat-thread` **已完全回退**到原实现——发送按钮在回复期间保持原位（可排队提交），文案仍是「发送消息」，**不新增**"排队发送"名称、`title` 或 helper text。
   期间尝试并已被否决：曾实现 `queueing` 入参 +「排队发送」+ 一行 `aria-describedby` 关联的排队说明；产品明确表示"排队按钮和提示都不需要"，故全部撤下。**后续会话不要再加**，除非产品重新要求。
   测试：`tests/unit/voice-composer.test.tsx` 中那条**在 HEAD 上就已失败**的用例改为断言真实约定——回复期间发送控件**仍在**（无内容时禁用）且停止控件可用；早先版本断言"发送控件应当消失"，与该组件从未有过的行为不符。现在该文件 5 例全绿。
2. **迁移 `0041_media_cefr_four_levels` → 决定（代理判断）：不应用到任何真实/目标数据库**，改为在**一次性进程内 Postgres（PGlite）**上真实执行并做行为验证。
   新增 `tests/database/media-cefr-migration.test.ts`（2 例，全绿）：
   - 断言迁移位于 `drizzle/`、journal idx=41、`0041_snapshot.json` 的 check 文本含 `'A1', 'A2', 'B1', 'B2'`（保证标准迁移路径与下一份迁移的 diff 基线一致）；
   - 在 PGlite 上建好 RBAC/auth 前置 → 应用 `0000` + `0024`（此时约束仍为 A2/B1）→ 应用 `0041` → 断言 `pg_get_constraintdef` 含 A1/A2/B1/B2；
   - **行为验证**：克隆该表的约束后真实插入 `A1/A2/B1/B2` 全部成功、`C1` 被 `media_versions_cefr_check` 拒绝、`NULL` 仍允许。
   仍然**未执行** `db:migrate`、未连接目标库；应用到目标库前的空库/副本演练与迁移评审由合并者按仓库规则执行。

### 5.1 全量单元套件的既有失败（与本次改动无关，如实登记）

跑完整 `tests/unit`（而非仅本任务触及的套件）会对上 6 例既有失败，逐条核实**均不由本任务引起**：

| 文件 | 失败 | 核实结论 |
| --- | --- | --- |
| `tests/unit/desktop-navigation.test.tsx` (2) | 找不到「收起侧边栏 / 展开侧边栏」按钮 | `src/shared/ui/desktop-navigation.tsx` 在工作树与 HEAD **均未改动**且不实现该折叠开关——即审计报告里点名的"断言了组件未实现的开关"的陈旧测试，现已确认在 HEAD 上就失败 |
| `tests/unit/account-data-route.test.ts` (2)、`tests/unit/lucia-data-route.test.ts` (1) | `` `cookies` was called outside a request scope `` | 对应路由与 `src/shared/auth` 在工作树**未改动**，属路由测试环境问题 |
| `tests/unit/language-reactor-adapter.test.ts` (1) | `expected {...} to match object { contentType: 'podcast', … }` | 该适配器文件里**另有其他会话在途的改动**（YouTube 封面走 `images.weserv.nl` 代理的 `cachedYoutubeArtworkUrl`）；本任务对该文件的改动只有一行 CEFR 枚举放宽，不可能改变 `contentType` |

**另登记一条间歇性 flake（非本任务引入，但发生在本人改过的组件上）**：`tests/unit/fake-training-loop.test.tsx › restores a stable checkpoint without replaying input playback` 在**多文件并行**时偶发超时失败（12 文件批次里 4 次中 2 次失败），单独跑 **3/3 通过**、与另外 3 个重文件同跑 45/45 通过、最后一次 12 文件批次 **74/74 通过**。该用例断言的是 checkpoint 恢复文案与 hydration 标记（`findByText` 默认 1s 超时），与本次改动的波形/电平路径无关；按仓库规则**不放宽断言**，仅如实登记。

### 5.2 视觉复核：已完成的部分与清单

清单（逐页 × 视口 × 深色模式、判定标准、已知预期差异）：[UI-SYSTEM-002-visual-review-checklist.md](UI-SYSTEM-002-visual-review-checklist.md)。

**已在真实 Chrome 上自动核验（2026-10-11，对既有 dev server 只读，证据在 `docs/evidence/2026-10-11-ui-system-002/`）**：

- `/` 桌面 1440×900 与手机 390×844 截图：版面/排版/导航/CTA 正常，**无 4xx、无失败请求**；截图存档 `01-public-home-desktop-1440x900.png`、`02-public-home-mobile-390x844.png`；
- 落地页主视觉图 `naturalWidth=1353 × naturalHeight=760`，与 `<img width height>` 一致，桌面与手机各自取到对应图（S1 的 404 修复已被浏览器证实）；
- **令牌计算值**（浅色）`--background #f6f3ed`、`--foreground #17211d`、`--accent #2e5da8`、`--font-serif`/`--font-display`/`--font-ui` 均解析、`--space-3 12px`、`--radius-card 14px`、`--shadow-lg 0 24px 60px #17211d24`、`--motion-standard .24s`、`--motion-slow .36s`、`--primitive-overlay 70`；深色 `--background #121715` 等按预期切换。**这把 S8 令牌合并从"结构证明"升级为浏览器计算值证明**；
- 落地页实时规则仍在生效：hero 标题 `Georgia, "Songti SC", serif` / 76.32px、CTA `border-radius: 999px` / `rgb(166,63,45)`；
- 未登录访问六个产品路由全部正确重定向到 `/login?next=…`，无 5xx。

**产品页复核（2026-10-11 下午，经产品本人同意起 E2E 服务器完成）**：以 `AUTH_E2E_ENABLED=1`、独立 `NEXT_DIST_DIR=.next-visual`、端口 3300 起了一次性 dev server，用 `spanish-e2e-user` cookie 复核六个产品路由 × 桌面 1440×900 / 手机 390×844，**全部 0 失败请求、0 个 5xx**；服务器已关闭、端口已释放。要点：

- `/learn`：频道标签、搜索、**恢复的「筛选」按钮 + 摘要 + 排序下拉**、五列卡片栅格全部正常；打开弹层后 DOM 直读难度选项为 `全部难度 / A1 / A2 / B1 / B2`（可见控件与 sr-only 兜底各一份）；
- `/read/vocabulary`：三视图切换的三个链接、`aria-current` 唯一、`.sueno-tabs-list` 为 `flex`、当前项下划线 `rgb(46,93,168)`；
- `/chat` 空态：桌面 `display: grid` 且文案在，手机 `display: none`（联系人栏接管，不重叠）；
- `/me`（手机）：页面、分区导航、底部导航当前态正常；热力图因该用户无学习证据处于空态，改用计算值补验——注入同类元素后 **桌面 14×14、手机 44×44**，图例色块始终 14×14（证明选择器限定在 `button.`）；
- 证据截图 7 张在 `docs/evidence/2026-10-11-ui-system-002/`（含 3 张产品页与筛选弹层）。

**复核中发现并修掉的一处视觉问题**：`/learn` 排序控件的「排序」两字在桌面被 flex 行挤成上下两行。已追加纯追加规则 `.media-library__sort label { white-space: nowrap; }`；复测桌面标签高 18px 单行、手机仍是 1×1 视觉隐藏形态（未受影响）。大括号 4371/4371 平衡。

**仍未做的**：交互态像素复核（Toast 出现/撤销、录音电平、播放器倍速/循环/跟随、`prefers-reduced-motion` 下的动效）——这些需要人在浏览器里点，单测已覆盖逻辑但未做视觉确认；清单 §2 保留了逐项勾选。

### 5.3 产品复核后的返工（2026-10-11 下午）

产品本人按清单点了一遍，报回三组问题，全部已改（细节见 [清单 §0.3](UI-SYSTEM-002-visual-review-checklist.md)）：

| 反馈 | 处置 | 验证 |
| --- | --- | --- |
| 撤销可无限点击（撤销又能再撤销）、点击后有加载空档、卡片缺倒计时 | Toast 动作改异步：点击即进入 pending（`disabled` + `aria-busy` + 「撤销中…」、暂停自动消失），promise 结算后才关闭；`read-shelf` 的撤销改 **silent** 调用，不再推送新 toast，因此不存在第二个「撤销」；卡片新增 `role="presentation"` 的**倒计时横条**（`transform: scaleX(1→0)` + 每条内联 `animation-duration`） | `toast.test.tsx` 11 例、`article-library.test.tsx` 12 例全绿（含"同 tick 双击只触发一次""撤销只发一次 POST"）；tsc / ESLint 干净 |
| 录音没有波形起伏 | 三轮排查后**由应用侧修复，产品实测确认波形正常**。① `sqrt(rms × 8)` + 下限 0.05；② 循环从 `requestAnimationFrame` 改 60ms 定时器（页面不渲染时会被节流/挂起）；③ **改分贝映射**（`20·log10(rms)` 映射 −70…−10 dBFS 到 0…1 + 快起慢落），并给音频图补一条**零增益到 destination 的静音通路**（Chrome 只渲染能到达 destination 的图）、加 `context.resume()`。**勘误**：排查过程中曾用 Playwright 启动的真实 Chrome + 系统麦克风测到纯数字静音（`maxDeviation=0`、−120 dBFS），据此一度写成"硬件侧故障"；产品在自己日常的 Chrome 里实测波形正常，说明那是**自动化实例的特有现象**（新 profile / 音频服务差异，未最终定因），不是硬件损坏。文档按实测更正 | 真实 Chrome（`channel: "chrome"`）：合成信号下训练页条高 0.05–1.0；**chat 输入条** 19 个不同高度、0.05–1.0（证据 `docs/evidence/2026-10-11-ui-system-002/09-chat-composer-waveform-live.png`）；**产品在桌面 Chrome 实测波形有起伏（2026-10-11 确认）** |
| 产品反馈"视频播放像卡死" | 用 Playwright 接管真实 Chrome 做了 4 组探针（单击 / **连按 25 次** / **长按 1.2s** / **播放器就绪前连按 3 次**）外加一次 **60 秒连续播放健康检查**，`currentTime` 连续推进、零停顿、零 seek、无页面错误——**键盘路径没有问题**。随后产品给出具体页面（`youtube.language-reactor.28c0618224c1cc5a441d5e56`，表现为画面抽搐），改用**有头 Chrome + 帧级指标**复现：`requestVideoFrameCallback` 只有 **307 帧/15s（平均间隔 48.8ms、最大 250ms、82 次 >60ms 空档）**，同时 PerformanceObserver 记到 **10 秒内 56 次长任务、累计阻塞 4199ms（约 42% 时间阻塞主线程）**。CPU profile 显示开销集中在 React **dev 模式**的 `jsxDEV`/`validatePropertiesInDevelopment` 等，来自**每次位置刷新（约 4 次/秒）重渲染全部 168 行字幕并对每句重新分词**。**修复**：把单行字幕抽成 `memo` 组件，只有当前行随位置重渲染（非活动行收到稳定的 `null`，整行跳过） | 修复后同环境复测：**长任务 0 次 / 阻塞 0ms**（此前 56 次 / 4199ms）；帧呈现 **425 帧/15s、平均间隔 35.2ms（≈30fps 源帧率）、最大 83ms、>60ms 空档从 82 降到 12**、无 seek、无页面错误。测试：`segment-transcript` 1 例、`video-learning-workbench` 10 例、`podcast-audio-player` 5 例全绿 |
| 空格直接暂停 | 在 workbench 的捕获阶段键盘处理里加 `Space`（`playerStateRef` 为 playing 则 `pause()`，否则 `play()`），输入框内不受影响，并 `stopPropagation` 以免 Plyr 再翻一次；产品实测空格可用。另补两个保护：`event.repeat` 时忽略（长按会每 ~30ms 切换一次），播放器仍在 `loading` 时忽略按键（挂载期调用 `play()` 可能留黑帧） | `video-learning-workbench.test.tsx` 新增两例：空格播放→暂停且输入框内不触发、未就绪时空格不动作 |
| 产品反馈"打开视频单词选框选在别处、随后无法正常播放"（同一视频 + 其他视频） | **已定位并修复（真 bug）**。之前复现不了的原因：我用的一次性 E2E 用户**没有存档进度**，`initialPositionMs` 恒为 0，而 bug 恰好只在有存档时触发——这是产品账号才会遇到的路径。定位方式：用 owner 的真实存档（只读 SSR 取进度、**拦截所有进度写入**，不改任何数据）+ 有头 Chrome。现象：打开后 `currentTime` 冻在 **7.84s**、`status="正在播放"` 但 `readyState` 在 **1↔4 之间反复塌陷**、媒体元素出现 `emptied`+`loadstart` 二次加载。根因在 `handleStateChange`：`if (state === "ready" && initialPositionMs) playerRef.current?.seek(initialPositionMs)` —— **每次 `ready` 都重新应用存档位置**，而 Plyr 在源重新加载后会**再次**发出 `ready`，于是播放被反复拽回 7.84s，画面撕裂、进度不前进；字幕高亮跟着存档位置走，所以看起来"选框先选在了别的地方"。修复：每个媒体挂载只应用一次存档位置（`restoredPositionKeyRef` 以 `stableKey` 为键），重试播放时重置 | 修复前：`t` 冻在 7.84、`ready` 1↔4。修复后：打开即恢复到 **7.84s（paused、ready 4 稳定）**，按空格后 `t` = **9.35 → 10.86 → 12.36 → 13.88 → 15.37**（严格单调、≈实时）、`ready` 恒为 4、零错误、零写入。回归测试：`video-learning-workbench.test.tsx` 新增"ready 重复上报时存档位置只应用一次"（旧代码必然失败：第二次 `onReady` 会再 seek 一次）；该文件 11 例、相关 9 文件 59 例全绿 |
| 播放器不要新增倍速控件；去掉 A/S/D/L/1/2/3 按钮；上一句/下一句用左右方向键 | 删除「逐句播放控制」「播放速度」两整行，倍速交回 Plyr 自带设置菜单；句子导航改 **←/→**（捕获阶段 + `stopPropagation`，避免同一次按键又被 Plyr 当快进退）；`A/S/D/Q` 保留为既有快捷键；HEAD 就有的「自动暂停」移到播放器下方单独一行 | `video-learning-workbench` 8 例、`podcast-audio-player` 5 例全绿（改为断言方向键导航 + 断言这些按钮/倍速控件**不存在**） |

**未做的**：Toast 倒计时横条的浏览器视觉确认——既有 E2E 用户在该库中不存在（`/api/v1/me` 404），保存动作不会成功，因此点不出 toast；横条只有 jsdom 结构与 CSS 结构证明，需产品在自己登录的会话里点一次收藏确认。

## 6. 完成定义（每片）

1. 范围与本节一致，未顺手加入延后功能；
2. `pnpm exec tsc --noEmit` 与改动文件 ESLint 通过；聚焦单测通过（并说明未跑的全量项与原因）；
3. 错误、取消、空状态、竞态与 `prefers-reduced-motion` 已处理；
4. 未引入能力评分污染、越权访问或敏感日志；
5. `git diff` 只含本片改动（工作树含他人 599 项改动，**只提交本片涉及路径**）；
6. 向状态页提供 Commit、测试结果、限制与下一步。

## 6. 交接格式

```
片：S<n> <名称>
Commit：<sha>
修改文件：<列表>
验证：<命令> → <结果>
未执行：<全量 lint/test/build/e2e/真机> 及原因
限制：
下一步：
```
