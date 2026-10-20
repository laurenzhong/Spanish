# Language Reactor 词典 / 翻译端点探测（西语 → 中文）

- 日期：2026-10-11
- 探测对象：`https://api-cdn.dioco.io`、`https://api-cdn-plus.dioco.io`、`https://api.dioco.io` 上的 `base_dict_*` 端点族
- 探测目的：回答「LR 是否暴露**西语词的中文词典/翻译数据**，且**按词频给出多个译文**」——用于决定我们 8,000 词词表的中文释义能否直接取自 LR，而不是自行生成并审核约 24,000 条释义
- 授权：项目所有者声明已获授权抓取该站点公开可用数据（见 `docs/references/2026-10-10-language-reactor-saved-items-research.md` §1.1）
- 性质：**只读探测**。本次未修改任何产品代码、未写入数据库、未调用收费 provider。唯一写出的文件是本文
- 前置文档：`docs/references/2026-10-10-language-reactor-saved-items-research.md`（该文 §3.2 已记录 `base_dict_getAllWordsForLang`，但**未涉及任何翻译端点**）

---

## 0. 直接回答

| 问题 | 回答 |
|---|---|
| LR 是否暴露西语词的中文翻译数据？ | **是**，匿名可读，无需登录 |
| 是否一次给出**恰好 3 条**中文译文？ | **是**，实测所有命中词的 `hoverDictEntries` 长度恒为 3 |
| 顺序是否**稳定**？ | **是**，同参数重复 5 次结果完全一致 |
| 顺序是否**等于词频顺序**？ | **无法证实，且有反例**。响应里**没有任何词频字段**，LR 也未公开承诺排序语义 |
| 能否据此产出「列表页展示第 1 条、hover 展示前 3 条」？ | **可以，但需要人工抽检**：第 1 条质量较好，第 2/3 条偶有未翻译的西班牙语残留或低质项 |
| 能否低成本批量抓取 8,000 词？ | **可以但慢**：无批量端点，需逐词查询。突发上限约 **98 次唯一查询**（恢复约 42 秒），但**持续 1.66 次/秒实测 0 次 429**。8,000 词预计 **约 85–95 分钟** |

**一句话结论**：LR 确实有一份匿名可读的西语→中文词级词库，直接返回「3 条中文译文」，第 1 条通常就是最常用的意思；但它**不是**一个带词频字段的结构化数据源，"按词频排序"是我们从数据表现做的**推断而非契约**，第 2/3 条存在可观测的质量缺陷。

---

## 1. 方法与证据等级

### 1.1 本次实际采用的方法

1. **静态提取端点名**：LR 前端主 bundle `assets/index-B2o7oYbu.js`（3,167,852 字节，已在前序会话抓取到 `.tmp-lr-research/assets/`）中正则提取全部 `base_[a-z]+_[A-Za-z0-9_]+`，得 **93 个端点**，其中 `base_dict_*` **10 个**。
2. **提取调用点**：对每个 `base_dict_*` 提取其调用处上下文，得到 zod 请求校验 schema（参数名、约束、枚举），因此**无需猜测参数名**。
3. **只读实测**：在 PowerShell 中以 `Invoke-WebRequest` 直接复现请求（等价于 `credentials: omit`），记录 HTTP 状态码、字节数与响应体。
4. **覆盖率与限流测量**：以本仓库真实的 `content/word-lists/es-frequency-v1.json`（8,000 词）为样本来源。

### 1.2 未采用的方法与原因（如实标注）

- **未做「浏览器 hover 观察」**（任务建议中的首选方法）。原因：端点和参数是从 LR 自己的 bundle 调用点直接提取的，且已用真实请求复现并取得真实响应体，浏览器观察不会改变结论；而 LR 的匿名文本工具 `/text` 实测需要登录（见 `.tmp-lr-research/discover/text-page.txt`），媒体页 hover 词典需要内容播放上下文，都会消耗同一份限流额度。**「UI 按数组顺序展示」这一点由 bundle 源码直接佐证**（见 §5.3），未做像素级确认。
- **未登录、未使用任何账号凭据**。所有者账号的凭据未在本轮使用。因此所有 POST 端点（见 §3）的实际返回**未取得**。
- **未绕过任何 429**。见 §7.2。

### 1.3 证据等级

| 标记 | 含义 |
|---|---|
| **实测** | 本次直接发出 HTTP 请求并保存了响应体 |
| **源码** | 来自 LR 自己的前端 bundle 调用点 / zod schema / UI 渲染代码 |
| **推断** | 由实测数据归纳，未经 LR 确认 |
| **未解** | 本次无法确定 |

