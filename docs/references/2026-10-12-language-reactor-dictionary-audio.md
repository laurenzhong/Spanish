# Language Reactor 词典/书架的**录音与朗读**能力实测（对照参考）

- 日期：2026-10-12（观测窗口 `2026-10-12T16:4x–17:0x +08:00`）
- 观测对象：`https://www.languagereactor.com/saved-items` 所用的**词典朗读链路**（`SavedItems` 路由 bundle + 主 bundle 的词典组件）
- 观测目的：为 Sueño 词汇页「朗读」重做提供可对照的参考实现——不是猜 LR 大概怎么做，而是把它的**调用分层、缓存、失败行为、语速与音源选择**逐条取出来
- 授权与性质：**只读**。证据全部来自本仓库已有的 LR 线上 bundle 归档（`docs/references/2026-10-12-language-reactor-hover-interaction.md` §6 已证明该归档与线上**逐字节相同**，sha256 前 16 位 `4c3d5a881a91b926`）。本次**未访问 LR 站点、未登录、未点击、未发任何请求、未写任何数据库**；未抓取任何音频
- 前置文档：`docs/references/2026-10-10-language-reactor-saved-items-research.md`（该文 §5.8 已记录「导出阶段才生成 TTS，音色 `es-MX-GerardoNeural`」；本文补上**播放阶段**的完整实现）

---

## 0. 直接回答

| 问题 | 实测/源码结论 |
|---|---|
| LR 在书架上怎么发音？ | 词典组件里有一个**喇叭按钮**（`lln-dict-speak-word`，图标 `Qv`，尺寸 `28`）→ 点击调 `speakWord(词, 语言)` 【源码】 |
| 有没有「点词即读」？ | **有，而且默认开启**：`settings.speakWordOnClick` 默认 **`true`**；字幕里点词先开词典抽屉、**同一次点击**再朗读该词 【源码】 |
| 声音从哪来？ | **三种来源，按文本长度和可用性分流**（见 §2）：词典短音（匿名 CDN）、句子音（登录态 + `diocoToken`）、**影视原声片段**（`audio.source === "movie"` 时优先）【源码】 |
| 是浏览器 TTS 吗？ | 默认路径**不是**。LR 自带 Web Speech 适配（`Pr`，含 `init({maxTimeout:5000, interval:250})` 与音色排序），但词典/书架的播放走**服务端返回的 base64/dataURL**；浏览器 TTS 只是其中一条回退路径 【源码】 |
| 有缓存吗？ | **三层都有**：服务端按 `text` 端点缓存、CDN 层缓存、**客户端两个 Map**（词音无上限、句子音上限 **60** 条 + 在途去重）【源码】 |
| 音频会重放/重复下载吗？ | 客户端命中缓存就不再请求；但**换页即失效**（纯内存 Map，未落 IndexedDB 持久化——`indexedDB` 在 bundle 里仅 7 处，均与 prompts/设置有关）【源码】 |
| 语速怎么给？ | 只有一个「慢速」开关：`playbackRate === "NORMAL" ? 1 : 0.8`（常量 `bd = .8`），**TTS 与音频元素共用同一档**，音高固定 `pitch: 1`【源码】 |
| 音源可选吗？ | 有设置项 `preferredAudioSource_GT: "Preferred audio source"`，两个选项：`originalAudioWhenAvailable_GT: "Original audio (when available)"` 与 `computerAudioTTS_GT: "Text-to-Speech"`【源码】 |
| 失败会怎样？ | **多条静默路径**（这是要引以为戒的地方，见 §5）：浏览器 TTS 未就绪时 `SCe` 直接 `return`；句子音在**未登录**且属多词时**直接 `return`，无提示**；`speakWord` 只在 `status === "success"` 时播放，否则**什么都不发生**【源码】 |
| 朗读功能能录音吗？ | **本次在 `SavedItems` 路由 bundle 内零命中**（`record`/`Record`/`MediaRecorder`/`getUserMedia` 全为 0）。录音是**词典组件的设置项**（`showDictRecord_GT: "Dictionary / Record"`、`holdDictButtonToRecordVoice_GT: "Hold dictionary button to record voice"`），主 bundle 里有 `getUserMedia` 预热逻辑 【源码】 |

---

## 1. 证据等级与方法

