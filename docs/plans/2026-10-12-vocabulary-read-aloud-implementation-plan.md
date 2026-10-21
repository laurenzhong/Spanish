# 词汇页朗读：单词统一浏览器西语 TTS

- 日期：2026-10-12
- 依据：`docs/superpowers/specs/2026-10-12-vocabulary-read-aloud-design.md`
- 调研依据：`docs/references/2026-10-12-language-reactor-dictionary-audio.md`
- 状态：review（产品本人已授权当前 TTS 修订）
- 建议任务 ID：`VOCAB-AUDIO-001`（单分支单任务）


## 2026-10-13 当前范围（VOCAB-AUDIO-001）

产品本人明确选择单词统一使用浏览器西语 TTS；本节取代下方历史原声优先切片、媒体请求/裁剪及降级验收。手动朗读和已实现的点词自动发音均只传显示词本身，在点击处理器里同步发起 es-ES TTS。准备时显示“合成音 · 准备中…”且可停止；start 后显示“合成音”，成功结束复位；不支持/超时/合成失败在词卡旁给可重试错误。沿用浏览器西语声音偏好及有界回退。

2026-10-20 所有者修订：点击词卡「朗读单词」后不再显示“合成音 · 准备中…”/“合成音”状态行；加载、播放与停止只由按钮的停止标签、`aria-busy` 与 `aria-pressed` 表达，失败仍在词卡内显示可重试提示；其余音源、取消、互斥与不写证据的边界不变。

取消覆盖停止按钮、切词、关闭、Escape、页面隐藏和卸载；generation 隔离过期 start/end/error。例句继续按 ADR-0015 的 Tatoeba 完整录音/无录音 TTS 策略，两种例句音与单词 TTS 互斥。词架不调用 /api/v1/read/word-audio，不创建单词媒体播放器，不显示媒体句子；服务端旧接口与来源迁移保留兼容。无新供应商、无音频存储、无 DB 写入或能力证据。

回归先以 suponer + 可用媒体 clip 复现旧路径失败，再锁定只读 suponer/es-ES、零词音 API 请求/零媒体实例；覆盖自动/手动、准备/开始/结束、超时/错误/重试、取消、过期事件和例句互斥。scripts/verify-vocabulary-audio-browser.ts 用真实 Chrome TTS 验证 suponer 的 start/end、按钮复位、375/1440px、零媒体请求；不把事件检测称为扬声器听感或 Safari 真机验收。DB/RLS 无变更，不需迁移。

## 2026-10-12 历史设计与实施记录

## 0. 已锁定的约束

1. **音源顺序固定**：有原声播原声；没有才用浏览器合成音；两级都必须有可见状态，不静默。
2. **不引入付费 TTS**，不抓取第三方音频（权利链见调研 §6）。
3. **匹配用折叠重音后的 token 相等**，绝不用字符串包含；命中不唯一或时间轴不合法一律判定「无原声」，不猜。
4. **时间轴只信 provider 数据**：复用 `wordTimingsForPlayback()`，它已规定不一致时失败关闭；不得使用 `estimateWordTimings()`。
5. **词句模块不自己拼播放地址、不放宽媒体门禁**：一律经 `media` 的 `getMediaPlayback`。
6. **不返回媒体目录**：解析响应只含一个片段引用，不含 segments 数组。
7. **朗读不写证据**：不碰 `evidence_events`、`mastery`、`confidence`、画像、关系记忆。
8. **不破坏既有守卫**：浮层按钮仍在卡片盒子内（无死区）、零 scroll 监听、零滚动期几何读取、7,892 词块仍为纯 HTML。
9. 不顺手改 `media` 模块代码；需要时另立任务。

## 1. 切片顺序（每片一个可独立验证的提交）

### 切片 1：domain —— 在例句里定位一个词的时间窗

- 新增 `src/modules/lexicon-corpus/domain/word-clip.ts`：
  - `findWordClip(segment: { sourceText, startMs, endMs, words? }, word: string): { startMs, stopAtMs } | null`
  - 规则：先用 `wordTimingsForPlayback()` 取可信时间轴；在**该时间轴自己的 token 文本**（缺失时用 `sourceText.slice(startOffset, endOffset)`）上做**折叠重音后相等**匹配；命中必须唯一且时间不重叠；`stopAtMs` 取 min(结束 + `POST_ROLL_MS`, `segment.endMs`)，`startMs` 取 max(起始 − `PRE_ROLL_MS`, `segment.startMs`)；词窗 `< 60 ms` 时退化为整段 `[segment.startMs, segment.endMs]`。