---

## 2. 端点全族清单（实测 + 源码）

从 `assets/index-B2o7oYbu.js` 提取到的全部 `base_dict_*` 端点，含其调用点定义的基址与参数：

| 端点 | 方法 | 基址 | 参数 / 请求体（源码 zod schema） | 本次实测 |
|---|---|---|---|---|
| `base_dict_getAllWordsForLang` | GET | `CDN` | `lang_G`, `numWords:number` | ✅ 200（前序会话已记录） |
| **`base_dict_getHoverDict_8`** | GET | `CDN_PLUS` | `form:1..50`, `lemma:≤50`, `sl`, `tl`, `pos`, `pow:'y'\|'n'` | ✅ **200 — 见 §4** |
| **`base_dict_getFullDict_8`** | GET | `CDN_PLUS` | 同上 + `fetchExampleTranslationsSeparately?:'true'\|'false'` | ✅ **200 — 见 §5** |
| `base_dict_getDictExampleTranslations` | GET | `CDN_PLUS` | 同上 6 参数 | ✅ 200（返回 `tatoebaExamples`，12,547 字节） |
| `base_dict_getDictTTS_3` | GET | `CDN_PLUS` | `lang`, `text:≤30` | ✅ 200（返回 `data:audio/mpeg;base64,…`，14,453 字节） |
| `base_dict_getExternalDicts` | GET | `CDN_PLUS` | `sl`, `tl` | ✅ 200（见 §6.3） |
| `base_dict_getTatoebaSentencesGroup` | POST | `CDN_PLUS` | — | ❌ 400（匿名） |
| `base_dict_getHoverDictEntriesForSubs` | POST | `CDN` | `{subs_words:string[][], f:number, studyLang_G, translationLang_G, source_debug}` | ❌ 400（匿名） |
| `base_dict_llmDict` | POST | `ORIGIN` | `{word:1..100, lang_G, translationLang_G}` | ❌ 400（匿名） |
| `base_dict_fullDictTranslate_2` | POST | `ORIGIN` | `{input:{TEXT,≤500}\|{AUDIO}, sl, tl, mode:'AUTO_DETECT'\|'NORMAL'\|'REVERSE'}` | 未请求 |

**基址常量的源码原文**（`index-B2o7oYbu.js`）：

```js
const $O={WG:"http://10.66.66.10",ORIGIN:"https://api.dioco.io",
          CDN:"https://api-cdn.dioco.io",CDN_PLUS:"https://api-cdn-plus.dioco.io"};
```

> `WG:"http://10.66.66.10"` 是 RFC1918 私网地址（典型 WireGuard 网段），被硬编码进**生产 bundle**。这是"Dioco 是 LR 自家后端"的一条旁证，见 §7.2。

### 2.1 一个决定性的工程事实：GET 匿名可读，POST 不可

- **全部 6 个 GET 端点匿名可读**，且在 `api-cdn.dioco.io` 与 `api-cdn-plus.dioco.io` **两个主机上都返回相同结果**（实测 `banco`：两主机均 200，`["银行","库","长椅"]`；`getFullDict_8` 两主机均 200、均 12,894 字节）。
- **全部 POST 端点匿名返回 400，响应体为空**。

这直接排除了一条本来最有价值的路径：`base_dict_getHoverDictEntriesForSubs` 的请求体是 `subs_words: string[][]`，**一次请求可以查一批词**（返回 `{phrases:{词:译文}, numFound, missing}`）。前序会话在登录态下抓到过它的**空响应**（`.tmp-lr-research/verify/rpc-summary.md` §5）：

```json
{"status":"success","data":{"phrases":{},"numFound":0,"missing":0}}
```

若该端点匿名可用，8,000 词可压缩到数十次请求。**实测匿名不可用（400）**，所以只能逐词查询 —— 限流因此成为主要成本，见 §6.5。

---

## 3. 核心端点：`base_dict_getHoverDict_8`

### 3.1 请求

```
GET https://api-cdn-plus.dioco.io/base_dict_getHoverDict_8
      ?form=<词形>
      &lemma=<词元>
      &sl=es
      &tl=zh-CN
      &pos=<Universal POS | ANY | 空串>
      &pow=<y | n>
```

参数来源（源码 zod，见 §2）：`form` 1–50 字符，`lemma` ≤50，`sl`/`tl` 取自 61 种语言的枚举（含 `zh-CN`、`zh-TW`），`pos` 为自由字符串，`pow` 只接受 `y`/`n`。