| 标记 | 含义 |
|---|---|
| **实测** | 本次直接读到线上归档 bundle 的源码片段（逐字复制进本文） |
| **前序实测** | 引自 `2026-10-10-language-reactor-saved-items-research.md` 的登录态实测（真实响应体、导出产物） |
| **未观测** | 本次没有条件验证，如实列出 |

方法：对归档 bundle 做**只读字符串切片**（脚本 `.tmp-lr-tts-extract.mjs`，按 needle 定位并打印 ±上下文），未启动浏览器、未联网。所有代码片段为压缩后的原文，变量名是构建产物名。

**未观测（不得据此下结论）**：

1. 端点真实响应体与延迟（需登录态 + `diocoToken`，本次不获取）。
2. 「点词即读」在**真机 iOS** 上的表现（自动播放策略、是否必须先有用户手势）。
3. 服务端缓存命中率、计费口径、是否有额度限制（LR 未公开该端点文档）。
4. `originalAudioWhenAvailable` 在 `/saved-items` 上是否真的生效（该设置项存在且有文案，但消费点未在本次切片中定位到）。
5. 录音功能与朗读的联动（是否「跟读对比」）——只在设置文案层看到入口。

---

## 2. 三条音频通路（源码）

### 2.1 短词：词典音（匿名、CDN）

```js
D.object({lang:nn, text:D.string().max(30)});            // 文本上限 30 字符
const _I={};
async function VAe(e){
  const t=JSON.stringify(e); if(_I[t]) return _I[t];      // 进程内去重缓存
  const r=`/base_dict_getDictTTS_3?lang=${encodeURIComponent(e.lang)}&text=${encodeURIComponent(e.text)}`;
  const i=await zl(r,1e4,2,"CDN_PLUS");                    // 10s 超时、2 次重试、走 CDN_PLUS
  return i.status==="success"&&(_I[t]=i), i;
}
```

- 调用点：`speakWord(text, lang)` → 成功即 `stopAllPlayback()` → `speakBase64Audio(r.data)`。
- **匿名可用**（同一 CDN 家族的 `base_dict_getHoverDict_8` 已由前序文档证明匿名 200），所以「点词听音」不依赖登录。

### 2.2 长句：snippet 音（登录态 + token，POST）

```js
async function xRe(e){ return ht("/base_lexa_snippetTTS", e, 2e4, 1, "CDN_PLUS"); }  // POST，20s，1 次
async function QYe(e,t,n,r){
  const i=e.trim(); if(!i) return;
  if(fse(i)){ r.speakWord(i,t); return; }                  // 单词（无空格且 ≤30 字符）走 2.1
  if(!n) return;                                           // 未登录且是多词 → 静默无声
  const a=`${t}|${i}`;
  let s=gT.get(a)??null;                                    // gT：句子音缓存，上限 60（YYe=60）
  if(!s){
    let o=uP.get(a);                                        // uP：在途 Promise，去重并发请求
    if(o||(o=xRe({text:i,lang_G:t,diocoToken:n.diocoToken,userEmail:n.email})
             .then(l=>l.status==="success"?l.data.dataURL:null)
             .catch(()=>null).finally(()=>uP.delete(a))), uP.set(a,o), s=await o, !s) return;
    gT.size>=60&&gT.clear(); gT.set(a,s);                   // 满了整表清空（简单粗暴）
  }
  r.playDataUrl(s);
}
function fse(e){ const t=e.trim(); return !!t && !/\s/.test(t) && t.length<=30; }  // XYe=30
```

- 入口 `ZYe(text, lang)` 会在**已登录**时把 `{email, diocoToken}` 传进来。
- 未登录时用 `speakWord` 兜底（即短词路径）。

### 2.3 保存条目：服务端已存音频优先，其次原声，最后兜底

```js
async function mZ(e){ return ht("/base_items_getSavedItemTTS", e); }   // POST {diocoToken,userEmail,itemKey}
async function gZ(e){ const t=await mZ(e); return t.status==="success"? t.data : null; }

speakSavedItem(t){
  if(t.audio?.source==="movie" && t.audio.dataURL){ this.speakBase64Audio(t.audio.dataURL); return; }  // 原声优先
  tt.data.licenseStatus!=="NOT_SIGNED_IN" &&
    gZ({userEmail:tt.data.googleEmail, diocoToken:tt.data.diocoToken, itemKey:t.key})
      .then(r=>{ r && this.speakBase64Audio(r) });
}
```

