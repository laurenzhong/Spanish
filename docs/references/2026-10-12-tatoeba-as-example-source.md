# Tatoeba 作为例句来源：授权、接口与实测覆盖率

- 日期：2026-10-12
- 目的：词汇页词条面板的例句来源改用 Tatoeba（业主指示：「不要已发布内容中的真实例句，他的例句好像从 Tatoeba 获取的」）
- 结论状态：**接口与授权已核实、覆盖率已实测；接入本身尚未实施**（见 §5 的开口项）

## 0. 业主的判断是对的

Language Reactor 的例句来源**就是 Tatoeba**，这在仓库里早有记录（`docs/references/2026-10-11-language-reactor-dictionary-probe.md`）：

- 第 185 行：`base_dict_getFullDict_8` 响应含 `tatoebaExamples`（带逐 token NLP）；
- 第 385 行：「**例句来源确定为 Tatoeba**」——`tatoebaExamples` 带 `sentenceNumber`、`userName`（如 `Ankio`、`Seael`、`arh`），另有专用端点 `base_dict_getTatoebaSentencesGroup`；
- 本文档补充 LR 面板里的呈现方式：`.lln-word-examples` 下除「示例：当前文本」外，另有一组「**示例：Tatoeba**」（见 `2026-10-12-language-reactor-full-dictionary-drawer.md` §3）。

## 1. 授权（这条决定能不能用）

Tatoeba 的句子**可以用**，但有署名义务：