### 3.2 真实响应（实测，采集时间 2026-10-11T18:34:28+08:00）

以 `pos=NOUN&pow=n` 请求 10 个**真正多义**的西语词，逐字返回：

| 词 | `hoverDictEntries`（原样） | 逐条对照 |
|---|---|---|
| `banco` | `["银行","库","长椅"]` | bank / storehouse / bench |
| `tiempo` | `["时间","天气","时光"]` | time / weather / spell |
| `muñeca` | `["玩偶","娃娃","手腕"]` | doll / doll / **wrist** |
| `sierra` | `["山脉","锯","山脉带"]` | mountain range / saw / sierra |
| `capital` | `["首都","资本","大写字母"]` | capital city / capital / capital letter |
| `hoja` | `["叶子","叶","纸"]` | leaf / leaf / **sheet of paper** |
| `llama` | `["羊驼","火焰","骆马"]` | llama / **flame** / vicuña |
| `orden` | `["命令","秩序","顺序"]` | command / order / sequence |
| `planta` | `["植物","工厂","楼层"]` | plant / factory / floor |
| `cura` | `["牧师","神父","治疗"]` | priest / priest / cure |

响应体原始形状（`banco`，HTTP 200，74 字节）：

```json
{"status":"success","data":{"hoverDictEntries":["银行","库","长椅"]}}
```

**这是本次最强证据**：结构极简 —— 一个**有序数组**，无其它字段。

### 3.3 参数敏感性（实测）

| 变更 | 对 `banco` 的结果 | 结论 |
|---|---|---|
| `pow=y` vs `pow=n` | 完全相同 | `pow` 对结果无影响，但**必填**（缺失或非法值 → 400） |
| `pos=NOUN` | `["银行","库","长椅"]` | — |
| `pos=VERB` / `pos=ADJ` | `["银行","库","桥墩"]` | 第 3 条会变 |
| `pos=`（空串）/ `pos=ANY` | `["银行","库","长凳"]` | 第 3 条会变 |
| 缺 `form`/`lemma`/`sl`/`tl`/`pos`/`pow` 任一 | 400 | 六个参数全部必填 |
| `form=casas&lemma=casa` | `["房子","住宅","家"]` | 接受屈折形；但**与 `form=casa` 的第 2/3 条顺序不同**（见 §5.4） |

### 3.4 与 LR 已有数据的关系

前序文档 §4.8 记录的 token 级 `freq` / `diocoFreq`（如 `terremoto=3609`）是**词形在整个语料中的排名**，与 `hoverDictEntries` 的**译文排序**是两套互不相干的数字 —— `hoverDict_8` 的响应里**没有任何频次字段**。不要把它与 `freqRank` 混淆。

---

## 4. 更丰富的端点：`base_dict_getFullDict_8`

### 4.1 请求

```
GET https://api-cdn-plus.dioco.io/base_dict_getFullDict_8
      ?form=banco&lemma=banco&sl=es&tl=zh-CN&pos=NOUN&pow=n
```

### 4.2 真实响应结构（实测，HTTP 200，12,894 字节）

顶层 `data` 只有两个键：`renderData`、`tatoebaExamples`。`renderData` 也只有两个键：

```json
{
  "status": "success",
  "data": {
    "renderData": {
      "hoverDictEntries": ["银行", "库", "长椅"],
      "fullDictRenderData": {
        "type": "BILINGUAL",
        "entries": [
          {
            "word": "banco",
            "posGroups": [
              { "pos": "noun", "translations": ["银行","长椅","库","储备","堆"] },
              { "pos": "ANY",  "translations": ["银行","长凳","库"] },
              { "pos": "",     "translations": ["沙洲","鱼群","桥墩","工作台","板凳"] }
            ]
          }
        ]
      }
    },
    "tatoebaExamples": { "NOUN": [ /* 若干 Tatoeba 例句，含逐 token NLP */ ] }
  }
}
```

`orden` 的 `posGroups`（实测）：

```json
[{"pos":"noun","translations":["命令","秩序","顺序","指令","次序"]},
 {"pos":"verb","translations":["命令","ordenar"]},
 {"pos":"ANY", "translations":["命令","秩序","顺序"]},
 {"pos":"",    "translations":["规矩","整齐","订单"]}]
```

`sierra` 的 `posGroups`（实测）：

```json
[{"pos":"noun","translations":["山脉","山脉带","锯齿","锯","链锯"]},
 {"pos":"ANY", "translations":["山脉","锯","山脊"]},
 {"pos":"",    "translations":["西拉"]}]
```