- **先写失败测试**：折叠重音命中（`escuadron` ↔ `escuadrón`）；子串**不**命中（`sol` 不得命中 `solo`）；两个不同时间的同名 token → `null`；`words` 与 `sourceText` 不一致 → `null`；roll 常量边界；短窗退化；空 `words` → `null`。
- 验证：聚焦 Vitest + 改动文件 ESLint。

### 切片 2：数据 —— 例句的来源身份落库

- `lexicon_form_frequencies` 新增 4 列：`example_document_kind`、`example_document_stable_key`、`example_document_version`、`example_segment_index`；`drizzle-kit generate` 产出迁移（预期 `0044_*`，以生成结果为准）。
- `corpus-form-frequency.ts` 的 live 扫描与物化刷新**同一处**带上这 4 列；`min(array[...])` 的排序键必须让「文本 + 标题 + 来源身份」绑定成同一行，否则物化路径与 live 路径会出现「文本相同但来源不同」的漂移。
- `readMaterialisedFormFrequencyRows` 与 `FormFrequencyRow` 投影同步；README/注释说明文章来源的 stable key 允许为空。
- **测试**：既有 `frequency-example-clip` / 频率物化等价性测试继续绿；新增断言：物化行与 live 行在 4 个新列上逐条相等（有库时跑，无库时如实标注未执行）。
- 验证：`pnpm db:generate`、`pnpm db:check`、聚焦 Vitest、迁移应用到目标库后 `drizzle.__drizzle_migrations` 与 journal 一致性核对。

### 切片 3：application —— 解析一个词的音频

- 新增 `src/modules/lexicon-corpus/application/resolve-word-audio.ts`：输入 `{ word, exampleText }`（+ 可选 `documentRef`），输出
  `{ outcome: "clip" | "synthetic", clip: {...} | null, reason }`，`reason ∈ no_match | stale_reference | unavailable | wrong_document_kind`。
- 解析路径：定位来源行 → `getMediaPlayback(mediaRepository, stableKey, userId)` → 找到 `segmentIndex` 且校验 `segment.sourceText === exampleText` → 切片 1 的 `findWordClip` → 短有效期播放地址。
- 失败即降级为 `synthetic`，**不抛给客户端**；无 `DATABASE_URL` 时直接返回 `synthetic`（不联网、不抛）。
- **测试**：版本不一致 → `stale_reference`；资产过期 → `unavailable`；文章来源 → `wrong_document_kind`；匹配不到 → `no_match`；成功路径返回的 `stopAtMs` 合理。全部用 fake repository，不连真实库、不调 `getMediaPlayback` 的真实实现。

### 切片 4：路由与契约

- `contracts/schemas/v1/word-audio-response.schema.json` + `contracts/openapi/v1/openapi.json` 条目；`app/api/v1/read/word-audio/route.ts`（POST）。
- Zod 校验：`word` 1–40、`exampleText` 1–400 且必须非空；稳定错误码；未鉴权 401。
- **测试**：401；超长 400；响应体**不含** `segments`（断言锁住「不返回媒体目录」）；契约测试对新 schema 生效。

### 切片 5：UI —— 按钮、播放器、降级与状态

- `vocabulary-shelf.tsx`：
  - 浮层卡片：在既有两个标记按钮**同一个盒子内**增加朗读按钮（第三项）；词详情卡的「朗读单词」改为同一条行为路径。
  - 单一 `HTMLAudioElement` 引用 + 一个 `playback` 状态（`idle | loading | playing | error`），切词/离开/`Escape`/页面隐藏/卸载都停止。
  - `requestAnimationFrame` 到点暂停；`ended` 兜底。
  - 原声优先 → 失败降级合成音并给出可重试提示；合成音显示「合成音」，原声显示「原声 · 来源标题」。
  - 解析结果内存缓存上限 20 条（只在本次会话内）。
- `vocabulary-shelf-controls.tsx`：慢速开关（`0.78`），存 `sueno:vocabulary-audio:v1:<scope>`。
- **测试（jsdom）**：点击播放（fake `Audio`）；再点停止；换词时旧播放停止且 `play()` 只发生一次；原声失败 → 合成音 + 提示；不支持合成 → 既有文案；慢速开关写入并作用于 `rate`；**既有回归不得放宽**：`translation-actions` 仍是 `card` 的子元素、`layer.children` 仍只有一个盒子。

### 切片 6：样式与可访问性

- 播放按钮 ≥44×44 命中区（触屏），键盘可聚焦，`aria-pressed` 与可见状态一致；播放态的动画遵守 `prefers-reduced-motion`。
- 卡片**不因**状态变化改变尺寸（避免指针被甩出卡片导致按钮点不到——这是 `VOCAB-HOVER-002` 的同类问题）。
- 词块结构不变（仍是纯 HTML，不加 per-word 组件）。