- `base_items_getSentenceTTS_3`（`lang` + `text` + **`hash`**）也存在于同一 bundle，说明**句子音按内容 hash 缓存**。

### 2.4 浏览器 TTS 回退（同为默认路径的一部分）

```js
function SCe(e,t){                                  // playBrowserTTS
  if(!Rf()) return;                                 // 引擎未 ready → 静默返回
  const n=rL(t,Pr.voices());
  n!==null && (e=e.replace(IZ,""), e.trim().length!==0 &&
    await Pr.speak({text:e, voice:n, pitch:1, rate: Ae.settings.playbackRate==="NORMAL"?1:bd, volume:1}));
}
```

音色选择是**分级排序**（不是「第一个西语音色」）：优先 `Microsoft * Online *` → `Google español/US English` → 任意 `Google` → 指定默认名 → 平台默认 → 第一个。

### 2.5 播放器实现（单元素 + 显式生命周期）

```js
class wCe {                                        // 单例，页面里唯一的 #llnClipPlayer
  async say(t){
    if(this.cancel(), t===null) return n(!1);
    if(t.startsWith("blob:")||t.startsWith("data:")) this.audioSrc=t;
    else { const r=atob(t); … this.releaseOwnedObjectUrl();
           this.audioSrc=URL.createObjectURL(new Blob([a],{type:"audio/mpeg"})); this.ownedObjectUrl=this.audioSrc; }
    let r=document.querySelector("#llnClipPlayer"); …
    r.playbackRate = Ae.settings.playbackRate==="NORMAL"?1:bd;   // 0.8
    r.play();
  }
  cancel(){ … t.pause(); t.src=""; this.handler_reject?.(); this.state="IDLE"; }
  releaseOwnedObjectUrl(){ this.ownedObjectUrl && (URL.revokeObjectURL(this.ownedObjectUrl), this.ownedObjectUrl=null); }
}
```

要点：**base64 → Blob URL**（不是直接喂 dataURL 给 `src`）；自己创建的 object URL 由自己 revoke；`cancel()` 会清 `src` 并让挂起的 Promise 以 `false` 结束；`stopAllPlayback()` 暂停**所有**在册播放器（视频/音频/朗读互斥）。

---

## 3. 与 Sueño 现有实现的对照

| 维度 | Language Reactor | Sueño 现状（词卡按钮） | 差距性质 |
|---|---|---|---|
| 入口 | 词典弹层内喇叭按钮 + **点词即读（默认开）** + 条目播放按钮 | 只有**点开词卡后**的「朗读单词」按钮；悬停层与词块均无 | 入口不足（我们自己已认定） |
| 音源 | 短词：CDN 合成音；长句：登录态合成音；条目：**原声片段优先** | `window.speechSynthesis`（浏览器本地音色） | 音质与一致性差距；也解释了「iPhone 上时好时坏」 |
| 文本 | 词（≤30 字符）/ 句子（≤500 字符）**分流**，句子音带 hash | 只读词本身，`rate` 硬编码 0.88 | 语流示范缺失 |
| 语速 | 单一慢速开关（×0.8），TTS 与音频元素共用 | 固定 0.88 | 缺用户控制 |
| 音源偏好 | 设置项：原声优先 / TTS | 无 | 缺设置 |
| 缓存 | 端点缓存 + CDN + 客户端内存（词无上限、句 60、在途去重） | 无（浏览器 TTS 无网络成本，故不需要） | 换服务端 TTS 后**必须新增**，否则按次计费 |
| 失败行为 | **多条静默无声路径** | 有明确文案（`tts-no-audio` / `tts-stalled` / 不支持），且已有看门狗 | **我们更优，不能回退** |
| 录音 | 词典组件有录音入口（**未观测**其联动） | 无 | 不照搬（见 §5 与 §6.3） |

---

## 4. 值得借鉴的六点（按价值排序）

