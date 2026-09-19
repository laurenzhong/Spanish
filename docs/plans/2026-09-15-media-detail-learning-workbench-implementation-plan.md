# 媒体详情与视频学习器实施计划

- 日期：2026-09-15
- 设计任务：`LEARN-MEDIA-DETAIL-001`
- 设计依据：[媒体详情与视频学习器视觉设计](../superpowers/specs/2026-09-15-media-detail-learning-workbench-design.md)
- 当前状态：`LEARN-MEDIA-DETAIL-002` 与 `LEARN-MEDIA-DETAIL-003` 已实现，进入 `review`
- 活动客户端：Next.js 响应式 Web/PWA

## 1. 范围

把现有 `/learn/media/[stableKey]` 和 `MediaLearningWorkbench` 从功能基线收敛为稳定的媒体详情体验。只调整页面结构、组件样式、响应式编排、状态呈现和可访问性，不改变媒体 DTO、播放资产、进度 revision/CAS、评分、证据、字幕处理或数据库模型。

## 2. 任务拆分

| 顺序 | 任务 | 建议分支 | 依赖 | 交付 |
| --- | --- | --- | --- | --- |
| 1 | `LEARN-MEDIA-DETAIL-001` 详情视觉与响应式设计 | `codex/learn-media-detail-001-design` | 当前媒体详情基线 | 已完成：规格、状态和验收矩阵 |
| 2 | `LEARN-MEDIA-DETAIL-002` 桌面详情工作台实现 | `codex/learn-media-detail-002-workbench` | 001、产品确认 | 已实现：标题/播放器/字幕/词句层级与状态样式 |
| 3 | `LEARN-MEDIA-DETAIL-003` 移动重排与可访问性回归 | `codex/learn-media-detail-003-responsive` | 002 | 已实现：移动抽屉、焦点、安全区和视口回归 |

一次只领取一个任务 ID。设计任务完成并确认前，不开始 002；002/003 不得顺手实现词库、跟读、ASR 或新的评分入口。

## 3. `LEARN-MEDIA-DETAIL-002` 实现建议

### 3.1 可能修改

- `app/(product)/learn/media/[stableKey]/page.tsx`
- `src/modules/media/ui/media-learning-workbench.tsx`
- `src/modules/media/ui/lexical-drawer.tsx`
- `src/modules/media/ui/segment-transcript.tsx`
- `app/globals.css`
- 媒体详情组件单元测试

Route 继续负责鉴权、参数校验和 application 调用；React 组件不直接访问数据库。优先复用现有 player port、进度编排和 `MediaPlayback` DTO。

### 3.2 设计实现重点

- 保持播放器 16:9 和稳定尺寸，统一详情页标题、来源和状态信息层级。
- 桌面采用播放器/逐句区双栏核心布局，词句上下文作为按需辅助层。
- 移动采用全宽播放器、主滚动字幕和避开底部导航的词句底部抽屉。
- 保留 A/S/D/Q、字幕模式、句子定位、进度同步和现有失败语义。
- 为加载、无字幕、播放失败、下架/过期、同步冲突和恢复路径补齐视觉状态。

## 4. 测试先行与验收

实现前新增可复现的组件断言，至少覆盖：

- 标题/播放器/字幕 landmark 和可访问名称。
- 字幕模式、当前句和时间戳定位不破坏现有行为。
- 词句辅助层打开、关闭、焦点恢复及移动底部导航避让。
- 无字幕、播放器失败、进度保存失败和 409 冲突的诚实状态。
- `A/S/D/Q` 不在输入控件中抢占快捷键。

Playwright 使用现有视频和播客 fixture，覆盖 320、375、390、414、768、1024、1280、1440px；不访问公网、不调用收费 Provider。实现切片至少运行受影响 Vitest、目标文件 ESLint、`pnpm typecheck` 和 `git diff --check`；跨模块发布候选再运行全量门禁。

## 5. 停点与后续

2026-09-16 当前停点：用户暂缓真实转写与翻译，先完成其余 UI。本次 UI 收尾修复移动端整页跟随、键盘/手动浏览暂停，以及焦点插入按钮造成首次点词丢失的问题；24 项相关单测、22 项桌面/移动 E2E 通过，目标 ESLint 通过。真实数据生成、审核发布、长媒体段数上限及断点恢复明确留在暂停范围，不继续发起 Provider 请求。UI 进入用户复核，不宣称真实媒体已经获得双语/词级字幕。

2026-09-16 追加授权与实现：全部视频/播客可收费转写、翻译，无费用上限，暂用 OpenAI；点词保留 MiniMax。0034 词时间 JSONB 迁移已应用，真实 WAV 分块、词时间持久化与 OpenAI 翻译适配已实现但未完成真实发布验收。OpenAI 官方接口返回 `401 invalid_api_key`；先配置有效密钥，再从两条参考媒体试点，完成独立双维审核和结构校验后显式发布。长媒体段数上限、断点续跑、全部素材处理及真实页面逐词/双语验收仍待完成。

2026-09-16 最新执行：用户将字幕转写切换为 MiniMax，翻译暂缓。视频已生成 91 段 draft `2950385b-8aa5-41b5-9174-a7fe88ead17a`，播客已生成 643 段 draft `4d2e94e0-3fbd-4a0f-bcea-bbe281a77c58`；两者低置信度均为 false，临时音频已删除，均未发布。正式媒体段数上限统一提高到 2,000 并通过相关单测；下一步是三维审核、结构校验和显式发布，不将 draft 当作线上双语字幕。

2026-09-16：用户已确认 `LEARN-MEDIA-DETAIL-004` 的视频/播客差异化布局、字幕排版及 MiniMax 点词解析，直接实施，无需重复设计审批。验收增加真实词级 DTO 的边界/重复词/缺失降级测试、解析 done/错误/取消竞态测试、桌面播客比例与假解析浏览器验证。正式词级数据生成、持久化、审核发布和旧媒体回填仍是未完成依赖，不能以 UI 框选能力替代端到端完成；当前状态见 PROJECT_STATUS。

设计确认后，先完成 `LEARN-MEDIA-DETAIL-002`，产品视觉复核通过后再做 `LEARN-MEDIA-DETAIL-003`。词汇/语料能力由 `LEX-001`/`LEX-002` 负责，跟读评分由后续明确任务负责，不在本计划扩张。