### 切片 7：真实浏览器验证

- `scripts/verify-vocabulary-page-browser.ts` 增补：
  - 挑一个**已知有原声**的词（用切片 2 的列挑选并写进脚本注释），点击朗读 → `audio.currentTime` 前进、且停在 `stopAtMs` 附近（容差 ≤ 300 ms）。
  - 挑一个**已知无原声**的词 → 走合成音且界面显示「合成音」。
  - 播放期间重复既有守卫：新增 scroll 监听 0、几何读取 0、浮层按钮仍可达。
- 记录：用到的词、`stableKey`、`segmentIndex`、实测时间窗与容差。

### 切片 8：文档与状态

- `docs/architecture.md`（`/read/vocabulary` 段落补朗读与音源顺序一句）、`docs/testing-strategy.md`（真实浏览器音频验证一项）、`PROJECT_STATUS.md`（任务行 + 记录条目 + 下一步）。
- 若产品本人在放行时要求，补 ADR-0013（只写三条：原声默认、合成音兜底、不引入付费 TTS 与不抓第三方音频）。

## 2. 验收（整体）

1. 有原声的词：点击能听到该词所在片段的真实音频，卡片标明「原声」与来源。
2. 无原声的词：点击能听到合成音，卡片标明「合成音」；不出现「母语者」「标准发音」这类不实描述。
3. 原声不可用（过期/版本不符/取数失败）：降级到合成音并给出可重试提示，**不静默**。
4. 任何时刻只有一路声音；离开词、切词、`Escape`、隐藏页面都会停止。
5. 既有守卫全绿：无死区、零 scroll 监听、零滚动期几何读取、动画元素数不变。
6. 朗读**不产生**任何能力证据（有测试或可核对的断言）。
7. `pnpm typecheck`、聚焦 Vitest、改动文件 ESLint、`pnpm build`、相关 e2e 通过；迁移在目标库应用并核对一致性。
8. 无 `DATABASE_URL` 时如实标注未执行的 DB/RLS 与迁移验证。

## 3. 明确不做（防范围蔓延）

- 不接入付费 TTS、不抓第三方音频、不引入音频缓存服务。
- 不做跟读/录音/发音评分，不写能力证据。
- 不做「点词即读」、不做悬停自动朗读。
- 不改媒体播放页播放器、不改媒体模块代码、不改发布门禁。
- 不给原声做变速（`playbackRate`），不做「原声/合成音」用户偏好开关（除非原声被证明不可用）。
- 不重构 `vocabulary-shelf.tsx` 的既有结构（浮层、portal、`content-visibility` 处理都保持原样）。

## 4. 风险与回退

| 风险 | 处置 |
|---|---|
| `getMediaPlayback` 一次读 500 段、含 `words` jsonb（实测最重 0.42 MB） | 只用于**服务端解析**，不返回给客户端；若实测解析延迟 >1.5 s，改为按 `segmentIndex` 的窄查询（在 media 侧另立任务，不在本任务里改） |
| 物化行陈旧（36 h 上界）导致来源版本不符 | 已由 `stale_reference` 明确定义：降级合成音，不播错音频 |
| iOS 真机 `play()` 失败 | 明确提示 + 合成音兜底；真机验证列为未执行项，不以 Playwright 通过代替 |
| 迁移与 journal 不一致 | 按仓库既有规则：`db:generate` → `db:check` → 目标库应用后核对 journal/记录数，作为切片 2 的验收 |

## 2026-10-13：VOCAB-TATOEBA-002（产品本人明确授权）

本任务为 Tatoeba 例句增加复制与完整原声播放；ADR-0015 对有独立再利用许可的 Tatoeba 音频作单独决定，前文第三方音频限制继续约束许可不明的供应商产物。