### 4.3 这个端点比 `hoverDict_8` 多给了什么

1. **每个词性分组内最多 5 条译文**（`hoverDictEntries` 恒为 3）。
2. **词性分组**（`noun` / `verb` / `ANY` / 空串），可用于按词性选义。
3. `tatoebaExamples`：真实例句 + 逐 token NLP（`pos`/`lemma`/`feats`/`deprel`/`freq`/`diocoFreq`）+ 中文机翻，可用于生成例句。
4. 代价：响应体大 100–300 倍（`banco` 12,894 字节 vs 74 字节），耗时更长。

### 4.4 但 `fullDictRenderData` **同样没有词频字段**

zod 里**确实存在**一个带显式词频标签的词典结构（源码）：

```js
const sZ = D.enum(["rare","uncommon","common","very_common"]);
const aZ = D.enum(["A1","A2","B1","B2","C1","C2"]);
const WAe = D.object({
  partOfSpeech: Mx,              // 17 个 Universal POS
  grammaticalHint: D.string().optional(),
  usageLabel: D.string().optional(),
  translation: D.string(),
  definition: D.string().optional(),
  examples: D.array(sD).optional(),
  synonyms: ..., antonyms: ...,
  frequency: sZ.optional(),          // ← 显式词频
  proficiencyLevel: aZ.optional(),   // ← 显式 CEFR
  usageNotes: D.array(D.string()).optional()
});
// 消费它的形状：
D.object({ word, lang_G, translationLang_G, pronunciation?,
           meanings: D.array(WAe), phrasesAndIdioms?, relatedWords?, etymology? });
```

**关键**：这个形状**不是** `getHoverDict_8` / `getFullDict_8` 返回的（实测二者响应里都没有 `meanings`）。它带 `etymology`、`proficiencyLevel`、`usageNotes`，是典型的 **LLM 生成词典**输出校验 schema，对应 **`base_dict_llmDict`**（POST 到 `ORIGIN`，匿名 400）。

也就是说：**LR 内部确实存在一个"多义项 + 显式词频标签 + CEFR"的词典结构，但它挂在需要登录的 POST 端点上，本次未能取得真实响应。** 这是本次最重要的未解项（§9）。

---

## 5. 「能否拿到按词频排序的 3 条中文译文？」

### 5.1 结论：**部分可以**

- ✅ **3 条中文译文**：可以，`hoverDictEntries` 恒为 3 条，匿名、无需登录。
- ✅ **稳定顺序**：可以，同参数重复请求顺序完全一致（`casa`/`banco`/`sierra`/`aire` 各 5 次，逐次相同）。
- ❌ **"词频顺序"作为可验证事实**：**不可以**。响应无词频字段，LR 未文档化排序语义。
- ⚠️ **第 1 条作为"最常用译文"**：表现良好但非保证，见 §5.2 / §5.3。

### 5.2 支持"顺序有意义"的证据（推断）

§3.2 的 9 个多义词（`llama` 除外，见下）中，第 1 条基本都是该词最日常的意思：`banco`→银行（非长椅）、`tiempo`→时间（非天气）、`capital`→首都（非资本）、`planta`→植物（非工厂）、`sierra`→山脉（非锯）、`muñeca`→玩偶（非手腕）、`hoja`→叶子（非纸张）、`orden`→命令、`cura`→牧师。若顺序是随机的，9 连中不太可能。

### 5.3 反对"顺序 = 词频"的证据（必须并列陈述）

1. **`tl=en` 时顺序明显不合理**（实测）：`banco` → `["bench","bank","stock"]` —— 英语里 bank 远比 bench 常用。同一词在不同目标语言下排序不同，说明排序是**按语言对分别从某个语料/对齐数据算出来的**，而不是一个普适的语义词频。
2. **`llama` 的第 1 条是 `羊驼`（羊驼）而非 `火焰`（火焰）**。在通用西班牙语里"火焰"义通常更常见，这是一个可指认的反例。
3. **LR 自己的 UI 代码只是把数组按序 join**，没有任何排序或打分逻辑（源码）：

   ```js
   y.jsx(VXe, { item: i, translation: r.data.dictTranslation.renderData.hoverDictEntries.join(", ") })
   ```

   即：**UI 忠实地按数组顺序显示，但"这个顺序是什么语义"在客户端不可见。**