1. **按上下文长度分流**：单词走轻量端点、句子走带上下文与哈希的端点。词音要求「快」、句音要求「自然」，两者用同一个端点做不好。
2. **客户端缓存是计费闸门**：`Map` 命中即不请求 + 在途 Promise 去重，能挡住连点、重复悬停和快速换词。若换成付费供应商，这一层不是优化而是成本控制。
3. **原声优先于合成音**（`source==="movie"` 分支与设置文案）：与 `AGENTS.md`「听说是核心」一致——真实语流优于合成音，合成音用于**没有原声**的词。
4. **单播放器 + 显式取消**：一个元素、一个状态机、`cancel()` 清 `src`、object URL 自管自释放、`stopAllPlayback()` 保证同一时刻只有一路声音。这正是我们 §5 异步可靠性要求的具体形态。
5. **失败要有可见出口**：LR 在这里做得**差**，我们必须保留自己的 `tts-no-audio` / `tts-stalled` 文案与看门狗，并把「未登录 / 无网络 → 该端点不可用」也纳入同一套错误面，而不是静默。
6. **慢速只有一档、且与音频元素共用**：`0.8` 同时作用于 TTS 与音频回放，用户不需要学两套「快慢」。我们的朗读 `rate` 目前散在各处（0.88 / 设置项），应收敛成**一个全局档位**。

---

## 5. 明确不建议照搬

| LR 做法 | 不建议原因 |
|---|---|
| 点词即读（默认开） | 与我们的悬停词典冲突：我们悬停出释义、点击开卡片；加「点击即出声」会让「查释义」与「听音」互相抢点击。且手机上没有悬停，误触出声更烦 |
| 未登录、多词文本**静默不出声** | 与「错误、加载、空状态必须显式设计」直接冲突 |
| 客户缓存满了 `gT.clear()` 全清 | 会把刚用过的音又清掉，下一次仍要重新计费；应按 LRU 淘汰 |
| 全局 `stopAllPlayback()` 连视频一起暂停 | 词汇页没有视频，但**不能**把这条规则带进媒体页：在媒体页朗读会让播放中的视频停住 |
| 录音入口直接搬 | LR 的跟读闭环**未观测**；且按 `AGENTS.md`「跟读证据只更新跟读表现」，录音一旦引入就要写清证据边界与保留策略，属于独立任务 |
| 把 LR 的合成音资产或 `es-MX-GerardoNeural` 产物存进我们仓库 | 来源与许可（`AGENTS.md` §8）；音色选择是我们自己的供应商决定 |

---

## 6. 「LR 的音源在哪里」——三层来源与权利链

### 6.1 技术层：三条来源，两条经 LR 自己的服务器

| 层 | 实际音源 | 证据 | 是否经 LR 服务器 |
|---|---|---|---|
| ① 影视/内容原声 | YouTube（`tm.md5` 冻结字幕轨）、Netflix 等**平台播放流** | `savedItem_EXPORT_t.audio.source === 'movie'`；导出音色实测 `es-MX-GerardoNeural` / `source:'microsoft'`（前序文档 §5.8） | 否（由平台播放器出流） |
| ② 合成音（主路径） | **第三方云端 TTS**：`getDictTTS_3` / `getSavedItemTTS` / `base_lexa_snippetTTS`，导出音色名为微软神经音色 | 三个端点全部打 `api-cdn-plus.dioco.io`；LR 自己的 bundle 把 `10.66.66.10`（私网）、`api.dioco.io`、`api-cdn.dioco.io`、`api-cdn-plus.dioco.io` 硬编码为 API 基址 | **是**：浏览器只跟 dioco 通话，供应商调用发生在 LR 服务端 |
| ③ 浏览器本地合成 | 访客设备的 `speechSynthesis` | `SCe` / `Pr.speak`，音色偏好 Microsoft Online → Google → 默认 | 否（完全在设备上） |

关键的结构事实：**云端合成音从不直接来自微软/谷歌**。浏览器把 `{text, lang}`（短词）或 `{text, lang_G, diocoToken, userEmail}`（长句）交给 dioco，dioco 服务端再去调供应商——用户看不到供应商请求，端点上也没有任何音频 URL。

另一个结构事实：**LR 客户端不保存音频**。主 bundle 里 `indexedDB` 的 7 处命中全部属于第三方库（Firebase Analytics 的 `validate-browser-context-for-indexeddb-analytics-module`、Firestore 持久化层、RxDB 风格的 `JO()/Nx()` 包装），**没有音频仓库**；`speakSavedItem` 每次都打 `base_items_getSavedItemTTS`（POST `{userEmail, diocoToken, itemKey}`）。也就是说按播放按钮 = 一次**服务端生成/取回**，用户侧不构成可复制的音频库。

### 6.2 权利层：三条来源各自的权利人不相同