1. 官方音频元数据导出与现有例句按 sentence ID 配对，独立元数据文件保留 audio ID、作者、许可、署名、来源与导出 hash；未知/空许可失败关闭。未来例句构建请求 `include=audios` 保存同样字段。
2. 运行时解析补充可空 `audio` DTO；句子与译文不变，不产生 DB 迁移。音频地址固定为官方网页的 download 路径；元数据缺失仍展示文本。
3. 西语例句右侧两个 44px 图标：复制原句、播放/停止原声。加载/播放/失败提示按句显示，无音频时禁用播放；录音独立署名；不以 TTS 替代。
4. 使用既有唯一音频元素和 generation，用户点击同步启动，开始/中途无进度均 20 秒超时；currentTime 实际前进才显示播放中，waiting 显示加载中，end/error、切词/关闭/Escape/隐藏/卸载全部明确处理。音频使用官方复数 `/v1/audios/{id}/file` 端点。按产品本人 2026-10-13 追加授权，无可用授权录音时提供明确标记的浏览器西语“合成朗读”，与原声/单词互斥；确认 start 才显示正在朗读，失败/无声超时可重试，切词/关闭/隐藏/卸载取消，不新增收费服务或录音存储。
5. 验证许可/配对/解析单元、词架回归、类型、改动文件 ESLint、Playwright 桌面/手机浅深主题及一条真实原声完整播放。默认单元不访问真实 provider；真实浏览器检查只读取应用和流播许可音频，不保存文件，不写证据。

验收记录（2026-10-13）：聚焦 7 文件 / 147 用例、typecheck、受影响 ESLint、生产构建 74/74、Playwright 6 项布局交互 + 1 条真实录音完整播放通过；构建 tracing 包含两个 Tatoeba 资产。元数据更新/撤除有文件 revision 回归。全量 Vitest 出现既有/无关失败并停滞，已停止，不能算通过；全仓 lint、全量 E2E、DB/RLS 专项和 Safari 真机未执行，原因及完整交接见状态页。实现仍在既有共享工作区，未混合提交。

## 5. 2026-10-13 展示收敛：VOCAB-UI-001

产品本人截图反馈「太拥挤，去掉没用的提示语，改变设计」。这是独立的 UI 修正，不领取或改变 `VOCAB-AUDIO-001` 的状态：

- 搜索、简短词数、非零本机标记数和自动发音开关共享工具栏；桌面单行，手机搜索独占第一行。
- 产品本人追加反馈搜索框外观与导航拥挤：词汇内容距导航至少 24px；搜索改浅填色胶囊，桌面最大 320px、手机全宽且输入字号 16px；放大镜固定左侧 16px 内缩、清除搜索固定右侧且保持 44px 命中区。骨架/空状态同步间距，浏览器验证包括实际清除搜索操作。
- 删除常驻技术说明、零标记说明和音频降级横幅；音源与真实播放失败只在当前词侧栏展示。朗读按钮保持重试路径。
- 手机排名导航放在词表上方一行横向滚动，避免原有两列网格把词表压成零宽；仍完整渲染全部词条。
- 词汇骨架使用同一工具栏容器；不改音源接口、排序、能力证据、存储和审核门禁。
- 验证：词汇页/词架组件回归、未配置数据库的桌面/手机 Playwright，以及 `scripts/verify-vocabulary-toolbar-browser.ts` 的真实词表浅/深主题和 320–1440px 几何、首屏词条、键盘开关、本机标记、合成音状态与侧栏关闭检查。浏览器脚本使用 fake 音频，无收费调用；不能替代 iPhone Safari 真机和真实原声验证。

## 6. 2026-10-14 详情布局试版：VOCAB-PANEL-002

产品本人批准先试评审前两项，视觉不满意时仅撤回本轮改动。沿用共享工作树，不修改其他任务状态。

- 1200px 起使用右侧详情分栏，首次打开/关闭以点击词条为滚动锚点；连续切词保持列宽。901–1199px 使用右侧抽屉，900px 以下保留底部抽屉，不压缩词表。
- 详情顺序为单词/朗读、核心释义、原有个人标记、例句、常见变位/形式、默认折叠的用法/搭配、查另一个词。词表例句与 Tatoeba 分组放在同一区域，署名/许可与原声/合成音区别保留。
- 2026-10-15 本人反馈 estar 变位不可见：先用真实审核词条的单元和桌面浏览器回归复现；将变形从折叠区移出，并取消前 8 项截断，完整呈现已有形式（含 estado、estando）。不修改审核内容，不将匹配词形升级为完整变位表。
- 切词复位详情滚动和折叠状态；打开/关闭不在滚动监听中测量几何，不修改词条顺序、全量呈现、音源、存储、评分或 API。
- 验证：先增加顺序/折叠和滚动锚点回归，再运行词架/默写/页面相关单元、类型检查、受影响 ESLint；Playwright 检查浅深主题、375/1024/1440px 的选中词位置、抽屉不压缩词表、切词、关闭/返回/Escape、查词和无横向溢出，保存截图人工复核。
- 本轮源文件基线保存到仓库外 `vocab-panel-002-before`，只用于局部回退；不使用整树 Git 重置，不覆盖其他在途修改。实现留待本人视觉验收，不提交/推送/部署。