4. **`hoverDictEntries` 不等于任何单个 `posGroups` 的前 3 条**（实测 `banco`）：hover 是 `[银行, 库, 长椅]`，而 `noun` 组前 3 是 `[银行, 长椅, 库]`、`ANY` 组是 `[银行, 长凳, 库]`。说明 hover 列表来自一个**独立的排序来源**，其规则未暴露。

**因此：把 `hoverDictEntries[0]` 当作"最常用译文"是合理的工程近似，但不能宣称 LR 提供了词频排序。**文档与 UI 文案不应写成"按词频排序"，除非我们自己在 LR 数据之上另做词频标注。

### 5.4 可观测的质量缺陷（会影响我们的列表页）

第 2/3 条**偶尔是未翻译的西班牙语残留或低质项**：

| 词 | `hoverDictEntries` | 问题 |
|---|---|---|
| `libro` | `["书","libro","libros"]` | 第 2/3 条是西语原词及其复数 |
| `gato` | `["猫","gato","gata"]` | 第 2/3 条是西语原词及阴性形 |
| `ciudad` | `["城市","ciudad","ciudadela"]` | 第 2 条是西语原词 |
| `comida` | `["食物","comida","alimentos"]` | 第 2 条是西语原词 |
| `orden`（full） | `verb` 组 `["命令","ordenar"]` | 第 2 条是西语动词原形 |
| `aire` | `["空气","风","样子"]` | 第 3 条"样子"与该词关联弱 |

以及**顺序不稳定的一处反例**：`form=casa&lemma=casa` → `["房子","家","住宅"]`，而 `form=casas&lemma=casa` → `["房子","住宅","家"]`。第 1 条稳定，**第 2/3 条会随词形而变**。

**工程含义**：若采用 LR 数据，`hoverDictEntries[0]` 可直接用作列表页释义；第 2/3 条**必须过一道启发式过滤**（例如剔除与 `form`/`lemma` 完全相同或高度相似的项），并且由于缺陷率不低，**仍然需要抽样人工审核** —— 只是工作量从"生成并审核 24,000 条"降为"审核约 16,000 条候选并剔除数百条明显坏项"。

---

## 6. 覆盖率与限流（工程可行性）

### 6.1 与我们真实词表的对齐

本仓库 `content/word-lists/es-frequency-v1.json`：**8,000 个词，去重后仍为 8,000**（无重复）。前 8 个词为 `el, que, él, de, ser, no, a, yo`，与 LR `base_dict_getAllWordsForLang?lang_G=es&numWords=8000` 返回的顺序**完全一致** —— 我们的词表本就源自该端点。

> 注：产品页声称 7,922 词，文件实为 8,000。差异未在本次追查，可能是页面端的过滤。

### 6.2 覆盖率（实测）

| 样本 | 请求参数 | 结果 |
|---|---|---|
| 词表等距抽样 60 词 | `pos=NOUN` | 57 / 60 命中（95%） |
| 词表 rank 7900–7929（生僻词） | `pos=NOUN` | 26 / 30 命中（87%） |
| 词表 rank 4000–4149（中频段 150 词） | `pos=`（空） | **144 / 150 命中（96%）**，6 次真实未命中 |
| 同一 150 词区间重复两轮 | `pos=`（空） | 两轮均为 144/150，**未命中词完全相同** → 未命中是稳定属性，不是随机失败 |
| 词表前 120 词（高频） | `pos=`（空） | 120 次请求中前 98 次全部 200（其余被限流，非未命中） |

**rank 4000–4149 的 6 个未命中词（实测，逐字）**：

```
involucrarse, interponerse, emocionarse, llenarse, toparse, subespacial
```

其中 **5 / 6 是反身动词（`-se` 结尾）**，1 个是真实生僻词。这是本次最可操作的覆盖率结论。

**去反身词尾能否挽回？** 实测（`form=原形, lemma=去 -se`）：

| 原词 | 去 `-se` 后 | 结果 |
|---|---|---|
| `emocionarse` | `emocionar` | ✅ 命中 `["激动","兴奋","感动"]` |
| `involucrarse` | `involucrar` | ❌ 仍 400 |
| `interponerse` | `interponer` | ❌ 仍 400 |
| `llenarse` | `llenar` | ❌ 仍 400 |
| `toparse` | `topar` | ❌ 仍 400 |
| `mirarse` | `mirar` | ✅ 命中 `["看","瞧","望"]`（但 `form=mirarse&lemma=mirarse` 也命中 `["互相注视","对视","照镜子"]`） |

即**去反身词尾只能挽回少数**，大部分反身动词在 LR 词典里根本不存在。

**未命中（HTTP 400，响应体为空）的可指认原因**：

