# Language Reactor「已保存项目」页深度调研与 Sueño 词句书架差距分析

- 日期：2026-10-10
- 调研对象：[Language Reactor](https://www.languagereactor.com/) 的 `/saved-items`（中文界面「已保存项目」）
- 对照对象：Sueño `/read/vocabulary`、`/read/phrases`、`/read/saved-items`、`/read/corpus`
- 调研目的：为该页做功能级细节调研，并与我们当前实现逐项比较，产出「需要新增 / 需要调整」的功能清单
- 授权：项目所有者已明确授权抓取该站点公开可用数据
- 性质：调研与差距分析文档。**本文不构成实施计划，也未获批任何产品范围变更**；其中各项需各自走设计与 ADR 流程后再进入实施计划

---

## 1. 调研方法与证据等级

### 1.1 实测环境

| 项目 | 值 |
|---|---|
| 工具 | Playwright 1.62.1 + Chromium（headless） |
| 桌面视口 | 1440 × 1000 |
| 移动视口 | 390 × 844 |
| 界面语言 | 简体中文 |
| 学习语言 | 英语（LR 账号默认），检索目标语言为西语 |
| 账号状态 | **未登录** |
| 抓取时间 | 2026-10-10 |

### 1.2 方法

1. 浏览器导航 `/saved-items`，采集 DOM、可访问树、可见文本、截图（桌面 / 移动）。
2. 采集该路由实际加载的前端 chunk，做只读静态分析（数据模型、枚举、交互分支）。
3. 下载公开的 `ui_strings/en.json`、`ui_strings/zh_CN.json` 全量文案（各 1,437 键）并做语义分组。
4. 抓取 LR 官方帮助页 `/help/export`（导出指南），其中**公开了该页数据模型的完整 TypeScript 定义**。
5. **登录后补测**（2026-10-10，第二轮）：由项目所有者在可见 Playwright 窗口中手动登录其本人账号，随后以只读脚本复用该持久化 profile 探测页面控件、筛选器枚举、导出对话框与服务端端点。凭据未经过自动化脚本（脚本只观察「已登录 UI 取代了未登录外壳」这一状态变化）。
   - 发现并记录了 `storageState()` **无法**复现登录态的原因：LR 会话凭据存放在 **IndexedDB**，而 `storageState()` 只序列化 cookies 与 localStorage。
6. 与本仓库实现逐项对照（OpenAPI 契约、Drizzle schema、领域与 UI 组件）；并由独立子代理做第二轮只读审计交叉验证。

### 1.3 证据等级标记

| 标记 | 含义 | 可用于 |
|---|---|---|
| **已实测** | 本次在公开页面/H5 直接看到或抓到 | 页面结构、公开文案、公开 schema |
| **静态推断** | 来自公开前端 chunk 的只读静态分析 | 数据字段、枚举、交互分支（实现细节可能随版本变化） |
| **登录受限** | 需要账号才能验证 | 真实排序/筛选结果、导出文件内容、调度算法行为 |

### 1.4 本次未验证事项（必须如实标注）

**已完成实测**（详见 §3.2、§3.3、§4.8、§5.4、§5.8）：

- 三个页签的真实标识与门禁差异（`ALL_WORDS` 匿名开放，`WORDS`/`PHRASES` 需登录）——**推翻了本文早前「未登录必然看不到词表」的错误结论**；
- 西语 8000 词频词典**匿名可读**，含完整响应体特征；
- 排序控件与其枚举；学习阶段六档及其两轴语义；标签四色与十六进制值；
- 导出对话框的五格式页签与五筛选器及其完整选项列表；导出未被 Pro 限制；
- **一条真实已保存短语的完整服务端记录**（§4.8）：顶层字段、`reference` 全字段、三槽位、153 个 token 的完整 NLP 结构、词频排名；
- 列表页真实渲染：表头、**日期分组分隔行**、两轴阶段计数与 `countsPerStage` 一致；
- 保存 / 删除的真实 RPC 序列（`saveItem_5` → `getItemKeys_3` → `getItems_5`；`removeItem` 返回 `{}` 表示幂等成功）。
- **会话生命周期：约 40 分钟后失效**（20:11 登录 → 21:04 仍可用 → 21:18 已回落为登录态）。这一事实对任何自动化探测都是硬约束，见 §8 第 10 条。
- **五种导出格式的真实产物全部取得并解析**（§5.8）：JSON 顶层数组 + 内联 TTS base64 音频；CSV 实为 zip（`items.csv` + `media/*.mp3`）；Excel 单 sheet；Print 自包含 HTML；Anki 旧式 11 表 schema + Cloze 卡片 + 19 字段笔记类型 + `[sound:…]` 音频。
- **会话可在无人工干预下恢复**（§8 第 13 条）：凭据在 IndexedDB，用主机侧 `.NET` 通道经本机代理（`127.0.0.1:7897`）换新 ID token，再写回 IndexedDB 即可。

以下**仍未有真实数据证据**，本文不做断言：

1. **排序在多项数据上的真实顺序**。账号只有 1 条，控件可点但无法体现排序差异；升降序切换的真实行为也未验证。
2. 「到期」时间由服务端还是客户端计算，以及半衰期模型的实际更新规则（`reviewData` 实测为 `null`，需经过复习才产生）。
3. ~~导出的真实文件内容~~ → **已完成！** 五种格式全部实测下载并解析，见 §5.8。包括 JSON 顶层结构与**内联 TTS 音频**、CSV 实为 **zip（CSV + 媒体文件）**、Anki **旧式 schema + Cloze 卡片 + 19 字段**、Excel/CSV 实测 **20 列**（非官方文档的 23 项）、Print 为自包含 HTML。
4. **条目级标签 / 阶段修改入口未定位**。实测确认列表页上的阶段药丸与标签药丸**只是筛选开关**（点击不发写 RPC）；条目级修改入口在 hover 词典或条目菜单。
5. 逐条删除、批量删除、全量清空的实际级联与撤销语义（仅确认 `removeItem` 的响应形状）。
6. 免费账号的保存条目上限数值（文案存在 `savedItemsStore_errorTooManyItems`，未见具体数值）。

> **数据现状**：所有者本人的 LR 账号原本为 0 条，本轮为验证而**真实保存了 1 条短语**（见 §4.8），因此账号现在**不是空号**。该条目是西班牙语新闻视频的一句字幕，可由所有者随时在 `保存的短语` 页签删除。
>
> 要补齐第 1、4、5 项，需要账号中存在**至少 3 条**、且保存时间跨越两天的条目（用于验证日期分组与排序）。建议后续使用专门测试账号，不要在个人主账号里大量注入测试条目。

### 1.5 方法学教训（值得记录）

本文早前关于「未登录是否能看到词表」的判断**错了**，原因值得留档：

1. **从导航猜链接文本**去点击（`词汇`/`Vocabulary`），从未命中真正的页签节点 —— 实际页签标识是 `value="ALL_WORDS"`；
2. **直接粘贴 URL** 进入 `/saved-items`，默认落在 `WORDS` 页签，只能看到登录占位，于是把局部现象当成了整页行为；
3. 得出否定结论前**没有穷举页签**，而页签状态的持久化键（`settings_v1.savedItemsActiveTab`）当时已经在我手里。

正确做法：先枚举 `[role=tab]` / `.MuiTab-root` 的真实 `value`，再逐个切换实测，而不是按可见文案推断。

---

## 2. 核心结论

1. `/saved-items` 不是「收藏夹」，而是一个**词汇调度中枢**：它同时承担收集、组织、排序、复习到期管理和导出五个职责。这一点与我们把它当「阅读器标注书架」的定位差异最大。
2. LR 的保存对象有**三种**，而基础区分不是「单词 / 短语」，而是**「是否绑定上下文」**：
   - **短语**（点字幕旁的星号保存）
   - **带上下文的单词**（在字幕或词典例句中标记单词）
   - **不带上下文的单词**（直接在单词面板标记）
   这个三分法直接决定了导出成 Anki 卡片时的正反面内容，是 LR 数据模型里最有借鉴价值的一点。
3. LR 的单词对象带**词元级归一**（`wordType: 'lemma' | 'form'`）、**词频排名**（`freqRank`）、**词性**（17 个 Universal POS 标签）和**上下文原文**，因此「同一个词在不同内容里高亮」能成立。我们的 `corpus_occurrences` 已具备来源与位置，但**保存项本身不冻结上下文**。
4. **实测确认 LR 把整条 NLP 分析链固化进保存条目**（§4.8）：每个 token 带 `pos`/`xpos`/`lemma`/`form_norm`/`feats`（UD 形态特征）/`deprel`+`pointer`（依存句法）/`freq`+`diocoFreq`（词频），且**保留空白 token**（`pos:"WS"`）以还原原始间距。它保存的不是一个字符串，而是一段**可计算的语言学数据**。这是我们目前差距最大的一点。
4. LR 有**到期/复习调度**（半衰期模型 + 七档到期分桶）与 **PhrasePump** 消费端；我们**词句域完全没有调度层**（只在场景练习域有 `scenario_repetition_items`）。
5. LR 的**导出是一等公民**，且**登录后实测确认对免费账号开放**：导出对话框有 **5 个格式页签**（ANKI / PRINT / EXCEL / CSV / JSON）与 **5 个筛选器**（语言、项目类型、首选翻译、学习阶段、标记多选）。
6. **学习阶段是「来源 × 阶段」两轴**，不是单一枚举：`已掌握/学习中/不学习` 是**用户标记的**，`自动/建议/罕见` 是**按词汇量水平预测的**，两者可独立开关筛选。这是 LR 与我们差异最大的建模点——我们只有单一 `intent`。
7. 该页有**三个页签**：`词汇`（`ALL_WORDS`）、`保存的单词`（`WORDS`）、`保存的短语`（`PHRASES`）。**门禁按页签分别判断**：`ALL_WORDS` 未登录即可用，`WORDS`/`PHRASES` 才要求登录。它把「全语言词频词典」与「我的收藏」放在同一路由下。
8. **`ALL_WORDS` 的数据源是语言词典**（`base_dict_getAllWordsForLang`，8000 词/语言，约 40 种语言），**匿名可读**，与用户内容无关。这是一份可直接复用的西语词频表，比页面本身更有工程价值。

---

## 3. 页面结构（已实测）

### 3.1 未登录结构（已实测）

未登录时该页明确要求登录，中心区不伪造示例数据。

| 视口 | 顶部页签 | 主体 | 其他 |
|---|---|---|---|
| 桌面 1440×1000 | `词汇` / `保存的单词`、`保存的短语` | 「请登录以使用此功能。」+ `登录` 按钮 | 学习语言 / 母语选择器 + `OK` |
| 移动 390×844 | `保存的单词` | 同上 | 底部/浮动工具栏 |

侧栏一级导航（`aria-current="page"` 落在 `已保存项目`）：媒体内容、Chatbot、PhrasePump、**已保存项目**、帮助、设置、论坛、登录。

### 3.2 页签结构（登录后实测）

**该页有三个页签，不是两个**（`enabledTabs: ["ALL_WORDS","WORDS","PHRASES"]`）：

| 页签 `value` | 中文标签 | 数据源 | 加载函数 | 未登录可用 |
|---|---|---|---|---|
| `ALL_WORDS` | `词汇` | `GET base_dict_getAllWordsForLang?lang_G=<学习语言>&numWords=8000` | `reloadWords()` | **✅ 开放** |
| `WORDS` | `保存的单词` | `POST base_items_getItemKeys_3` / `getItems_5` | `reloadListItems()` | ❌ 需登录 |
| `PHRASES` | `保存的短语` | 同上 | `reloadListItems()` | ❌ 需登录 |

> **重要更正（推翻本文早前结论）**：导航里的 **`词汇` 是第三个页签**，不是栏目标题；也**不存在**名为「全部单词」的按钮。我此前把 `词汇` 误读为栏目名，并据此得出「未登录必然看不到词表」的错误结论。

#### 门禁是按页签分别判断的（实测）

`WORDS` 页签在 `licenseStatus === "NOT_SIGNED_IN"` 时直接 `return <登录占位/>`，而 `ALL_WORDS` 页签**没有该判断**。实测对照：

| 状态 | 页签 | 门禁文案 | 词表分档 | 词典 RPC |
|---|---|---|---|---|
| 匿名 | `ALL_WORDS` | 无 | **1 段（+2 段）= 303 token** | ✅ `lang_G=en` |
| 匿名 | `WORDS` | 「请登录以使用此功能。」 | 0 | 未发出 |
| 匿名 | `PHRASES` | 同上 | 0 | 未发出 |

#### 词表是**语言词典**，不是内容语料统计

`base_dict_getAllWordsForLang` 返回该语言按词频排序的完整词典。**匿名实测**（`credentials: omit`，无任何凭据）：

```
GET https://api-cdn.dioco.io/base_dict_getAllWordsForLang?lang_G=es&numWords=8000
→ HTTP 200, 154,652 字节
→ {"status":"success","data":{"words":[{"text":"el"},{"text":"que"},{"text":"él"},{"text":"de"},{"text":"ser"},...
```

西语首 60 词：`el · que · él · de · ser · no · a · yo · uno · y · en · estar · tú · haber · qué · tener · ir · por · hacer · ese · este · poder · con · sí · decir · pero · para · mi · saber · ver · querer · todo · si · su · más · bien · ya · tu · del · al · como · aquí · creer · muy · dar · pasar · así · solo · o · mucho · deber · porque · cómo · ahora · algo · vez · hablar · nada · cuando`

档位选择器（页面实测）：`1 / 100 / 200 / 300 / 400 / 500 / 600 / 700 / 800 / 900 / 1k / 2k / 3k / 4k / 5k / 6k / 7k`，与 `numWords=8000` 上限一致。

**这是本次调研最有价值的可复用资产**：一份 8000 词的西语词频表，匿名可读、可合法抓取（所有者已授权）。

### 3.3 登录后其它结构（已实测，含一条真实条目）

空态（0 条）时：`标记为已知 0` / `标记为将要学习 0` / `不学习 0`，文案「未找到项目.」，表格表头已渲染。

在账号中存在 **1 条已保存短语**后，`保存的短语` 页签真实渲染为：

```
标记为已知 0  |  标记为将要学习 1  |  不学习 0      ← 「用户标记」轴计数
/ 1                                            ← 标签筛选（无标签，1 条）

短语                 翻译                来源
2026年10月10日                                 ← 日期分组分隔行（实测存在）
Y en Panamá, un terremoto de magnitud 7.2 acudió el sureste del país, cerca de la costa del Pacífico.
在巴拿马，一场7.2级地震袭击了该国东南部，靠近太平洋海岸。
```

- 表头实测：`保存的短语` = `短语` / `翻译` / `来源`；`保存的单词` = `单词` / `翻译` / `上下文` / `来源`。
- **日期分组分隔行确实渲染**（`2026年10月10日`），证实 §5.1 的分组推断。
- 三个阶段计数是**「用户标记」轴的实时统计**，与 `getItems_5` 的 `countsPerStage` 一致（点击无写操作，纯筛选）。
- **重要澄清**：列表页上的六档阶段药丸与五态标签药丸是**筛选开关**，不是条目级写操作 —— 实测点击它们不发 `saveItem`/`bulkUpdate`。条目级的标签/阶段修改入口在 hover 词典或条目菜单（本次未定位，见 §8）。
- 两个 `搜索` 输入 + `来源` 下拉（`保存的单词` 页签）。
- 阶段药丸（六档）与标签药丸（无标签 + 四色）在各页签都渲染，`class` 含 `on` 表示开启。

### 3.4 该路由专用前端资源（静态推断）

抓取到该页专属 chunk，可据此推断功能区划：

| Chunk | 推断职责 |
|---|---|
| `SavedItems-*.js`（136 KB） | 页面主体、列表、分组、批量操作 |
| `SavedItemsFilterControls-*.js` | 筛选控件 |
| `IconExport-*.js` | 导出入口（导出文案见 `ui_strings/*.json` 的 `export*` / `anki*` / `csv*` 键） |
| `PhrasePumpDueChip-*.js` | 到期复习徽标 |
| `PageTabs-*.js` | 顶部页签（单词 / 短语） |
| `ImportTextModal-*.js`、`ImportTextStore-*.js` | 「导入文本」入口 |
| `ImageViewModal-*.js` | 上下文截图查看 |
| `Checkbox`、`FormControlLabel`、`Chip`、`Switch`、`LinearProgress`、`MobileSelect` | 多选、标签、开关、加载态、移动端下拉 |

---

## 4. 数据模型（LR 官方公开的权威定义）

LR 在 [`/help/export`](https://www.languagereactor.com/help/export) 公开了 `savedItem_EXPORT_t`。这是本文**最强证据**，因为它来自 LR 自己的文档而非逆向推断。

### 4.1 三种保存对象

| 保存方式 | 类型 | 是否带上下文 | 导出为卡片的形态 |
|---|---|---|---|
| 点字幕旁星号 | Phrase | 有 | — |
| 在字幕/词典例句中标记单词 | Word | **有**（连带保存时的上下文） | 呈现上下文，但**移除被标记的单词本身** |
| 直接在单词面板标记 | Word | **无** | 一面是释义，另一面是单词 |

### 4.2 `savedWord_EXPORT_t`

```ts
itemType: 'WORD'
langCode_G: string                 // 学习语言
translationLangCode_G: string      // 翻译语言
wordType: 'lemma' | 'form'         // 词元 or 具体词形
context: { wordIndex: number; phrase: phrase_EXPORT_t } | null
tags: string[]
learningStage: 'LEARNING' | 'KNOWN' | 'SKIPPED'
wordTranslationsArr: string[] | null
word: { text: string; translit?: string; pinyin?: string[]; tones?: number[] }
timeModified_ms: number
audio: itemAudio_EXPORT_t | null
freqRank: number | null
```

### 4.3 `savedPhrase_EXPORT_t`

```ts
itemType: 'PHRASE'
langCode_G / translationLangCode_G: string
tags: string[]
learningStage: 'LEARNING' | 'KNOWN' | 'SKIPPED'
context: { phrase: phrase_EXPORT_t }        // 短语必带上下文
timeModified_ms: number
audio: itemAudio_EXPORT_t | null
freqRank: number | null
```

### 4.4 `phrase_EXPORT_t` —— 三槽位结构（关键设计）

```ts
subtitleTokens: { 0: ud_single[] | null; 1: ud_single[]; 2: ud_single[] | null }
subtitles:      { 0: string | null;      1: string;      2: string | null }
mTranslations:  { 0: string | null;      1: string;      2: string | null } | null   // 机翻
hTranslations:  { 0: string | null;      1: string;      2: string | null } | null   // 人工翻译
reference: NF | YT | TEXT | VIDEO_FILE | DICTIONARY
thumb_prev / thumb_next: thumbImage | null            // 前后帧缩略图
```

三槽位 `0 / 1 / 2` 的含义是「上一句 / 当前句 / 下一句」，槽位 `1` 必填。这是一个**以句为上下文单位、自带前后文**的建模，比只存一句原文更利于复习时重建语境。

### 4.5 词元与词性

```ts
ud_single_EXPORT_t {
  form: { text: string; translit?: string; pinyin?: string[]; tones?: number[] }
  pos: 17 个 Universal POS 标签（ADJ/ADP/ADV/AUX/NOUN/PROPN/VERB/DET/SYM/INTJ/CCONJ/
       PUNCT/X/NUM/PART/PRON/SCONJ）+ '_'（未知）+ 'WS'（空白）
  index?, lemma?: {...}, xpos?, features?, pointer?, deprel?, freq?
}
```

即：LR 保存的不只是字符串，而是**带词性、词元与句法依赖标注的 token 序列**。

### 4.6 来源引用（`reference`）

| 来源 | 关键字段 |
|---|---|
| `YOUTUBE` | `channelId`、`ownerChannelName`、`langCode_YT`、`movieId`、`subtitleIndex`、`numSubs`、`startTime_ms`、`endTime_ms` |
| `NETFLIX` | `movieId`、`langCode_N`、`title`、`subtitleIndex`、`numSubs`、`startTime_ms`、`endTime_ms` |
| `TEXT` | `movieId`（未保存文本为 null）、`title`、`url` |
| `VIDEO_FILE` | `movieId`（字幕 md5）、`title`（文件名）、`subsFileName`、时间戳 |
| `DICTIONARY` | 仅语言，`title`/`movieId` 基本不用 |

注意 `startTime_ms` / `endTime_ms` 注释为「older items 可能没有」，说明该字段是后加的，LR 自己也做了兼容处理。

### 4.7 媒体附件

```ts
itemAudio_EXPORT_t {
  source: 'microsoft' | 'google' | 'movie'
  voice: string | null
  outputFormat: string        // 例如 'Audio24Khz48KBitRateMonoMp3'
  dateCreated: number
  dataURL: string
}
thumbImage_EXPORT_t { height: number; width: number; time: number; dataURL: string }
```

音频来源区分 **TTS（微软/谷歌）** 与 **影视原声（movie）**——这是一个值得注意的产品判断：跟读与听力复习优先用原声片段。

### 4.8 真实条目记录（最强证据：实测完整响应体）

以下是在所有者账号中保存 1 条短语后，`base_items_getItems_5` 返回的**真实完整记录**（10,693 字节，为节省篇幅省略了 tokens 明细）。它逐字证实了 §4.2–4.6 的公开 schema，**并补出了官方导出 schema 里没有的字段**。

#### 响应外壳与阶段计数

```json
{"status":"success","data":{
  "totalCounts":{"countsPerStage":{"LEARNING":1,"KNOWN":0,"SKIPPED":0},"currentTotalCount":1},
  "items":[ ... ]}}
```

#### 条目顶层字段（实测）

| 字段 | 实测值 | 官方导出 schema 是否有 |
|---|---|---|
| `key` | `"PHRASE-YT\|es\|b727589922c1ccc7"` | ❌ **新增**（稳定复合键：类型-来源\|语言\|hash） |
| `langCode_G` | `"es"` | ✅ |
| `translationLangCode_G` | `"zh-CN"` | ✅ |
| `learningStage` | `"LEARNING"` | ✅ |
| `tags` | `[]` | ✅ |
| `timeCreated_ms` / `timeModified_ms` | `1791634422803` | ✅（导出 schema 只有 `timeModified_ms`） |
| `freqRank` | `9151` | ✅ |
| `source` | `"YOUTUBE"` | ✅ |
| `itemType` | `"PHRASE"` | ✅ |
| `audio` | `null` | ✅ |
| `reviewData` / `reviewHistory` | `null` | ❌ **新增**（导出 schema 未含） |
| `ankiGuidKey` | `null` | ❌ **新增**（Anki 去重/幂等键） |
| `context` | `{ phrase: {...} }` | ✅ |

#### `context.phrase.reference`（实测，证实 `YT_reference_EXPORT_t`）

```json
{"tm":{"md5":"77aff44e69f4dfdbb0d5a8d9ff6316b6","name":"a.es","vssId":"a.es",
       "isFromASR":true,"langCode_G":"es","langCode_YT":"es",
       "isTranslatable":true,"isTranslatedTrack":false},
 "source":"YOUTUBE","savedFrom":"WEBTOOLS","diocoDocId":"yt_NbwJNoL9EoM",
 "startTime_ms":480,"endTime_ms":7200,"subtitleIndex":0,"refVersion":2,
 "diocoDocName":"Alerta de tsunami en el Pacífico tras terremoto en Panamá",
 "diocoPlaylistId":"t_yt_mix_es","diocoPlaylistName":"Reactor Mix",
 "youtubeChannelId":"UCT4Jg8h03dD0iN3Pb5L0PMA","youtubeChannelName":"DW Español"}
```

关键点：`tm.md5` + `vssId` **冻结了字幕轨版本**；`isFromASR:true` 标明该轨来自语音识别（不是人工字幕）；`refVersion:2` 是来源引用结构的版本号。导出 schema 里的 `channelId`/`ownerChannelName` 实测名为 `youtubeChannelId`/`youtubeChannelName`，且多了 `diocoDocName`/`diocoPlaylistId`/`diocoPlaylistName`/`savedFrom`/`refVersion`。

#### `context.phrase` 的三槽位（实测确认）

```json
"subtitles": {"0": null,
              "1": "Y en Panamá, un terremoto de magnitud 7.2 acudió el sureste del país, cerca de la costa del Pacífico.",
              "2": "El sismo al que siguieron decenas de réplicas ha provocado daños menores"},
"mTranslations": {"0": null,
                  "1": "在巴拿马，一场7.2级地震袭击了该国东南部，靠近太平洋海岸。",
                  "2": "这次地震随后引发了数十次余震，造成了轻微损坏"},
"hTranslations": null,
"thumb_prev": null, "thumb_next": null,
"subtitleTokens": {"0": null, "1": [ ...153 tokens... ], "2": [ ... ]}
```

**槽位 0 为 `null`**，因为这是视频的第一句字幕（没有上一句）——证实槽位 `0/1/2 = 上一句/当前句/下一句`，且槽位 1 必填、0 和 2 可为 null。

#### token 结构（官方 schema 未完整覆盖）

每个 token 实测字段：

```json
{"pos":"NOUN","form":{"text":"terremoto"},"form_norm":{"text":"terremoto"},
 "lemma":{"text":"terremoto"},"xpos":"NOUN",
 "feats":{"Gender":"Masc","Number":"Sing"},
 "deprel":"nsubj","pointer":10,"freq":3609,"diocoFreq":3609}
```

| 字段 | 说明 |
|---|---|
| `pos` / `xpos` | Universal POS（实测出现 `CCONJ`/`ADP`/`PROPN`/`PUNCT`/`DET`/`NOUN`/`NUM`/`VERB`/`ADV`/`PRON`/`AUX`/`ADJ`/`WS`） |
| `form.text` / `form_norm.text` | 表面词形与归一形 |
| `lemma.text` | 词元（`un`→`uno`、`la`→`el`、`acudió`→`acudir`、`decenas`→`decena`、`daños`→`daño`、`menores`→`menor`） |
| `feats` | UD 形态特征（Gender/Number/Mood/Tense/Person/VerbForm/Degree/PronType/AdpType/PunctType/NumForm…） |
| `deprel` + `pointer` | 句法依存关系与指向的 token 索引 |
| `freq` / `diocoFreq` | 词频排名（数值）**或**分类标记：`"PUNCT_PLUS"`（空白/标点）、`"PROPN_PLUS"`（专名）、`"DIGITS_NUMBERS"`（数字） |

注意 `pos:"WS"` 的空白 token 也在序列里 —— 即 **token 序列保留原始间距**，不是只保留实词。

#### 词频排名可直接用于选词

实测 `freqRank: 9151`（短语整体）与逐 token 排名（`el`=1、`y`=10、`terremoto`=3609、`sureste`=9151、`sismo`=21048）可直接驱动「按词频排序/分档」。`freq: 0` 配 `diocoFreq: "PROPN_PLUS"` 表示专名不参与普通词频计数。

---

## 5. 功能清单（静态推断 + 公开文案）

### 5.1 排序与分组（推断部分见 §5.4 的实测修正）

| 功能 | 枚举/文案 | 证据 |
|---|---|---|
| 排序方式（整体） | `Sort by Date` / `Sort by Frequency` / `Sort by Due Date` | `sortByDate`、`sortByFrequency`、`sortByDueDate` |
| 排序值 | `TIME`、`FREQ`、`NEXT` | chunk 内 `value:"TIME"/"FREQ"/"NEXT"` |
| 方向 | `*_ASC` / `*_DESC`（如 `FREQ_RANK_DESC`、`TIME_CREATED_DESC`、`NEXT_REVIEW_ASC`） | chunk 内 Literal |
| 单词页签内排序 | `FREQ`（词频）/ `ALPHABETICAL`（字母） | `alphabetical`、settings `savedItemsAllWordsSort` |
| 按日期分组 | 以 `timeCreated_ms` 分日期段，插入 `isDivider` 分隔行 | chunk `vu()` |
| 按词频分组 | 按 `freqRank` 分档，插入 `isFreqDivider`，显示 `rank X - Y` | chunk `yu()`、`rank` 文案 |
| 按到期分组 | 七档：`OVERDUE`、`TODAY`、`TOMORROW`、`NEXT_7_DAYS`、`NEXT_30_DAYS`、`LATER`、`NO_DUE_DATE` | chunk `bu()` + `due_*` 文案 |

排序偏好持久化在设置中（`settings.savedItemsAllWordsSort`）。

### 5.2 筛选

| 功能 | 依据 |
|---|---|
| 关键词搜索 | `searchText`、`search` 文案 |
| 学习阶段筛选（带计数） | `KNOWN` / `LEARNING` / `SKIPPED`，且分别统计 `MARKED` 与 `PREDICTED` 数量（`MK/PK/ML/PL/MS/PS`） |
| 标签筛选（含 `NO_TAG`） | `tags`、`noTag` |
| 来源筛选（分组下拉） | `renderGroup` 中 `group === "SOURCE"`；`sources_heade[r]` 文案；chunk 内 `source` 比较分支 |
| 清空筛选 | `clearFilters_GT` |

### 5.3 条目内展示字段

| 字段 | 文案/证据 |
|---|---|
| 条目文本 + 逐 token 渲染 | `MARKED_WORDS_MODE` 样式、`tokens:[...]` |
| 原文上下文 | `context`、`showContext_GT` |
| 翻译（机器 / 人工） | `machineTranslations`、`humanTranslations`、`showHumanTranslation_label` |
| 词频排名 | `rank`、`languageRank_GT`、`countInVideo_GT` |
| 学习阶段 | `learningStage`、`setLearningStage` |
| 标签（无标签 + 四色） | 位图图标 `data-underline-color="C0..C3"`，`tag===0` 显示 `-`，`1..3` 显示 `#`；实测四色值见 §5.4 |
| 来源 | `source`、`sentenceOrTextSource`、`titles_header` |
| 到期临界度色标 | `CRITICAL` / `NORMAL`，基于 `reviewData.ebisuModel` + `latestReview_unixms` 计算出的半衰期 |
| 播放按钮 | `speakWord` / `speakSavedItem` |

### 5.4 排序、阶段与标签（登录后已实测）

**实测环境**：项目所有者本人账号，学习语言西语，界面中文，浏览器可见窗口手动登录后由 Playwright 只读探测。**该账号已保存项目为 0 条**，因此「列表内容」类结论仍受限（见 §8），但页面控件与导出面板为真实渲染。

#### 排序（`aria-pressed` 已实测）

| 控件 | `value` | 默认 |
|---|---|---|
| 排序方式: 频率 | `FREQ` | **选中**（`aria-pressed=true`） |
| 排序方式: 按字母顺序 | `ALPHABETICAL` | 未选中 |

排序状态持久化在 `settings_v1.savedItemsAllWordsSort`（实测值 `"FREQ"`），列表排序持久化在 `savedItemsListSort`（实测值 `"TIME_CREATED_DESC"`）。

#### 学习阶段六档（实测 `aria-label`）

关键发现：**六档不是单一维度，而是「来源 × 阶段」两轴**，与我在 chunk 分析中推断的 `MARKED` / `PREDICTED` 完全一致：

| 档位 | `aria-label` | 轴 |
|---|---|---|
| 已掌握 | 已掌握 — **你标记的** | MARKED |
| 自动 | 自动 — **根据你的词汇量水平预测** | PREDICTED |
| 学习中 | 学习中 — 你标记的 | MARKED |
| 建议 | 建议 — 根据你的词汇量水平预测 | PREDICTED |
| 不学习 | 不学习 — 你标记的 | MARKED |
| 罕见 | 罕见 — 根据你的词汇量水平预测 | PREDICTED |

即 LR 把「用户显式标记」与「按词汇量水平预测」并列为两个独立来源，各自可独立筛选；持久化结构实测为：

```json
"savedItemsAllWordsStageFilter": {
  "KNOWN":    {"MARKED": true, "PREDICTED": true},
  "LEARNING": {"MARKED": true, "PREDICTED": true},
  "SKIPPED":  {"MARKED": true, "PREDICTED": true}
}
```

#### 标签四色（实测十六进制值，修正静态推断）

| `aria-label` | 实测颜色 |
|---|---|
| 无标签 — 点击显示/隐藏 | `#fff` |
| 绿色 | `#38ad00` |
| 黄色 | `#ddff00` |
| 红色 | `#ff6658` |
| 蓝色 | `#67e6ff` |

**修正**：chunk 分析曾推断「标签四态 = 0-3 三色 + 无色」，实测是**四色 + 无标签**共五态。UI 上四个 `#` 药丸都渲染，但每行数据里 `tag` 值的实际写入范围未验证。

### 5.5 到期与复习调度（部分实测）

```ts
reviewData: { ebisuModel, latestReview_unixms, halflife_days, ... }
```

- 采用 **Ebisu 模型**（`ebisuModel`）做逐条记忆调度，暴露 `halflife_days`（文案「记忆半衰期（天）」）。
- 临界度：`halflife < su ? CRITICAL : (halflife < ou ? NORMAL : 正常)`。
- 到期分桶见 5.1。
- 消费端是 **PhrasePump**：`itemsDueForReview`、`dueForReview`、`markedToLearnDesc`、`pleaseMarkMoreItemsOrWait`。

### 5.6 标签

- **实测为五态**：无标签 + **四色**（绿 `#38ad00` / 黄 `#ddff00` / 红 `#ff6658` / 蓝 `#67e6ff`）。静态推断曾误判为 0-3 三色，见 §5.4 的修正说明。
- 颜色在 UI 上以四个 `#` 药丸渲染，可逐个开关；无标签显示为 `/`。
- 可自定义显示名：`getTagNameForDisplay(1|2|3)`。
- 标签有**独立导出**能力：「标签的单词可以单独导出」（`addTagToAWordDesc`），且导出对话框的「标记」是**多选**筛选器。
- 可在文本中以下划线形式显示：`showTagsInText`、`data-underline-color`。
- 沿革（`up1`）：早期的「红/绿/黄/蓝颜色保存」被重命名为「标签」，显示为下划线——与实测的四色完全吻合。

### 5.7 批量操作

| 操作 | 证据 |
|---|---|
| 选择模式 + 当前选中数 | `selectedItemKeys`、`xSelected`（「已选择 &lt;text&gt;」） |
| 全选 / 取消全选 | `selectAllOrNone` |
| 批量设置学习阶段 | `setSelectedItemsLearningStage`；条目数 > 4 时先弹确认框（`thisWillAffectXItemsAreYouSure`） |
| 批量设置标签 | `setSelectedItemsTags` |
| 批量移除 | `removeSelectedItems`；`removeItems`、`removeAllItems` |
| 操作反馈 | `itemsRemoved`、`itemsUpdated`、`removingItemsFailed` |

### 5.8 导出（登录后已实测）

点击 `导出` 打开模态框，**实测确认未被 Pro 限制**（免费账号可直接打开并配置；是否真的生成文件因账号为空未验证）。

#### 五种格式 = 五个页签

`ANKI` / `PRINT` / `EXCEL` / `CSV` / `JSON`

#### 五个筛选器（选项列表已实测枚举）

| 筛选器 | 类型 | 实测选项 | 默认 |
|---|---|---|---|
| 语言 | 单选 | 所有语言 / 西班牙语 | 西班牙语 |
| **项目类型** | 单选 | **所有类型 / 短语 / 词语** | 所有类型 |
| 首选翻译 | 单选 | 机器翻译 / 人工翻译 | 机器翻译 |
| 学习阶段 | 单选 | 学习中 / 已掌握 / 不学习 | 学习中 |
| 标记 | **多选** | 无标签 / 绿色 / 黄色 / 红色 / 蓝色 | 全部 |

注意「项目类型」只有 **短语 / 词语** 两项——这是 LR 三分法在导出层的投影（带/不带上下文由 `context` 是否为 `null` 表达，不单列为一种类型）。

操作按钮：`关闭` / `导出`。

#### 五种格式的真实产物（**已实测下载并解析**）

会话恢复后，五种格式**全部成功生成并下载**。导出确为**服务端生成**：每次点击都伴随对应的 RPC 且返回 200。

| 格式 | RPC | 响应体 | 产物文件名 | 实测产物大小 |
|---|---|---|---|---|
| JSON | `base_export_itemsJsonExport_6` | 114,963 | `lln_json_items_<date>_<rand>.json` | 86,107 |
| CSV | `base_export_itemsCSVExport_7` | 76,809 | `lln_csv_items_<date>_update_<rand>.zip` | 57,480（**zip**） |
| EXCEL | `base_export_itemsExcelExport_6` | 10,022 | `lln_excel_items_<date>_<rand>.xlsx` | 7,358 |
| PRINT | `base_export_itemsPrintExport_6` | 5,325 | `lln_print_items_<date>_<rand>.html` | 3,878 |
| ANKI | `base_export_getAnkiPackage_7` | 186,295 | `lr_anki_package_<date>_update_<rand>.apkg` | 139,536 |

文件名约定（实测）：JSON/EXCEL/PRINT 为 `lln_<fmt>_items_<YYYY-MM-DD>_<rand>.<ext>`；CSV/ANKI 额外带 `_update_` 段（对应「仅新增条目」的增量导出）。带 `_update_` 与不带，可能分别对应「全量 / 增量」，未逐项验证。

##### JSON：顶层是**数组**，且**内联 TTS 音频**

实测产物是**顶层 JSON 数组**（不是 `{items:[…]}` 包装），每条为一对象。条目字段与 §4.8 的服务端记录**完全一致**，唯一差异是 `audio`：

```json
"audio": {"voice":"es-MX-GerardoNeural","source":"microsoft",
          "dataURL":"data:audio/mpeg;base64,//NkxAAb+oIAAjBGJCkzwuiBBEAfXd+oXECACEeHAwN3d0LKmiFXNC/9Pc..."}
```

- 服务端条目记录里 `audio` 是 `null`，**导出时才按需生成 TTS 并内联为 base64 dataURL**。这解释了为何 JSON 导出 86 KB 而条目记录仅 10 KB。
- 音色实测为 `es-MX-GerardoNeural`，`source: "microsoft"` —— 证实 §4.7 的 `itemAudio_EXPORT_t` 是在**导出阶段**填装的，不是保存时就有。
- 也解释了 `base_items_getSavedItemTTS` 端点的存在意义。

##### CSV：不是裸 CSV，是 **zip（CSV + 媒体文件）**

实测 zip 成员：

| 成员 | 大小 |
|---|---|
| `media/` | 0 |
| `media/1791634422803.mp3` | 56,448 |
| `items.csv` | 706 |

`items.csv` 为**制表符分隔**（与官方文档一致），媒体文件名以 `timeCreated_ms` 命名并与 CSV 末列对应。行内含多行上下文（用引号包裹），即**上下文是换行拼接的前后句**。

CSV/Excel 实测表头 **20 列**（官方文档列的是 23 项，实测不含 `Previous Image media filename` / `Next Image media filename` / `Audio clip media filename` 三列，它们改由 zip 内媒体文件承载）：

`Item key`、`Item type`、`Subtitle`、`Translation`、`Word`、`Lemma`、`Part of speech`、`Tags`（**CSV 中为 `Color`**）、`Word definition`、`Source`、`Language`、`Translation language`、`Word transliteration`、`Phrase transliteration`、`Subtitle index`、`Video ID`、`Video title`、`Date created`、`Context`、`Context machine translation`、`Context human translation`

> **注意**：Excel 表头第 8 列为 **`Tags`**，而官方 CSV 文档与 CSV 产物中是 **`Color`** —— 两个导出器对同一概念用词不同，属 LR 自身的不一致。

##### EXCEL：单 sheet + sharedStrings

成员为标准 OOXML（`xl/worksheets/sheet1.xml` + `xl/sharedStrings.xml` 等），共享字符串 34 项（20 表头 + 14 数据）。

##### PRINT：HTML 表格，**不含音频**

输出为自包含 HTML，内嵌字幕样式类（`dc-up`、`dc-translation`、`dc-layer`、`dc-gap`、`dc-lang-<code>.dc-orig` 等，含按语言的字号规则）。实测**不含 base64 音频**。按章节分段（`section-header`），实测有 `Phrases` 段。

##### ANKI：旧式 11 表 schema + Cloze 卡片

`.apkg` 实测为 zip：`collection.anki2`(65,536) + `0`(56,448，即音频) + `1`(17,117) + `media`(63)。Anki 库表为 `col/notes/cards/revlog/graves/sqlite_stat1/sqlite_stat4` —— **旧式 schema，无 `notetypes` 表**。

笔记类型实测名为 **`Language Reactor - Phrase`**，**19 个字段**：

`Cloze`、`Item Key`、`Subtitle`、`Translation`、`Color`、`Source`、`Language`、`Translation Language`、`Phrase Transliteration`、`Subtitle Index`、`Item ID`、`Item Title`、`Date Created`、`Date Modified`、`Context`、`Context Translation`、`Prev Image`、`Next Image`、`Audio Clip`

卡片模板实测为 **Cloze 挖空**，且**当前句 + 下一句都进卡**：

```html
<br><br>{{c1::Y en Panamá, un terremoto de magnitud 7.2 acudió el sureste del país, cerca de la costa del Pacífico.::<span class="dc-hint">在巴拿马，一场7.2级地震袭击了该国东南部，靠近太平洋海岸。</span>}}<br><br>El sismo al que siguieron decenas de réplicas ha provocado daños menores
```

音频以 Anki 媒体引用内嵌：`[sound:71A920000608096407AFAFC78BB3C438.mp3]`。

> 这证实了 §4.1 的官方说明「导出为 Anki 卡片时**上下文会呈现，但被标记的单词会被移除**」—— Cloze 把当前句挖空，译文作为 hint，下一句作为额外上下文。

#### 服务端导出接口

```
/base_export_getAnkiItems_7      /base_export_getAnkiPackage_7
/base_export_itemsCSVExport_7    /base_export_itemsExcelExport_6
/base_export_itemsJsonExport_6   /base_export_itemsPrintExport_6
```

六个端点中实测触发了五个（`getAnkiItems_7` 未触发，`getAnkiPackage_7` 是 ANKI 页签实际调用的那个）。

### 5.9 页面级状态与限制

| 状态 | 文案 |
|---|---|
| 空列表 | `noSavedItems`（没有已保存的项目） |
| 加载失败 | `savedItemsList_failedToGetItems`、`savedItemsAllWords_failedToGetWords` |
| 保存失败 | `savedItemsStore_errorSavingItem` |
| 更新失败 | `savedItemsStore_errorUpdatingItemsFailed` |
| 删除失败 | `savedItemsStore_errorFailedToRemoveItem` |
| **条目上限** | `savedItemsStore_errorTooManyItems`（「已达到允许保存的项目数量」，具体数值未验证） |
| 跨语言提示 | `youAlsoHaveItemsInOtherLanguages`（其他语言也有保存内容，需在设置中切换语言查看） |
| 过期数据 | `latestReview_unixms`、`timeModified_ms` |

---

## 6. 与 Sueño 当前实现的逐项对照

### 6.1 我们的实现现状（已核实）

**A. `/read/vocabulary` 有四个视图**（`app/(product)/read/vocabulary/page.tsx`，`view` 参数）

| 视图 | 数据来源 | 关键文件 |
|---|---|---|
| `study`（默认） | 已审核西中词汇表 `listStudyVocabularyWords()` | `src/modules/reading/domain/study-vocabulary.ts`、`ui/vocabulary-study-list.tsx` |
| `frequency` | 语料词频聚合 | `listFrequencyWords()` |
| `saved` | 文章阅读器标注（phrase / highlight） | `src/modules/reading/domain/saved-items.ts` |
| `lexicon` | 正式词元表 | `listVocabulary()`、`ui/vocabulary-library.tsx` |

**B. 三套彼此独立的「词句状态」**

1. `study` 视图：**浏览器 localStorage**（`sueno:vocabulary-status:v1:<scope>`），三态 `familiar` / `revisit` / `ignore`，跨设备不同步。
2. `lexicon` 视图：服务端 `user_lexical_intents` 表，`intent in ('familiar','revisit','ignore')`，带 `revision` 做 CAS（`src/shared/db/schema/lexicon-corpus.ts:95-109`）。
3. `saved` 视图：`user_article_highlights` 表（`src/shared/db/schema/reading.ts:117-148`）的投影，`itemType in ('phrase','highlight')`，**无任何状态字段**（无学习阶段、无标签、无到期）。

### 6.1.1 已核实的排序行为（全部服务端硬编码，UI 不可选）

| 列表 | 实际 ORDER BY | 位置 |
|---|---|---|
| `saved` 书架 | `created_at DESC, id DESC` | `drizzle-reading-repository.ts:316` |
| `lexicon` 词元 | `asc(normalized_lemma)` | `drizzle-lexicon-corpus-repository.ts:271` |
| 短语 | `desc(updated_at)` | `:337` |
| 高频词 | `count DESC`，并列用 `localeCompare('es')` | `:56` |
| 语料检索 | `desc(created_at)` | `:429` |

三个 query schema（saved / vocabulary / phrase / corpus）**都没有 `sort` 字段**；`saved` 书架的「按最近保存排序」是硬编码文案（`saved-items-library.tsx:192`）。

**C. 服务端已具备的能力**

- `corpus_occurrences`：`documentKind`、`documentStableKey`、`documentVersion`、`sourcePosition`(jsonb)、`surfaceText`、`contextBefore`、`contextAfter`、`sourceTitle`、`sourceKind`（`lexicon-corpus.ts:69-93`）。**已能定位回原文段落或媒体时间戳**。
- `lexeme_forms`：词形归一（`normalizedSurface`）。
- `lexemes`：`partOfSpeech`、`lemmaStatus`（verified/pending）、`meaningZh`、`cefr`、`region`。
- `phrase_entries`：`pragmaticPurpose`、`register`、`region`、`cefr`、`reviewStatus`、`ownerUserId`。
- `/lexicon/intents/{entryId}`：PUT + `expectedRevision` 乐观并发（`contracts/openapi/v1/openapi.json:687-699`）。
- `/corpus/search`：KWIC 上下文检索，支持 `entryKind` / `entryId` / `documentKind` / `sourceKind`。
- 词句文字考察：`lexical_assessment_items` / `lexical_assessment_attempts`。

**D. 我们已有、LR 没有的**

- CEFR 与语域 / 地区 / 语用目的等教学元数据。
- 语料 KWIC 检索与回到原文/原片段的深链。
- 服务端 CAS 的学习状态（优于 LR 的客户端状态）。
- 不要求口头作答的词句文字考察闭环。
- 明确的能力证据边界（书架操作不写 `evidence_events`）。

### 6.2 差距对照表

| 能力 | Language Reactor | Sueño 现状 | 判定 |
|---|---|---|---|
| 保存对象分类 | 短语 / 带上下文词 / 无上下文词 | `phrase` / `highlight`，**无 `word` 类型**（单词也存进 `phrase` 桶） | **需调整**（缺「无上下文词」，且单词与短语不可区分） |
| 单词保存入口 | 字幕、词典例句、单词面板 | 仅文章阅读器 | **需新增**（媒体端保存） |
| 词元归一 | `wordType: lemma \| form` | `lexeme_forms` 已归一，但保存时未冻结是哪一种 | **需调整** |
| 上下文冻结 | 完整 `phrase` 三槽位 + tokens | `contextBefore/After` 由查询时实时读取 | **需调整**（版本变化时语义会漂移） |
| 前后句 | 槽位 0 / 2 | 无 | **需新增** |
| 词性标注 | 17 个 Universal POS + 句法依赖 | `partOfSpeech`（词元级，单一字符串） | **部分具备**，token 级缺失 |
| 词频 | `freqRank` + 分组 + 排序 | 有 `frequency` 视图与聚合，但**无 `rank` 列**，排名由数组下标推出（`vocabulary-word-grid.tsx:49`） | **部分具备**，未进入书架排序/分组 |
| 排序 | 日期 / 词频 / 到期（含升降序） | 词元按 `normalizedLemma` 升序、短语按 `updatedAt` 降序，**UI 不暴露排序** | **需新增** |
| 分组分隔行 | 日期 / 词频档 / 到期档 | 无 | **需新增** |
| 到期与复习调度 | Ebisu + `halflife_days` + 七档分桶 | **词句域无任何调度**（仅场景域有 `scenario_repetition_items`） | **需新增（需设计与 ADR）** |
| 到期徽标 | `PhrasePumpDueChip` | 无 | **需新增** |
| 标签 | 无标签 + 四色、可命名、单独导出、文本下划线、导出多选筛选 | 无 | **需新增** |
| 批量操作 | 选择 / 全选 / 批量阶段 / 批量标签 / 批量移除 | 无（仅单条 PUT 与单条 DELETE） | **需新增** |
| 导出 | Anki `.apkg` / CSV(23 字段) / JSON / Excel / 增量 | 仅阅读书架「导出当前页 CSV」 | **需新增** |
| 音频 | 微软/谷歌 TTS + **影视原声片段** | 浏览器 TTS（`study` 视图有朗读） | **部分具备**，无原声片段 |
| 上下文截图 | `thumb_prev` / `thumb_next` + `ImageViewModal` | 无 | **需新增（可选）** |
| 来源筛选 | 有（分组下拉） | 仅有 `sourceKind`（corpus API），书架 UI 无来源筛选 | **需新增** |
| 阶段筛选带计数 | `MARKED`/`PREDICTED` 分别计数 | 仅单选 intent 筛选 | **需调整** |
| 页签（词/短语） | 独立页签 | `/read/vocabulary` 与 `/read/phrases` 分页 | **已具备（形式不同）** |
| 搜索 | 有 | 有（`search`，lexeme 支持 lemma 与词形 ILIKE） | **已具备** |
| 分页 | 有 | 有（pageSize ≤ 50，默认 24） | **已具备** |
| 条目上限 | 有（数值未验证） | 无 | 暂不需要 |
| 跨语言提示 | 有 | 无（单语 es） | 暂不需要 |
| 设备同步 | 依赖账号 | `lexicon` 服务端同步；`study` **仅本机 localStorage** | **需调整**（study 状态应上服务端） |
| 学习状态存储 | 客户端为主 | 服务端 CAS（更严格） | **我们更优，保留** |
| 能力证据边界 | 无此概念 | 明确不写 `evidence_events` | **我们更优，保留** |

---

## 7. 建议新增与调整的功能清单

以下按依赖关系排序，**各项都需先走设计/ADR，本文不授权直接实施**。

### 7.1 需要先做决策的前提（阻塞项）

| # | 决策 | 为什么必须先决定 |
|---|---|---|
| D1 | 词句书架要不要引入**到期/复习调度** | 一旦引入，`mastery`/`confidence` 分离、阅读不产生负面口语证据等不变量都需要重新表述；且要决定是复用 `scenario_repetition_items` 模式还是新建词句调度表 |
| D2 | 「保存」的语义边界 | 我们现有三套状态（localStorage study / `user_lexical_intents` / `saved_reading_items`），必须先统一到一套，否则新增排序、筛选、导出会各自叠加三份 |
| D3 | 上下文是否**冻结到保存时刻** | 影响 schema 与数据迁移；`corpus_occurrences` 指向的内容版本可能被撤下 |
| D4 | 导出是否越过「未授权复制第三方内容」边界 | Anki 卡片含上下文原文与音频片段，须先确认与来源许可、平台条款的关系 |
| D5 | 词频表数据从哪来 | 我们现在的 `frequency` 视图是从**自己已发布内容**统计（600 词头上限、10 分钟缓存）。LR 用的是**语言词典**（8000 词/语言，匿名可读）。要不要引入外部词频表，决定「建议词」是否有依据 —— 见 §7.2 第 11 项 |

### 7.2 新增（按价值/成本排序）

1. **统一词句书架入口与状态模型**（依赖 D2）：把 `study` / `saved` / `lexicon` 收敛到一条主列表，保留现有 `intent` 三态并统一为服务端权威。
2. **排序**：日期 / 词频（依赖 `freqRank` 落库）/ 到期（依赖 D1），含升降序。
3. **分组分隔行**：按日期分段；有词频则按词频档。
4. **标签**：复用 `phrase_entries` 已有的 `pragmaticPurpose` / `register` 思路，新增用户私有标签表；支持按标签筛选与单独导出。
5. **批量操作**：多选、全选、批量改 intent、批量加标签、批量移除（>4 条弹确认）。
6. **保存「无上下文的单词」**：补上作品集三分法的第三类，让词典/单词面板也能直接保存。
7. **上下文冻结**：保存时写入 `surfaceText` + 前后句 + 内容版本，不再依赖实时查询。
8. **媒体端保存入口**：`/learn/media/[stableKey]` 目前不能保存词语，需与文章阅读器对齐。
9. **导出**：先做 **JSON**（字段可自证、易测试），再评估 CSV 扩展与 Anki；Anki 需单独评估 `.apkg` 生成依赖与许可。
10. **到期徽标与复习队列**（依赖 D1）。
11. **原声音频片段**（依赖 D1 与媒体资产授权）。
12. **独立词频表视图**（依赖 D5）：新增一个不依赖用户内容的词表层，按词频排名分档展示，用于「下一个该学什么」。可先以 LR 的匿名词典（§3.2）或公开词频表为数据源做**离线**导入，落到 `lexemes.freq_rank` 列；不引入外部运行时依赖。注意我们的 `frequency` 视图是**内容语料统计**，与此用途不同，两者不应混为一谈。
13. **词表与收藏共用页签壳层**：LR 把「全语言词表」和「我的收藏」放在同一路由的三个页签下。这个结构值得借鉴（一个入口，两个数据源），但**门禁必须分别判断** —— 我们若采用，要明确哪个页签允许未登录访问。目前我们不接受未登录访问阅读货架，是否要开一个公开词表页需产品确认。
14. **token 级语言学数据（差距最大的一项）**：LR 的保存条目冻结了完整 NLP 分析（`pos`/`lemma`/`feats`/`deprel`/`pointer`/`freq`，含空白 token），见 §4.8。我们现在只有 `partOfSpeech` 这一个词元级字符串。若要支持「按词性/依存筛选上下文」「同词元跨内容高亮」「词频分档」，需要在索引阶段把 token 级分析落库。**这项成本最高，且涉及 `lexicon-corpus` 与 `reading` 两个模块的边界，必须先走设计。**

### 7.3 我方已核实的具体缺陷（**已于 `READ-SHELF-001` 修复**）

> **状态更新（2026-10-10）**：下表中 B1–B6 **已全部修复并验证**，见 `docs/tasks/READ-SHELF-001.md`。验证：`tsc --noEmit` exit 0、聚焦 Vitest 13 文件 / 63 测试通过、改动文件 ESLint exit 0、Playwright `lexicon-library.spec.ts` 6 passed（桌面+移动）。
>
> 但同一轮发现一个**优先级更高的阻塞**：整个词句语料管道在生产为空（`corpus_occurrences` 等 5 张表全 0 行），因为 `indexContentVersion` 零调用方 —— **B3 的修复在生产不会显示任何东西**。详见该任务页的「阻塞发现」。

以下均由代码核对确认，不依赖任何新增产品决策：

| # | 缺陷 | 证据 | 影响 |
|---|---|---|---|
| B1 | 高频词网格的学习状态筛选链接**不产生筛选效果** | `vocabulary-word-grid.tsx:52` 生成 `/read/vocabulary?intent=xxx`，缺 `view` 参数 → `page.tsx:46` 回落到 `study`，而 study 列表只接收 `words`/`storageScope`（`:128`），**从不读取 `intent`** | 用户点击筛选后看起来无变化 |
| B2 | 「保存的短语」标签指向**公共短语库**而非已保存短语 | `vocabulary-word-grid.tsx:47` → `/read/phrases`；同一文件 `:46` 的「保存的单词」正确地指向 `/read/saved-items?itemType=phrase` | 标签与目标不符 |
| B3 | 高频词详情面板的 `context` / `sourceTitle` **恒为 null** | 仓库层硬编码 `drizzle-lexicon-corpus-repository.ts:246-247`；单测直接喂数据所以掩盖了该问题（`tests/unit/vocabulary-word-grid.test.tsx:14-25`） | 生产环境永远显示「释义待补充」且无上下文/来源 |
| B4 | 语料检索页**没有分页控件**，尽管 API 支持 | `corpus-search.tsx:35-40` 表单不发送 `page`/`pageSize` | 结果超过一页时无法继续查看 |
| B5 | 同一个三态枚举存在**两套不一致的中文文案** | 服务端：已熟悉 / 想复现 / 暂不学习（`lexicon-shelf-controls.tsx:5-11`、`vocabulary-library.tsx:9-13`）；本机：已掌握 / 学习中 / 不学习（`vocabulary-study-list.tsx:28-34`） | 同一含义两种说法，跨页面认知负担 |
| B6 | `VocabularyWordGrid` 的 `saved` 字段**无任何赋值来源** | 网格项构造处恒为 `saved: false`（`app/(product)/read/vocabulary/page.tsx:109-117`） | 「查看保存记录」入口实际不可达 |

### 7.4 调整

1. `study` 视图的 localStorage 状态改为服务端同步（当前换设备即丢失，且与 `lexicon` 重复）。
2. `saved_reading_items` 的 `itemType` 从 `phrase | highlight` 扩展为可表达「带上下文的词 / 无上下文的词」，或明确它只是阅读标注、与词句书架解耦（二选一，需在设计中写明）。
3. 词句书架增加**来源筛选**（目前只有 API 层 `sourceKind`，UI 未暴露）。
4. 学习状态筛选增加计数。

### 7.5 明确不建议照搬

| LR 做法 | 不建议原因 |
|---|---|
| 词频作为书架主轴 | 与既有决定一致：词频只作选材与解释信号，不能主导首页或覆盖语境成功（`docs/adr/0008`） |
| 「看过/标记过」即视为掌握 | 与我们 `mastery` / `confidence` 分离不变量冲突 |
| 客户端保存学习状态 | 我们已有服务端 CAS，回退是退步 |
| 图文密集、多入口并列的页面 | 与 `UI-014` 已确认的密度收敛方向冲突 |
| 直接复制 LR 的截图、音频或第三方字幕内容 | 来源与许可边界（`AGENTS.md` 第 8 节） |

---

## 8. 已知限制

1. LR 侧结论现在**分三个证据层**：匿名实测（三页签结构与门禁差异、西语词典响应体）、登录后实测（真实条目完整记录、列表渲染、查询控件与枚举、导出对话框、六档阶段与两轴语义、标签颜色）、静态推断（调度机制、导出文件内容、条目级写入口）。凡标「静态推断」者，字段名可信度高（有官方 schema 佐证），但交互顺序与边界行为未验证。
2. **样本量导致的缺口**：所有者账号原本为 0 条，本轮仅保存 **1 条**用于验证。因此「排序在多项数据上的真实顺序」「日期/词频/到期分组的实际分组效果」「删除级联」「条目级标签与阶段写入」四项**仍无充分证据**。这不是方法问题，是数据前提问题。
3. 未验证：条目上限数值、调度算法更新规则（`reviewData` 实测为 `null`）、导出产物的真实内容（点击「导出」未触发 download 事件）。
4. **已解决**：页签切换机制（`enabledTabs: ["ALL_WORDS","WORDS","PHRASES"]` + `settings_v1.savedItemsActiveTab`）；条目级标签/阶段药丸的语义已澄清为**筛选开关**（非写操作）。
5. 我曾用页面上下文直连 `api.dioco.io` / `api-cdn.dioco.io` 的 `base_export_*`、`base_items_*` 端点，得到 `TypeError: Failed to fetch`。原因是应用 SDK 的传输层无法被我的裸 `fetch` 复现。**我没有绕过该边界**，也没有伪造调用。注意：`base_dict_getAllWordsForLang` 是**匿名**端点，用 `credentials: omit` 可正常读取（§3.2），二者不同。
6. 我们侧的实现描述经过**两轮独立核对**：一次由本文作者直读代码，一次由独立子代理做只读审计（覆盖全部词句路由、模块、schema、契约与测试），两轮结论一致；文档交叉核对确认 `docs/architecture.md:229,231-237` 与实际代码相符。审计基于 2026-10-10 的工作树（分支 `codex/disable-legacy-readlang`），该分支存在其他会话的未提交改动，`saved` / `vocabulary` 相关文件可能仍在变动。
7. 本文未修改任何产品代码、未调用收费 provider、未写入任何数据库。
8. **对所有者账号的实际影响（必须披露）**：为验证而**真实保存了 1 条短语**（西语新闻视频 `yt_NbwJNoL9EoM` 的第 1 句字幕，`learningStage=LEARNING`，无标签），期间另有一次保存被脚本重复激活而删除并恢复了空态。当前账号状态为 **1 条已保存短语**。所有者可在 `保存的短语` 页签直接删除，不留残余。
9. 本文早前有一处**结论性错误**（未登录可见性），已在 §1.5、§3.2 显式更正并留档方法学教训，未静默改写。
10. **会话生命周期约 40 分钟**（实测：20:11 登录，21:04 仍可读，21:18 已回落登录态）。对自动化的三点影响：
    - `storageState()` 既然不包含 IndexedDB，**每次跨会话复现都必须重新人工登录**；
    - 任何超过约 40 分钟的探测流程会在中途失去凭据，且**失败表现是「按钮找不到」而非「401」**，极易被误判为定位问题（本文即发生过一次）；
    - 建议探测脚本在每次关键动作前先断言「页面含 `注销`」，断言失败就明确报「会话过期」而不是继续找元素。
11. **会话可在无人工干预下恢复（已实测跑通）**。凭据确实还在 IndexedDB 的 `firebaseLocalStorageDb` → `firebaseLocalStorage` 记录里（`apiKey` 与 `stsTokenManager.refreshToken` 完好，仅 `accessToken` 过期）。恢复方法是把凭据交给**主机侧** `.NET` 通道、经本机代理换取新 ID token，再写回 IndexedDB：

    1. 从 IndexedDB 读出 `apiKey` / `refreshToken`，写到仓库外的临时文件（不打印、不落库）；
    2. `Invoke-WebRequest -Method POST -Proxy http://127.0.0.1:7897` 打 `securetoken.googleapis.com/v1/token`，返回 **HTTP 200**；
    3. 把新 `id_token` 与新 `expirationTime` 写回 IndexedDB 的 `stsTokenManager`；
    4. 重新打开 `/saved-items`，`注销` 出现、`请登录以使用此功能` 消失 → 会话恢复。

    **教训（此前我在此处判断错了两次）**：
    - 先误判为「本机到 Google 完全不通」。实际上**直连确实不通**（`curl` 与 Chromium 均 `000`），但**经代理 `127.0.0.1:7897` 是通的** —— 同一端点经 `.NET` 通道返回 HTTP 200（用假 key 测时返回 404，也是真实响应）。
    - 又误判为「Chromium 走代理即可」。给 Playwright 上下文配 `proxy: { server }` 后，Google 端点仍报 `Client network socket disconnected before secure TLS connection was established`（同为 HTTP 代理，Chromium 与 `.NET` 行为不同），所以**最终走的是主机侧通道，不是浏览器侧**。
    - 另注：本机为 **Windows PowerShell 5.1**，无 `-SkipHttpErrorCheck`；应捕获 `WebException` 读 `Response.StatusCode`。且 DSH 在非交互模式下会把连接类错误消息替换为「Windows PowerShell 处于非交互模式…」，**该文案会掩盖真实错误**，不要据此判断失败原因。
12. 本机存在系统代理（`HKCU\…\Internet Settings` → `ProxyEnable=1`、`ProxyServer=127.0.0.1:7897`，端口在监听，进程为 `com.vortex.helper`）。探测 LR 或 Google 端点时应显式区分「直连」与「经代理」两种路径，否则会把可达性结论搞反。
13. 导出的交付路径实测为**文件下载**（`download` 事件），**不是**弹窗或内联渲染 —— 这是最终确认的关键。此前一次「点了导出没有下载」的真实原因是会话过期（页面回落到登录态、导出按钮不存在），被误读为定位问题。

## 9. 复现方式

1. `https://www.languagereactor.com/saved-items` —— 默认落在 `WORDS` 页签（未登录时显示登录占位）。**要看词表必须切到 `ALL_WORDS` 页签**，或直接设置 `localStorage.settings_v1.savedItemsActiveTab = "ALL_WORDS"` 后重载。
2. `https://api-cdn.dioco.io/base_dict_getAllWordsForLang?lang_G=es&numWords=8000` —— **匿名**词频词典（西语 8000 词，约 154 KB）。换 `lang_G`（如 `en`、`ja`）可获取其它语言。
3. `https://www.languagereactor.com/help/export` —— **权威数据模型**（`savedItem_EXPORT_t`）与 CSV 字段清单。
4. `https://www.languagereactor.com/ui_strings/en.json` 与 `/zh_CN.json` —— 全量文案（各 1,437 键）。
5. 该路由加载的 `assets/SavedItems-*.js`、`SavedItemsFilterControls-*.js` —— 排序/筛选/分组枚举与页签定义（`enabledTabs`）。
6. 登录后探测：`launchPersistentContext` 复用已登录 profile（**不可**用 `storageState()`，会话在 IndexedDB），再枚举 `.MuiTab-root` 的 `value` 与 `[role=combobox]`。
7. 参考既有前序调研：`docs/superpowers/specs/2026-09-12-automated-content-supply-and-lexical-learning-redesign.md` 第 8 行引用的 `2026-09-12-language-reactor-technical-ux-research.md`（该文件位于 `99f45d5`，**尚未纳入当前分支**）。

## 10. 补测进度（当前状态）

| 待验证项 | 状态 | 需要的条件 |
|---|---|---|
| 三种排序的真实顺序与方向切换 | ⏳ 未完成 | 需 ≥3 条条目；1 条时排序控件可点但无差异可观测 |
| 日期分组分隔行 | ✅ **已确认存在** | 1 条即渲染出 `2026年10月10日` 分隔行（§3.3） |
| 词频档 / 到期档分组 | ⏳ 未完成 | 需跨词频档或经过复习产生 `reviewData` |
| 导出文件真实字段与编码 | ✅ **已完成** | 五种格式全部下载并解析（§5.8）：JSON 数组 + 内联 TTS 音频、CSV 实为 zip(CSV+mp3)、Excel 20 列、Print HTML、Anki 旧式 schema + Cloze + 19 字段 |
| 条目级标签 / 阶段写入 | ⏳ 未完成 | 需先定位 hover 词典或条目菜单的写入口（列表药丸只是筛选） |
| 删除级联 | 🟡 部分 | 已确认 `removeItem` 返回 `{}`（幂等成功）；级联细节未验证 |

### 后续补测的最小步骤

1. 在账号中保存 **3 条**条目（1 短语 + 1 带上下文单词 + 1 无上下文单词），且尽量跨两天。
2. `保存的单词` 页签依次点 `TIME` / `FREQ` / `NEXT`，记录行顺序与升降序 `aria-pressed`。
3. 打开导出对话框，选 `JSON` 页签并点「导出」，观察是下载文件、新开窗口还是内联渲染，再核对字段。
4. 用 hover 词典的「学习中/已掌握/不学习」按钮与标签设置写一次，核对 `saveItem_5` / `bulkUpdateItems_2` 的请求体。
5. 删除 1 条，核对 `titles` / `titles_words` / `titles_phrases` 与 `countsPerStage` 是否同步下降。

> 建议使用**专门测试账号**执行后续补测；本轮已在个人主账号留下 1 条条目（见 §8 第 8 条），请所有者自行决定是否保留或删除。