| 来源 | 权利人 | LR 凭什么用它 | 我们能不能换个名字用 |
|---|---|---|---|
| ① 影视原声 | **平台/版权方**（YouTube、Netflix、频道方） | 平台播放条款下的即时播放 | **不能**。片段不从 LR 来，是从版权方来的；LR 对它们没有可转授的权利 |
| ② 合成音 | **TTS 供应商**（合成音频的权利不在 LR），LR 只是付费用它的服务 | 与供应商的服务条款（通常限「为自己的终端用户提供服务」，不包含再分发音频文件） | **不能直接搬**。我们既不知道 LR 用的是哪家、哪个音色、哪份条款，也没有任何可引用的转授声明 |
| ③ 浏览器合成 | 由访客设备与浏览器/OS 供应商条款覆盖 | 无需授权 | **可以**（这条路本身无权利障碍，只是音质与 iPhone 可用性问题） |

### 6.3 与仓库既有边界的关系（这一节是结论，不是新规矩）

- `docs/references/2026-10-11-language-reactor-dictionary-probe.md` §10 已把 LR 词典数据的许可标为**未决**并列为**所有者决定**；provenance 里写的是 `"licence": "unresolved"`。
- 所有者对 LR 的授权范围（2026-10-10 记录）是「抓取该站点**公开可用数据**」，用于个人 Alpha 的**一次性**词表/释义抓取。**音频不在这个范围里**，理由有三，任一条都独立成立：
  1. 公开端点返回的是 JSON/base64，**不是音频资产**；音频是**按次付费生成的服务结果**，不是「公开可用数据」；
  2. 合成音的权利在**供应商**，不在 LR，所有者无法授权他自己不拥有的权利；
  3. 影视片段的权利在**平台/版权方**，LR 同样没有。
- `AGENTS.md` §8 的条文直接适用：*「外刊和第三方内容必须保存来源与许可；禁止未经授权复制全文」*、*「非盈利、个人使用或尚未发布不取消来源、平台条款、许可、署名和撤下义务；不得绕过付费墙、访问控制、DRM 或平台下载限制」*。§12 还要求实际复用他人资源前记录**授权人、授权形式、文件范围、商业与闭源许可、署名要求**——LR 音频没有任何一项能满足。
- **能证明的与不能证明的**：能证明的是「LR 自己有权播放这些音频」（它是在自己的服务里用）；**不能证明**的是「它有权把音频作为文件转授给我们」。在后者被书面证明之前，抓取即违反上述条文。

### 6.4 一条对我们更有利的事实：我们要的音频，自己就有

- 库里 **5,309 个词的例句来自带毫秒级词时间轴的已发布媒体段**（本次只读实测：`media_segments` 99,285 段中 69,586 段有 `words` 时间轴），而这些内容是我们**自己发布、自己记录了来源/版权/许可**的（`media_versions.copyright_status = 'cleared'`）。
- 所以「真人原声」这条路我们不需要 LR：它的权利链在我们自己手里，而 LR 在**词表页面上恰恰给不出这个**（它的词表音全是合成音，原声只出现在已保存条目上）。
- 若确实要合成音并追求「真人级」，正确做法是**自己直接对接供应商**：我们自己的 key、额度、条款与缓存，届时「能不能用」由我们与供应商的条款回答，而不是靠复制别人的产物。本次已实测 MiniMax 服务可用但**没有西语系统音色**（见 §7）。

### 6.5 不作断言的部分

- 未确认 LR 的 TTS 供应商、音色与条款文本（LR 的 `/terms`、`/privacy` 是客户端渲染空壳，前序文档已记录）。
- 未确认 Dioco 与 LR 的法律关系（同 IP、生产 bundle 硬编码私网地址 `10.66.66.10`，但**无官网、无 A 记录、无任何可引用的条款文本**）。
- 未测试「抓下来会怎样」——**本次不抓取、不下载任何 LR 音频**，也不做可行性验证。这类验证本身就要先过授权。

---

## 7. 附：MiniMax 服务端 TTS 的**西语能力实测**（为同一设计问题补测）

LR 用的是自家端点，我们若要换服务端 TTS 就必须自己验一次。以下是**本次真实调用**（4 次，短句，费用可忽略）：

- 模型：`speech-2.8-turbo`，端点 `https://api.minimax.cn/v1/t2a_v2`，`language_boost: "Spanish"`，`output_format: "hex"`
- 文本：`Buenos días, ¿qué tal? Quiero aprender español.`（47 字符）