- **反身动词**：`aliarse`、`colgarse`、`pillarse`、`remontarse`、`mirarse`（`pos=NOUN/VERB/ADJ/ADV` 全部 400）→ 但 **`pos=`（空串）或 `pos=ANY` 可命中**（`mirarse` → `["互相注视","对视","照镜子"]`）。
- **真实生僻词**：`homúnculo`（`pos=NOUN` 400，`pos=` 命中 `["小矮人","侏儒","小人"]`）。
- 结论：**`pos=` 空串或 `pos=ANY` 是最宽容的取值**，且我们手上**没有词性数据**（词表是纯词形数组），因此应当直接用空 `pos`。

### 6.3 一个易踩的坑：`pos=` 缺失与 `pos=` 空串不同

`pos` 参数**必须存在**。`&pos=&pow=n` 合法；完全省略 `pos` → 400。

### 6.4 未命中与坏请求不可区分

不存在的词（`zzzqqq`、`asdfghjkl`）与参数错误**都返回 400 且响应体为空**。因此：

- 无法从响应区分"这个词 LR 没有"与"我请求写错了"；
- 抓取脚本必须**先做一次已知词的正向校验**，否则会把系统性参数错误误判为"LR 没有这个词"。

（本次即发生过一次：`clavar` 在一次抽样中 FAIL，改用相同 `pos=NOUN` 重试却成功 —— 那次失败是限流/瞬时错误，不是未命中。**这正说明必须带重试**。）

### 6.5 限流（实测，关键数字）

| 实验 | 结果 |
|---|---|
| **唯一词突发**（无间隔，连续 120 个不同词） | 前 **98 次 200**，第 **99 次起连续 429** |
| **429 恢复** | 之后每 20 秒重试一次，**t+42 秒**恢复 200 |
| **同 URL 重复请求** | 连续 200 次全部 200 —— **这是一个伪结论**：`api-cdn-plus` 是 CDN，相同 URL 被边缘缓存，不过源站限流。测限流**必须每次用不同的词** |
| 100 词抽样（间隔 120 ms） | 200=51，**429=47**，400=2 |
| 15 次同词（间隔 300/800/1500 ms） | 全部 200（同样是缓存假象） |
| **持续吞吐：150 个唯一词，间隔 700 ms** | **OK=144，429=0，400=6**，耗时 168 s → **0.89 次/秒，零限流** |
| **持续吞吐：同样 150 个唯一词，间隔 400 ms** | **OK=144，429=0，400=6**，耗时 91 s → **1.66 次/秒，零限流** |

**可用的工程结论**：

- 限流形态接近**令牌桶**：桶容量约 **~100**，突发打空后需 **~42 秒** 回满；
- **持续 1.66 次/秒（间隔 400 ms）实测 150 次请求零 429**，说明该速率低于补充速率，可长期维持；
- 因此 8,000 词按 400–700 ms 间隔抓取约需 **80–95 分钟**；
- **重复请求同一批词不会因重试而额外消耗额度**（CDN 缓存），对"失败重试"有利；
- 生产抓取必须实现：唯一词计数 + 429 退避 + 400 重试一次再判定未命中（本次实测中 `clavar` 曾因瞬时失败被误判为未命中）。

---

## 7. 数据来源与第三方问题（**开放问题，未解决**）

任务要求特别关注：数据来自 `api-cdn.dioco.io`，是第三方而非 LR 本身。以下是**可确定的观察**，以及**明确未解决**的问题。

### 7.1 可确定的观察