| 项 | 实测/官方 |
|---|---|
| 句子许可 | **CC BY 2.0 FR**，部分为 **CC0 1.0**（[下载页](https://tatoeba.org/en/downloads)明确写出） |
| 音频许可 | **由贡献者各自选择**，在贡献者音频页标注——**不能假定音频与句子同许可** |
| 署名要素 | API **每条都返回**：句子 `id`、`text`、`license`、`owner`；译文另有自己的 `license`/`owner` |
| 导出 | 每周六 6:30 UTC 更新的完整导出 + 自定义「句子对」导出（[downloads](https://tatoeba.org/en/downloads)） |

因此按 `AGENTS.md` §8，接入必须：保存来源与许可、给出署名、保留撤下能力，且**不得**假定音频可随句子一起用。

## 2. 接口（v1，实测）

```
GET https://api.tatoeba.org/v1/sentences
      ?lang=spa                     # 句子语言
      &q=<词>                        # 文本查询
      &trans:lang=cmn               # 译文语言（注意不是 trans= 或 trans_lang=，那两个会 400）
      &sort=relevance               # 必填，缺失会 400（Required parameter "sort" missing）
      &limit=<n>
```

- 文档：<https://api.tatoeba.org/openapi> / 机器可读 <https://api.tatoeba.org/openapi.json>；过滤参数写在 `description` 里而非 `parameters` 数组，参数名容易猜错（`trans=`、`trans_lang=`、`word=` **全部 400**）。
- 实测响应（`q=también&trans:lang=cmn&limit=3`，`paging.total=213`）：

```json
{ "data": [{ "id": 5769217, "text": "Yo, también.", "lang": "spa",
             "license": "CC BY 2.0 FR", "owner": "arh", "is_unapproved": false,
             "translations": [{ "id": 793651, "text": "我也是。", "lang": "cmn",
                                "script": "Hans", "license": "CC BY 2.0 FR",
                                "owner": "Vortarulo", "is_direct": true }] }],
  "paging": { "total": 213, "has_next": true, "next": "...&after=10098%2C3631677" } }
```

- 还可用的过滤：`has_audio=yes`、`tag=OK`、`trans:is_direct=yes`、`trans:count`、`trans:N:lang=`（多组译文 AND）、`!` 前缀做 NOT、`,` 做 OR。

## 3. 覆盖率实测（采样 60 个词架词，每 131 名取一个）

| 结果 | 数量 | 占比 |
|---|---|---|
| 西语句 **+ 中文译文** | 48 | **80%** |
| 只有西语句、无中文 | 0 | 0% |
| 无结果 | 12 | 20% |

也就是说换成 Tatoeba 例句**不会**让例句覆盖率显著下降（当前「已发布内容」口径下词架 7,892 个词形里只有 2,555 个有 media 例句、6,296 个有条目）。但要注意口径差异：Tatoeba 命中的是**词/词元**，不是「这个词在本平台语料里出现过」。

## 4. 实测发现的两个必须处理的质量问题

1. **`q=` 匹配的是词干桶，不是这个词。** 实测 `q=mente` 返回的第一条是 `Tom mentía.`（`mente` 并不作为词出现），说明它按词干/前缀匹配。**2026-10-13 修正**：第一版实现据此得出「按折叠重音后的**整 token 相等**再过滤」的结论，这个结论**是错的、而且造成了线上缺陷**——它把 `había`/`habéis`/`habían`/`haberlo`/`haberme` 全拒了，于是 `haber` 明明有 529 条句子，词汇页却一个例句都不显示（`tener`/`poder`/`querer`/`saber` 等所有高频动词同样如此；资产里 229 个词被记成「查过但没有例句」）。正确做法是**按词元匹配**，边界与盲区见 §4.3。
2. **中文译文有简繁混用**。同一次查询里 `我也是。` 的 `script` 是 `Hans`，而 `變大了。`、`你拿过来吗?` 等未标 `Hans`。我们的界面与内容都是简体，必须按 `script === "Hans"` 过滤（或至少标注），否则会混入繁体。

另注：返回值里 `is_direct` 区分直译/间接译文，`is_unapproved` 区分是否经社区批准——这两个字段值得用作展示门槛（LR 也是展示式而非审核式，我们若采用应至少过滤 `is_unapproved`）。

### 4.3 词元规则：边界与已知盲区（2026-10-13）

规则在 `scripts/build-tatoeba-example-asset.ts` 的 `matchedLemmaForm()`，实现与注释同源。判定顺序（`token` 折叠重音；`word` 是词架词）：

| 层 | 规则 | 例子 |
|---|---|---|
| 1 | 与词完全相同 | `haber` → `haber` |
| 2 | 名词复数：元音后 `+s`、辅音后 `+es`、`-z`→`-ces` | `casas`→`casa`、`haberes`→`haber`、`lápices`→`lápiz` |
| 3 | 规则动词变位：仅当词是 `-ar/-er/-ir` 不定式、词干 ≥3 字母，且 token = 词干 + **表内的整个词尾**（可再接 1–2 个附着代词） | `había`/`habéis`/`haberlo`/`habérselo`→`haber`、`casaron`→`casar` |
| 4 | 自复不定式（词架里 `quedarse` 与 `quedar` 是两个条目）：只有带自复标记才算——附着（`quedarse`、`quedándome`）或紧邻前置（`me quedé`、`se queda`） | `quedarse` ≠ `Quedé con él.` |

**写明的边界（不是模糊的前缀匹配）：**

- **排除 `-er`/`-ir` 的现在虚拟式词尾组** `-a/-as/-amos/-áis/-an`：它是唯一会与极常见名词复数撞车的组，留着就会把 **`habas` 算成 `haber`**。代价如实记录：`comas`/`vendas`/`vivas` 不再命中 `comer`/`vender`/`vivir`（这些词仍有 `come`/`comía`/`comido`/`comiendo`）。
- **词干短于 3 字母不走变位层**：否则会命中普通词——`ver`+`ía`=`vía`、`dar`+`e`=`de`、`oler`+`a`=`ola`、`ser`+`ed`=`sed`。这些词只保留规则 1、2。
- **标准正字法带重音的词尾必须带重音**：`tenía`/`sabía`/`comió`/`vivís` 才算，因此 `tenia`（绦虫）不会算作 `tener`，`sabio`/`sabia`（聪明的）不会算作 `saber`，`podio`（领奖台）不会算作 `poder`。语料本身带重音（`q=habia` 返回 `paging.total=0`，`q=había` 返回 529），所以这条不损失召回。
- **`ñ` 不折叠**：`normalizeSpanishSurface` 会把 `año` 折成 `ano`，那会让 `año` 成为 `ano` 的例句、`uña` 成为 `una` 的例句。词元规则单独用保留 `ñ` 的折叠（`foldLemmaForm`），且该折叠对西语文本保持长度不变。
- **附着代词路径按折叠比较**：代词会把重音前移（`haber` → `habérselo`），所以这一路径不要求词尾保留原重音。

**已知盲区（如实记录，没有假装覆盖）：**

- **不规则词干根本不在结果里。** `haber` → `he`/`has`/`ha`/`hemos`/`han`/`hube`/`hubo`/`hubiera`；`ir` → `voy`/`fui`/`vamos`；`ser` → `soy`/`era`；`poder` → `puedo`/`pudo`；`querer` → `quiero`；`saber` → `sé`。实测 `paging.total`：`haber`=529 而 `habas`=529（同一个桶）、`hubiera`=94、`hemos`=75、`he`=639；`ir`=571 而 `voy`=359、`fui`=116；`poder`=281 而 `puedo`=1988、`pudo`=156；`ser`=622 而 `soy`=631、`era`=380。桶不同就说明**这些句子压根没被返回**，所以本地规则再怎么写也够不着（第一版资产里 `ir` 的例句只有 `Podemos ir.`/`Debo ir.` 这种裸形，就是这个原因）。要覆盖必须**按每个不规则形式单独查询**，本脚本没做。
- **现在时的词干变化形**（`puedo`/`quiero`/`tiene`/`siento`）和不规则副动词/分词（`diciendo`/`dicho`/`hecho`）同理。
- **同词干同形词会被接受**，因为规则不做句法分析：`caso` 既是 `casar` 的 1sg 也是名词，`casa` 既是 `casar` 的 3sg 也是名词 `casa`；`venderse` 会把 `Se venden casas.`（被动/无人称 `se`）算进去。句子连同译文一起展示，读者能看出是哪种读法；`matchedForm` 记录的是**命中的形式**，不是对读法的断言。
- 词架词与折叠键是多对一：前 1200 个词架词只产生 1197 个键（`normalizeSpanishSurface` 折叠重音），所以 `ano`/`año` 这类词共用条目。这是既有的键设计（运行时也按折叠键查），本轮没有改。

**`matchedForm` 的用途**：每条例句记录句子中**实际命中的那个 token**（原文形式，`haber` → `había`），因此「这条为什么算这个词的例句」是可核查的，而不是要人相信脚本。它被 `scripts/verify-tatoeba-example-asset.ts` 用来做三件事：字段必须存在、命中形式必须真的作为整 token 出现在该句里、并且**词元规则必须能从句子重新推导出同一个形式**（资产要可复现，而不只是自洽）。运行时读取器 `src/modules/lexicon-corpus/application/tatoeba-examples.ts` 现在也读取该字段（旧记录缺失时为 `null`），面板在有值时显示「含 Habéis」；校验器同时检查**读取器看到的值与文件记录一致**——「构建器写了、读取器却丢掉」是静默的形状不一致，只看文件看不出来。

### 4.4 本轮重抓的量化结果（2026-10-13）

同一批词架词（前 1,200 个词，折叠后 1,197 个键；`TATOEBA_LIMIT=1200 RETRY_EMPTY=1`，1,200 次请求、**0 失败**）：

| 指标 | 重抓前（旧规则） | 重抓后（词元规则） |
|---|---|---|
| 有例句的词 | 968 | **1,142** |
| 记录为「查过但没有例句」的词 | 229 | **55** |
| 例句总数 | 1,818 | **2,232** |
| 其中裸形命中 / 屈折·附着命中 | 1,818 / 0 | **1,444 / 788** |

**788/2,232 = 35% 的例句对「裸形规则」不可见**——这正是旧规则丢掉的那部分，也就是 `haber`/`tener`/`poder`/`querer`/`saber` 这类高频动词被记成「没有例句」的原因。抽查五词（重抓前均为 0 条）：

| 词 | 例句 | `matchedForm` |
|---|---|---|
| `haber` | ¿Habéis despertado? / ¿Habéis dormido? | `Habéis` / `Habéis` |
| `tener` | ¿Tenéis papel? / Tened cuidado. | `Tenéis` / `Tened` |
| `poder` | Podemos irnos. / Podemos ir. | `Podemos` / `Podemos` |
| `querer` | Queremos paz. / ¿Qué queréis? | `Queremos` / `queréis` |
| `saber` | Sabemos. / ¿Sabes? | `Sabemos` / `Sabes` |

剩下 55 个词仍无例句，**主要不是规则失败，而是查询窗口与简体过滤的交互**：`q=` 的词干桶按相关度返回前 20 条，桶常被**别的词**占满，而被规则正确拒绝。实测三例：`q=caso`（total 1,158）前 20 条是 `¿Tienen casa?`/`Me casé.`/`Soy casada.`（属于 `casa`/`casar`，对 `caso` 应当拒绝）；`q=comida`（total 1,945）前 20 条是 `Come.`/`Como.`/`Comía.`（属于 `comer`）；`q=informar`（total 48）前 20 条是 `información`/`informe` 与 `Mantenme informado.`，而其中带**简体**译文的句子又多半落在别的词元上。**要填满这 55 个词需要按 `paging.next`/`after=` 往深处翻页，或按形式逐个查询**——本轮没做，是明确的下一步。规则不放松是**故意的**：把 `casa` 当成 `caso` 的例句才是更糟的结果。

## 5. 接入方式：已按「预取物化」实施（2026-10-13）

两个开口项已定：

1. **预取物化，不在请求里调外部接口。** 实时查询会把 Tatoeba 的延迟、限流与宕机放进「点开一个词」这条路径，也让「先校验、带来源与许可、可撤下」无法保证（`AGENTS.md` §8）。所以句子在构建步骤里取、校验、带着署名写进资产，运行时只读文件。配套实现：`scripts/build-tatoeba-example-asset.ts`（取数 + 过滤 + 署名）与 `src/modules/lexicon-corpus/application/tatoeba-examples.ts`（读取 + 形状校验）。
2. **算第三方内容，按 §8 处理**：许可与两位作者写进资产并在面板上署名，未抓到的词显示「没有例句」而不是编造。

### 过滤规则（都由实测逼出来）

| 规则 | 原因 |
|---|---|
| **按词元匹配**（完全相同 / 名词复数 / 规则变位+附着代词 / 自复条件），每条例句记录 `matchedForm` | `q=` 只匹配词干桶：`q=mente` 首条返回 `Tom mentía.`，而 `mente` 并不作为词出现；反过来只认裸形就会丢掉 `había`/`haberlo`（§4.1、§4.3） |
| 词干 <3 字母不走进变位层；`-er`/`-ir` 现在虚拟式词尾组排除 | 否则 `ver`+`ía`=`vía`、`dar`+`e`=`de`、`oler`+`a`=`ola`，以及 **`habas` 会被算作 `haber`**（§4.3） |
| 带重音的词尾必须带重音（`tenía` 而非 `tenia`） | 否则 `tenia`（绦虫）算 `tener`、`sabio`/`sabia` 算 `saber`、`podio` 算 `poder` |
| `ñ` 不折叠 | 否则 `año` 会算作 `ano`、`uña` 算作 `una` |
| **中文译文优先 `script === "Hans"`**，无标记的按传统字黑名单排除 | 同批查询里既有「我也是。」也有「變大了。」，界面只做简体 |
| 丢弃 `is_unapproved` | 社区未批准的句子不应展示 |
| 每词最多 2 条 | 够用即可，控制资产体积与审阅成本 |

### 限流：实测而非猜测

- 并发 **8**：三十个词内即被回 **429**（返回 HTML，所以请求路径必须**先读文本再解析**，否则 `response.json()` 抛出的解析错误会把 429 藏起来）；按此推算，全量 7,922 词约 **2.2 小时持续压一个志愿运营的服务**，不可接受。
- 改为**并发 4 + 每请求 250 ms 间隔 + 全局指数退避**（被限流时所有 worker 一起等）：实测 **0.5 词/秒、0 失败**，全量约 **4 小时**。脚本**可续跑**（已抓到的词直接复用），中断即停、下次继续。

### 构建与刷新

```powershell
npx tsx scripts/build-tatoeba-example-asset.ts              # 续跑，只补缺失的词；并自动重建缺 matchedForm 的旧记录
TATOEBA_LIMIT=200 npx tsx scripts/build-tatoeba-example-asset.ts   # 小批量，便于人工抽检
$env:RESUME="0"; npx tsx scripts/build-tatoeba-example-asset.ts    # 忽略现有资产重抓
$env:RETRY_EMPTY="1"; npx tsx scripts/build-tatoeba-example-asset.ts  # 另外重问「查过但没有例句」的词
```

抓取节奏由环境变量控制，默认已经在下限之上：`TATOEBA_CONCURRENCY`（默认 **4**）、`TATOEBA_DELAY_MS`（默认 **350**，即每请求间隔 ≥250ms）、`TATOEBA_WRITE_EVERY`（默认 250 词落盘一次）。并发 8 会在三十个词内被回 429。

三种「要不要重问」的判定（`needsFetch()`），第三种最容易踩：

1. **从未问过** → 抓；
2. **问过但 `examples: []`** → 只有 `RETRY_EMPTY=1` 才重问。默认不重问，是因为常规续跑不该把请求花在 Tatoeba 已经回答过的词上（记录下来的空列表正是让续跑不会永远在这 229 个词上打转的东西）；而**规则变了之后，「空」可能是旧规则的答案而不是 Tatoeba 的答案**，这时用 `RETRY_EMPTY=1` 明确重问——`haber` 的缺陷正是这一类；
3. **问过且有例句，但记录里没有 `matchedForm`** → 自动重问一次。这种记录只是旧规则的缓存；不重问的话，改动前抓到的每条例句都会留着空的 `matchedForm`，校验器也就无法要求这个字段。这一条让「换规则」变成幂等的：跑完之后记录都带 `matchedForm`，下次运行不会再碰它们。

产物 `content/word-lists/es-examples-tatoeba-v1.json`（`TATOEBA_ASSET_PATH` 可覆盖）：每个词 `{ word, examples: [...] }`，每条例句带西语句与中文译文的 `id`、`license`、`owner`，以及 `tags`（记录它为何被接受）。

**进度是周期性落盘的**（`TATOEBA_WRITE_EVERY`，默认每 250 词一次）。原先只在跑完时写一次，意味着中途被中断（或崩溃、或机器休眠）会丢掉本次已抓到的**全部**结果——这是「可续跑」最不该有的失败模式。周期性写入让任何时刻的文件都是一份可用的部分资产，运行中的应用照常读它，没抓到的词显示「没有例句」。

**重建资产后必须重启服务进程。** 资产读取器把解析结果缓存在进程内存里（与语言反应堆释义资产同一模式，都是「按进程读一次」）。所以文件变大之后，**旧进程仍然拿着旧快照**。这一点本轮实际踩到过：一个早于批量抓取启动的服务进程让 `ventana` 的面板不显示例句，一度看起来像代码 bug；重启后立刻正常。判定方法是看进程启动时间与文件 mtime 的先后，而不是继续读代码。


**批量导出路线已核实为不可用**（2026-10-13）：官方周导出 `spa_sentences.tsv.bz2`（6.4 MB）、`cmn_sentences.tsv.bz2`（1.3 MB）、`links.tar.bz2`（150 MB）确实能让我在几分钟内建起完整的 `es→zh` 句对索引，但每行的列**只有 `id / lang / text`**——没有 `owner`、没有 `license`。CC BY 2.0 FR 的署名义务是本功能的前提，用导出文件就满足不了，除非再对每条句子回查 API（反而更慢）。所以**逐词 API 抓取是正确路线，不是将就**。

### 资产校验（资产增长后必须重跑）

```powershell
npx tsx scripts/verify-tatoeba-example-asset.ts
```

它查的是**写出来的文件**，而不是「构建脚本应该做了什么」——两者会不一致：构建器与读取器的形状分歧已经静默上线过一次（「available 但 0 个词」），而某条过滤规则失效看起来会和「Tatoeba 本来就没有这个词」**一模一样**——`haber` 就是被这条规则失效吃掉的：Tatoeba 有 529 条，资产写「没有例句」。

匹配判定**直接调用构建脚本的 `matchedLemmaForm`**，不在校验器里重写一份：两份规则会各自漂移，然后放过构建器根本不会写的数据。校验器额外要求的是**可复现**：它必须能从句子重新推导出记录里的同一个 `matchedForm`。

`matchedForm` **两处都查**：一次查**原始 JSON**（构建器真正写下的东西，也是旧版本 `parseTatoebaExampleAsset` 会丢字段时唯一可靠的地方），一次查**解析后的读取器视图**，两者必须一致。读取器写进去而没读出来，正是「available 但 0 个词」那一类**静默**的形状不一致——只看文件看不出来。

当前资产（1,197 词 / 2,232 例）**全部检查通过**：

| 检查 | 结果 |
|---|---|
| 资产可解析、声明 CC BY 2.0 FR、注明来源 | ✅ |
| 每条例句都记录了命中的形式（`matchedForm`） | ✅ |
| 记录的形式**确实作为整 token 出现在该句里** | ✅ |
| **词元规则能复现每一条记录**（`había`/`haberlo` 有效、`habas` 被拒） | ✅ |
| **运行时读取器看到的 `matchedForm` 与文件一致**（形状不一致对文件不可见） | ✅ |
| 每条例句都带 `lemma-match` 标签（旧 `whole-token` 标签即为旧规则的产物） | ✅ |
| 每条译文都是简体或带 `script-hans` 标记 | ✅ |
| 每对都带**两个作者 + 两个许可** | ✅ |
| 没有缺正文的记录 | ✅ |
| 文件头 `wordCount`/`exampleCount` 与内容一致 | ✅ |
| **查过但没有例句的词，读出来是「没有例句」而不是空区块** | ✅ |

最后一条是本轮校验器**自己发现的一个真实不一致**：构建器把「查过但没找到」的词写成 `examples: []`，而解析器会把这种条目丢掉。这个差异是**故意保留**的——文件需要记录该词被问过（否则下次运行会把它当缺失重抓一遍），而读取器不该看见它。真正不能不一致的是**读取器的答案**：空列表与键不存在都必须表示「没有例句」，因为面板只问「有没有」。校验器现在断言的是这一点，而不是断言文件里不存在空列表。



**已知陷阱（已修，且值得记住）**：构建脚本写的是 `{ word, examples: [...] }`，而最初的运行时解析器期望**裸数组**。形状不一致**不会抛异常**——它表现为「资产 available 但 0 个词」，于是每个词都静默失去例句。解析器现**同时接受两种形状**，`tests/unit/tatoeba-examples.test.ts` 专门钉住这一点。这类失败值得单独测，因为它不报错、只是功能消失。

### 原声锚点：已定案（2026-10-13）

移掉「已发布内容例句」后留下的真问题是：**读者会听到一段界面上看不到文本的原声**，因而无法判断那段声音为什么属于这个词。

定案是「保留原声，并在它响的时候显示它说的那一句」：

- `resolve-word-audio` 的 `clip` 增加 `segmentText`，取自**服务端解析出的那个分段自己的文本**——`findAddressedSegment` 已经按文本匹配过，所以显示的句子与听到的音频是同一个对象，不是两次独立查找。
- 面板只在 `phase === "clip"` 时、在朗读标签下方显示它。**不参与浏览**：它不改变词条默认长什么样，只在声音在飞的时候解释那段声音，所以没有把「例句」区块以另一种形式搬回来。
- **合成音不显示句子**。浏览器合成的声音没有发布来源，配一句文本就是给一个没说过这句话的声音编造来源。

仍然保留的差异：一个词可以同时有「原声（来自我们的已发布媒体）+ 那句话」与「Tatoeba 例句（第三方文本）」，两者在面板里位置与署名各自独立，谁也不冒充谁。



## 6. 复现

```powershell
# 覆盖率与字段（只读，不写库）
npx tsx .tmp-tatoeba-probe.ts          # 采样 60 个词架词，输出 80% 覆盖与许可字段
# 接口形状
curl.exe "https://api.tatoeba.org/v1/sentences?lang=spa&q=tambi%C3%A9n&trans:lang=cmn&sort=relevance&limit=3"

# 词干桶 vs 词元：total 相同=同一个桶，不同=根本不会被返回（§4.3 的盲区证据）
foreach ($q in "haber","habas","había","hubiera","hemos","ir","voy","fui","poder","puedo","pudo") {
  "$q`t" + (curl.exe -s "https://api.tatoeba.org/v1/sentences?lang=spa&q=$q&trans:lang=cmn&sort=relevance&limit=1" | ConvertFrom-Json).paging.total
}

# 词元规则的边界：下面第三、四行必须分别是 null / sabía（不新增文件）
npx tsx -e "import('@/scripts/build-tatoeba-example-asset').then(m => { for (const [w,s] of [['haber','Las habas están ricas.'],['haber','No había gatos.'],['saber','Es un hombre sabio.'],['saber','No sabía nada.']]) console.log(w, s, '=>', m.matchedLemmaForm(s, w)); })"

# 资产校验（含词元规则的可复现性与 matchedForm）
npx tsx scripts/verify-tatoeba-example-asset.ts
```