| voice_id | HTTP | `base_resp` | 延迟 | 音频字节 |
|---|---|---|---|---|
| `English_expressive_narrator` | 200 | `0 / success` | **1,547 ms** | 64,500 |
| `English_Graceful_Lady` | 200 | `0 / success` | **919 ms** | 82,932 |
| `Chinese (Mandarin)_Gentleman` | 200 | `0 / success` | **599 ms** | 59,892 |
| `Spanish_Reliable_Man` | 200 | **`2054 / voice id not exist`** | 96 ms | 0 |

**结论（三条，都是设计前提）**：

1. **服务是通的、速度够用**：47 字符短句 **0.6–1.5 s** 返回整段 mp3。单词更短，实际会更快；但这是**一次网络往返 + 合成**，不是本地的 0 ms。
2. **官方系统音色表里没有西语音色**：`Spanish_*` 直接 `voice id not exist`（错误码 `2054`）。文档声称支持 40 种语言（含西班牙语，见 [Supported Languages](https://platform.minimax.io/docs/guides/speech-t2a-websocket)），但**音色是英语/中文标签的**——即西语输出靠的是**跨语言合成**（英语音色读西语），是否是合格发音基准**没有验证，必须由人耳判断**。
3. **音色清单与定价要先定**：订阅档（[Audio Subscription](https://platform.minimax.io/docs/guides/pricing-speech)）从 **$5/月 = 100,000 audio points、RPM 10** 起，且**需要 voice slot**；本仓库 `.env` 目前**没有** `MINIMAX_TTS_VOICE_ID`，所以 `MiniMaxTextToSpeech` 现在必然抛 `not-configured`（`minimax-tts.ts:49`）。

> **实测音频**（供所有者人耳判定口音是否可接受，未提交版本库）：
> `.tmp-lr-tts-voices/English_expressive_narrator.mp3`、`English_Graceful_Lady.mp3`、`Chinese_Mandarin_Gentleman.mp3`
> 复现：`npx tsx .tmp-minimax-tts-voice-probe.ts`（脚本默认最多 4 次调用，`PROBE_MAX_CALLS` 可调）
>
> **如实说明**：听感由所有者判断，本次未做任何音质评分，也不把「HTTP 200」当作「发音正确」。voice slot 数量、audio point 与字符的换算比例、以及西语是否必须自建音色（voice clone），本次**未验证**。

---

## 8. 复现方式

```powershell
# 归档 bundle 已在仓库内（gitignored）
node .tmp-lr-tts-extract.mjs .tmp-lr-research/assets/assets__index-B2o7oYbu.js "speakSavedItem(" "async function SCe(" "async function xRe("
node .tmp-lr-tts-extract.mjs .tmp-lr-research/assets/assets__index-B2o7oYbu.js "async function VAe(" "preferredAudioSource"
# 文案键全量：
Select-String -Path .tmp-lr-research/lr-strings.md -Pattern 'speak|audio|朗读|发音|语速'
```

---

## 9. 证据文件

| 路径 | 内容 |
|---|---|
| `.tmp-lr-research/assets/assets__index-B2o7oYbu.js` | 当天线上主 bundle 归档（3,167,852 字符，sha256 前 16 位 `4c3d5a881a91b926`），本文全部源代码片段出自此文件 |
| `.tmp-lr-research/assets/assets__SavedItems-CRs5W6Ef.js` | `/saved-items` 路由 bundle；本次在其中确认 `record`/`getUserMedia` **零命中** |
| `.tmp-lr-research/lr-strings.md` | 文案键摘录（`speakWordOnClick`、`preferredAudioSource_GT`、`loadingAudio_GT` 等） |
| `.tmp-lr-tts-extract.mjs` | LR bundle 只读切片脚本（本仓库根目录，gitignored） |
| `.tmp-minimax-tts-voice-probe.ts` | MiniMax 西语能力探测脚本（§7 的表格由它产出，gitignored） |
| `.tmp-lr-tts-voices/*.mp3` | §7 三次成功合成的原始音频，待人耳判定（gitignored） |

> 本文未修改任何产品代码、未写入任何数据库、未访问 LR 站点。
>
> **对外的如实披露**：§7 为验证「服务端 TTS 能不能做西语发音基准」**真实调用了收费 provider 4 次**（3 次成功、1 次报 `voice id not exist`），全部为极短文本；除此之外本次没有其它供应商调用。LR 侧证据全部来自仓库内已有的归档 bundle，**未访问其站点**。