| 观察 | 证据 |
|---|---|
| LR 前端硬编码了三个 dioco 主机 | 源码常量 `$O`：`ORIGIN=api.dioco.io`、`CDN=api-cdn.dioco.io`、`CDN_PLUS=api-cdn-plus.dioco.io`（§2） |
| 还硬编码了一个**私网** `WG` 基址 | `WG:"http://10.66.66.10"` —— RFC1918 地址出现在生产 bundle 中 |
| **`languagereactor.com` 与 `api.dioco.io` 解析到同一 IP** | 实测 DNS：两者均为 `46.4.138.119`；`api-cdn.dioco.io`=`143.244.50.211`、`api-cdn-plus.dioco.io`=`143.244.49.177` |
| **`dioco.io` 裸域没有 A 记录** | 实测 DNS 查询：`dioco.io` 无 A 记录；`https://dioco.io/` 无法解析。Dioco **不是**一个有公开官网的品牌 |
| `api.dioco.io/` 只返回 nginx 默认页 | 实测 HTTP 200，内容为 "Welcome to nginx!" |
| LR 的 UI 文案里**没有任何数据来源署名或许可声明** | 已抓取的 1,437 条 `ui_strings/en.json` 中，匹配 `privacy\|terms\|licen\|attrib` 的键**为 0**；词典相关键只有功能文案（`showMiniDictionary_GT`、`userDefinedExternalDict_label` 等） |
| 例句来源**确定为 Tatoeba** | `base_dict_getFullDict_8` 响应中的 `tatoebaExamples` 带 `sentenceNumber`、`userName`（如 `Ankio`、`Seael`、`arh`）；存在专用端点 `base_dict_getTatoebaSentencesGroup` |
| 内置词典**不是** Reverso/Glosbe/Wiktionary | `base_dict_getExternalDicts` 实测返回的是**外链模板**，属于"跳出去查"的第三方按钮，不是内置数据源：<br>`[{"name":"Reverso Context","url":"https://context.reverso.net/translation/spanish-chinese/{q}"},{"name":"Glosbe","url":"https://glosbe.com/es/zh/{q}"},{"name":"Wiktionary","url":"https://zh.wiktionary.org/wiki/{q}"}]` |

### 7.2 推断（明确标记为推断）

- 同一 IP 承载 LR 官网与 Dioco API origin、私网地址入生产 bundle、Dioco 无公开站点 —— 三条合起来**倾向于说明 Dioco 就是 LR 自家后端**（可能是同一实体下的另一个域名/服务），而不是一个独立对外提供 API 的第三方。
- 译文排序**按目标语言分别不同**（`banco` 在 zh-CN 下"银行"第一、在 en 下"bench"第一），且 LR 本身有整句机翻（`mTranslations`）与对齐字幕语料 —— 倾向于说明**词级译文是从对齐语料/统计或机器翻译派生的**，而非从一部有明确许可的词典复制。

### 7.3 未能确定的事项（**开放问题**）

1. **Dioco 是否是一个独立法人实体**，还是 LR 的内部服务名。未找到公司登记、服务条款、隐私政策或开发者计划。`dioco.io` 无可读网站。
2. **词典/译文的实际上游来源与许可**。Tatoeba 覆盖例句（Tatoeba 为 CC-BY 2.0 FR，**有署名义务**），但**译文本身**来自哪里完全未确定。
3. **是否适用独立的条款**。由于只找到 `api.dioco.io` 的 nginx 默认页、`dioco.io` 无站点，**本次没有找到任何 Dioco 的服务条款或 API 使用政策**。LR 自身的 `/privacy`、`/terms`、`/privacy-policy`、`/tos`、`/about` 实测均为**纯客户端渲染的空壳**（HTTP 200，正文只有 "You need to enable JavaScript to run this app."），未能取到条款正文。

> **对「把 LR 词典数据复制进我们产品」的含义（开放问题，非法律意见）**：
> 若 Dioco 与 LR 属同一实体，则所有者对 LR 的抓取授权可能覆盖该数据；若 Dioco 是独立第三方，则**需要单独确认其条款**，而本次**没有找到任何可引用的 Dioco 条款文本**——既不能证明需要额外授权，也不能证明不需要。此外，`AGENTS.md` §8 明确要求"外刊和第三方内容必须保存来源与许可"，且"非盈利、个人使用或尚未发布不取消来源、平台条款、许可、署名和撤下义务"。**建议在采用该数据前先补一次针对 Dioco 实体与条款的专项确认，并在数据落库时保留抓取时间、端点、原始响应与版本快照。**

---

## 8. 与产品需求的直接对照

| 需求 | LR 能否满足 | 说明 |
|---|---|---|
| 列表页：每个词一个**最常用中文释义** | 基本可以 | 用 `hoverDictEntries[0]`；但需抽检 + 需人工确认首条质量 |
| hover：**前 3 条按词频排序** | **部分可以** | 能拿到**恰好 3 条**且顺序稳定；"按词频"**无字段支撑、无文档保证、有反例**。若要真词频，需我方另行标注 |
| 7,922 词全覆盖 | 约 87–96% | 生僻词与**反身动词**会 400（rank 4000–4149 的 6 个未命中中 5 个是 `-se` 动词）；空 `pos` 可挽回少数 |
| 免去生成 24,000 条释义 | **部分免去** | 仍需（a）过滤西语残留的坏项，（b）抽检首条语义，（c）承担约 1.5 小时抓取与限流工程 |
| 数据来源与许可 | **未解决** | 见 §7.3 |

---

## 9. 未解事项（如实列出）

1. **`base_dict_llmDict` 的真实返回未取得**（匿名 400，响应体为空）。源码 schema 表明它可能返回**带 `frequency: rare|uncommon|common|very_common` 与 `proficiencyLevel: A1..C2` 的多义项词典**——若成立，这就是"带显式词频的多个译文"的正解。**需要所有者本人的登录会话来验证**，本次未使用任何凭据、未绕过访问控制。
2. **`hoverDictEntries` 的排序算法未确定**。不知道它是频率、语料共现、还是人工顺序。
3. **`base_dict_getHoverDictEntriesForSubs` 批量能力在登录态下是否可用**未验证；若可用，抓取成本可大幅下降。
4. **Dioco 的实体性质与条款**未确定（§7.3）。
5. **LR 是否对 8,000 词全部有覆盖**未做全量验证（抽样：中频段 96%、生僻段 87%、高频段 95%）；反身动词是已知的主要缺口。
6. ~~持续吞吐测试~~ → **已完成**，见 §6.5：400 ms 间隔下 1.66 次/秒零限流。
7. 本文**未做浏览器 hover 观察**（理由见 §1.2）；"UI 按数组顺序展示"来自 bundle 源码而非像素确认。

---

## 10. 复现方式

全部命令均为**匿名只读 GET**，无需凭据。

```powershell
# 1) 单次查询 —— 多义词，返回 3 条中文译文
Invoke-WebRequest -UseBasicParsing `
  "https://api-cdn-plus.dioco.io/base_dict_getHoverDict_8?form=banco&lemma=banco&sl=es&tl=zh-CN&pos=&pow=n"
# → {"status":"success","data":{"hoverDictEntries":["银行","库","长椅"]}}

# 2) 完整词典（含按词性的多译文 + Tatoeba 例句）
Invoke-WebRequest -UseBasicParsing `
  "https://api-cdn-plus.dioco.io/base_dict_getFullDict_8?form=orden&lemma=orden&sl=es&tl=zh-CN&pos=NOUN&pow=n"

# 3) 外部词典外链模板
Invoke-WebRequest -UseBasicParsing `
  "https://api-cdn-plus.dioco.io/base_dict_getExternalDicts?sl=es&tl=zh-CN"

# 4) 词频词表（前序会话已记录）
Invoke-WebRequest -UseBasicParsing `
  "https://api-cdn.dioco.io/base_dict_getAllWordsForLang?lang_G=es&numWords=8000"

# 5) 限流复现：连续用【不同的词】请求，第 ~99 次开始 429，约 42 秒后恢复
#    注意：重复同一个 URL 会被 CDN 缓存，测不出限流。
```

**端点名的来源**（重新提取）：

```powershell
$txt = Get-Content "D:\workspace\.tmp-lr-research\assets\assets__index-B2o7oYbu.js" -Raw
[regex]::Matches($txt,'base_dict_[A-Za-z0-9_]+') | ForEach-Object { $_.Value } | Sort-Object -Unique
```

**本地证据文件**：

- `D:\workspace\.tmp-lr-research\assets\assets__index-B2o7oYbu.js` —— 端点名与 zod schema 的来源（3,167,852 字节）
- `D:\workspace\.tmp-lr-research\verify\rpc-summary.md` —— 前序会话在登录态抓到的 `base_dict_getHoverDictEntriesForSubs` **空响应**形状
- `D:\workspace\content\word-lists\es-frequency-v1.json` —— 我方 8,000 词表（与 LR 词表同源同序）
- `D:\workspace\content\glossary\es-zh-common-v1.json` —— 现有 80 条人工/已审核词汇表（对照基线）

> `.tmp-lr-research/` 已被 `.gitignore` 的 `.tmp-*/` 规则忽略，其中的抓取产物不会进入版本库。本文引用的原始响应体均为本次实测逐字复制。

---

## 11. 后续：hover 交互机制已补测（2026-10-12）

本文 §1.2 与 §9.7 记为「未做浏览器 hover 观察」。该项已由 `docs/references/2026-10-12-language-reactor-hover-interaction.md` 补齐：在视频页 `文本` 标签的逐句字幕列表上（**未登录**）用真实指针实测了弹层的打开/关闭生命周期、100 ms 关闭延迟（实测 109.6 / 116.9 ms）、朝锚点一侧的 12 px 内边距（死区实测 0 px）、以及弹层内部的 `lln-stage-known` / `lln-stage-learning` 两个按钮。本文的端点与译文数据结论不受影响；两文合并即可覆盖"数据"与"交互"两面。
