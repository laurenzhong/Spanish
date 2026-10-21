# Language Reactor 悬停词典交互机制实测（hover dictionary）

- 日期：2026-10-12（观测窗口 `2026-10-12T13:06–13:22 +08:00`）
- 观测对象（唯一）：`https://www.languagereactor.com/c/es/yt/t_yt_mix_es/yt_NbwJNoL9EoM` —— 视频页 → `文本` 标签下的**逐句字幕列表**（13 行句子 / 159 个可 hover 的词），**未登录**即可用
- 观测目的：回答「LR 的 hover 词典弹层为什么能在指针从词移动到弹层内部控件的过程中保持打开」——用于修正我们词汇页上那个"真手够不到两个标记按钮"的悬停卡片
- 授权与性质：**只读观测**。未修改任何产品代码、未写数据库、未点击任何会改动 LR 账号数据的控件（弹层里的 stage 按钮只用命中测试与指针停留验证可达性，未提交状态变更）
- 前置文档：`docs/references/2026-10-11-language-reactor-dictionary-probe.md`。该文 §1.2 与 §9.7 明确记为「**未做浏览器 hover 观察**」，本文正是补上这一项；端点与译文数据见该文，本文不重复

---

## 0. 直接回答

| 问题 | 实测回答 |
|---|---|
| LR 在哪里有 hover 翻译？ | 视频页 `文本` 标签的**逐句字幕列表**：悬停句中任意词即出中文弹层（实测 `terremoto → 地震/地动/大地震`）。**未登录可用** |
| 关闭触发在词上还是更大容器上？ | **在整行句子上**（`span.sentence-view`），不是词。指针停在同一行的空白/数字 token 上 2 秒，弹层仍开着 |
| 有关闭延迟吗？多长？ | 有。离开**句子容器**后调度关闭，实测 **109.6 ms / 116.9 ms** 后弹层从 DOM 移除（源码常量 `100`） |
| 指针必须到达弹层才能保持吗？ | **必须，但几乎必然到达**：弹层自身带 12 px 内边距，其外沿与词的顶边**完全贴合（实测 186 px == 186 px，死区 0 px）**；进入弹层会显式 `cancelHide()` |
| 弹层里有可交互控件吗？ | **有**。弹层内含 `lln-word-stage-btn` 的 **已知（✓，`lln-stage-known`）** 与 **学习中（📖，`lln-stage-learning`）** 两个按钮（各 38×26 px，`pointer-events: auto`），另有词形组合（composition）入口。点击即写入该词状态 |
| 指针路径能活着走完吗？ | 能。**40 步 × 30 ms ≈ 1.2 s** 的慢速行程，从词走到 ✓ 按钮，每一步弹层都在；停在按钮上 2 s 仍在 |
| 那"点击词"是更持久的路径吗？ | 是另一条独立路径（源码证据，本次未点击）：点击词 → `showFullDictionary` → 右侧词典抽屉（`MuiDrawer-root lri-Main-dict`）。**但悬停本身就足以标记**，不需要先点击 |

**一句话结论**：LR 让真手够得到的做法不是"更长的延迟"，而是**空间上根本不存在死区**——弹层自带 12 px 内边距、其外沿与词贴合，且这块内边距属于"进入即取消关闭"的那个元素；100 ms 只是从句子容器离开到进入弹层之间的容错窗口。

---

## 1. 方法与证据等级

| 标记 | 含义 |
|---|---|
| **实测** | 本次在真实 Chromium 中用真实指针事件驱动、直接读取 DOM/事件时间戳所得 |
| **源码** | 来自 LR 当天部署的前端 bundle（与本地归档逐字节相同，见 §6） |
| **推断** | 由实测或源码归纳，LR 未文档化 |
| **未观测** | 本次无法观测，如实列出（见 §7） |

方法：

1. 用 Playwright（`@playwright/test`）以持久化 profile `D:\workspace\.tmp-lr-research\lr-profile-hover` 启动 Chromium（headless），真实鼠标经 `page.mouse.move` 驱动。
2. 页面侧注入两类记录器：`MutationObserver` 记录 `.hover-dict` 的**出现/移除时间戳**（`performance.now()`，0.1 ms 精度）；document 捕获阶段监听 `mouseover/mouseout/mouseenter/mouseleave`，记录**事件本身**的时间戳与 `relatedTarget`。延迟因此不需要经驱动往返推算。
3. 每个采样点用 `document.elementFromPoint(x, y)` 记录指针下方真实元素，用于判定"死区"。
4. bundle 只读：`assets/index-B2o7oYbu.js`（3,167,852 字符）当天线与本地归档 **sha256 前 16 位均为 `4c3d5a881a91b926`，逐字节相同**。

登录态说明：持久化 profile 中的 Firebase 会话**已过期**（落地页实测显示「登录 / 未登录」），`/saved-items` 显示「请登录以使用此功能。」。本次**未登录、未绕过任何访问控制**；所幸 hover 词典本身在字幕列表上匿名可用，观测因此不受影响。

---

## 2. 观测到的表面与位置

- URL：`https://www.languagereactor.com/c/es/yt/t_yt_mix_es/yt_NbwJNoL9EoM`
- 进入方式：打开视频页 → 顶部 `文本` 标签（`文本 / 词语` 两个标签；`词语` 是词表，`文本` 是逐句字幕列表）
- 可 hover 的 DOM：每行 `<span class="sentence-view">` 内含 `<span class="lln-word" data-token-index="N"><span class="dc-down dc-hover dc-lang-es dc-orig">词</span></span>`
- 实测计数：`sentenceViews = 13`、`llnWords = 159`
- 弹层出现后：`document.querySelectorAll('.hover-dict').length === 1`
- 截图：`docs/evidence/2026-10-12-language-reactor-hover/01-hover-popup-with-stage-buttons.png`（弹层与指针停在 ✓ 按钮上）、`02-transcript-hover-popup-1440x900.png`（整页：右侧字幕列表 + 弹层）

> 未登录也能悬停出译文，是因为 `base_dict_getHoverDict_8` 是匿名 GET（见前置文档 §2.1）；本次网络日志实测命中：
> `GET https://api-cdn-plus.dioco.io/base_dict_getHoverDict_8?form=terremoto&lemma=&sl=es&tl=zh-CN&pos=NOUN&pow=n → 200`
> 另有批量端点 `POST base_dict_getHoverDictEntriesForSubs → 200`（在浏览器上下文中返回 200；前置文档记录匿名 `Invoke-WebRequest` 为 400，差异未追查）。

---

## 3. 打开 / 关闭生命周期（实测）

### 3.1 弹层的 DOM 结构与命中范围

```
SPAN.hover-dict                     pointer-events: auto   ← 译文内容（3 条，opacity 1 / 0.8 / 0.6）
  ↑ DIV  style="padding:4px 8px"    pointer-events: auto   ← 可见卡片（背景 #303338、圆角 4px）
    ↑ DIV  style="padding:0 0 12px" pointer-events: auto   ← 12 px 不可见内边距，朝锚点（词）一侧
      ↑ DIV.MuiPopper-root          pointer-events: auto   ← portal，挂在 BODY 下，z-index 1500
        ↑ BODY.hide-scrollbar
```

关键实测几何（`terremoto`，placement = `top`）：

| 量 | 值 |
|---|---|
| 词的顶边 `wordTop` | **186 px** |
| 弹层命中区底边 `wrapper.bottom` | **186 px** |
| 可见卡片底边 `card.bottom` | 174 px |
| **词与弹层命中区之间的死区** | **0 px** |
| 那 12 px 条带是否可命中 | 是。`elementFromPoint(962, 182/184)` 命中 `DIV.`（弹层内边距），不是词、也不是卡片 |
| 弹层是否在句子容器内 | **否**。它在 `BODY` 下的 portal 里（`popup.closest('.sentence-view') === false`） |

> 也就是说：指针从词往上走，第一个像素起就已经在弹层的命中区里了；"从词到弹层"这一段在几何上不存在过渡带。

### 3.2 关闭延迟：两种情形，数值不同（实测）

| 情形 | 触发事件 | 弹层从 DOM 移除的时刻 | 延迟 |
|---|---|---|---|
| 指针离开**句子容器**，且从未进入弹层 | `mouseleave` on `SPAN.sentence-view` | 两次独立运行：`+109.6 ms` / `+116.9 ms` | **≈110–117 ms**（源码常量 `100`） |
| 指针离开**弹层自身**（即使仍在同一句内） | `mouseleave` on 弹层 | `+15.9 ms` | **立即（无延迟）** |
| 指针从词直接进入弹层 | `mouseleave`(句子) 与 `mouseenter`(弹层) **同一毫秒内**（实测相差 0.1 ms） | **弹层从未卸载**（`popup transitions during that jump: []`） | — |

即：`hideWithDelay()` 的 100 ms 计时器被弹层 `onMouseEnter → cancelHide()` 在同一次事件派发里清掉，弹层连一帧都没消失。

### 3.3 容错窗口：指针"在弹层外停留"多久还可以进入（实测）

从词上跳到一个**既不在句子内、也不在弹层内**的暂存点，等 N ms 后再进入弹层的 12 px 条带：

| 等待 | 进入前弹层还在吗 | 进入后弹层还在吗 |
|---|---|---|
| 20 ms | 在 | **在** |
| 60 ms | 在 | **在** |
| 90 ms | 在 | 不在（检查→移动的驱动往返把它耗过了 100 ms） |
| 110 / 150 / 300 ms | **已关** | 不在 |

窗口 ≈ 100 ms，与源码常量一致。**但由于死区为 0，正常路径根本用不到这个窗口**（见 §3.4）。

### 3.4 指针路径：慢速真手实测

- **40 步 × 30 ms ≈ 1.2 s**，从词中心直线走到 ✓ 按钮中心，第 8/16/24/32/40 步采样：`up / up / up / up / up`，终点仍在。
- 停在该按钮上 **2.0 s**：弹层仍在，`elementFromPoint` = ✓ 按钮内的 `svg`。
- 悬停在**只有 12 px 内边距、没有卡片**的条带上 **2.5 s**：弹层仍在（命中 `DIV.`，`inCard = false`）——条带自身就能维持打开。
- 悬停在同一句内的**空白/非词 token**（`lln-not-word`，如 `7.2`）上 **2 s**：弹层仍在，仍显示原词的译文（说明触发粒度是整行）。
- 同句内从一个词滑到另一个词（`terremoto → Pacífico`）：弹层内容换成新词，1.5 s 内 10 次采样连续可见（中间有一次 8–9 ms 的卸载/重挂闪动，是换词取数引起）。
- 从弹层移回原词：弹层先卸载、6.1 ms 后带同一内容重挂。
- 在当前滚动容器内滚动 120 px：弹层立即关闭。

---

## 4. 弹层内部的可交互控件（实测）

```html
<span class="lln-hover-stage-picker-wrap">
  <div><div style="display:flex;align-items:center;padding:0;margin:8px -4px -4px;">
    <div class="lln-word-stage-btn lln-stage-known in-hover-dict OFF">
      <svg data-testid="CheckIcon">…</svg></div>
    <div class="lln-word-stage-btn lln-stage-learning in-hover-dict OFF">
      <svg data-testid="MenuBookIcon">…</svg></div>
    …
```

| 控件 | 类名 | 实测尺寸 | `pointer-events` |
|---|---|---|---|
| 已知（✓ 对勾） | `lln-word-stage-btn lln-stage-known in-hover-dict` | 38 × 26 px | `auto` |
| 学习中（📖 书） | `lln-word-stage-btn lln-stage-learning in-hover-dict` | 38 × 26 px | `auto` |

- 二者是 `<div>`（**不是** `<button>`），因此按 `button` 选择器找不到它们；用 `.lln-word-stage-btn` 定位。
- 它们是**同一个卡片盒子内部**的一部分（卡片 `padding: 4px 8px`，选择器 `margin: 8px -4px -4px`），卡片与按钮之间**没有空隙**。
- 源码：`onChange: h => h === "REMOVE" ? r.removeItem(l.key) : r.setItemStage(l, h, !1, s)`；显示条件 `!readOnly && settings.showStageButtonsInHoverDict !== "NO"`，同一个条件也决定弹层 `pointer-events` 是 `auto` 还是 `none`（源码原文：`style:{zIndex:1500,pointerEvents:r?"auto":"none"}`）。
- **本次未点击这两个按钮**（会改动 LR 账号内的词状态），只验证了可达性：指针走到按钮上、停住 2 s、弹层存活、命中测试落在按钮内的 `svg` 上。

---

## 5. 我们卡片的问题定位（**代码阅读 + 推断，非 LR 观测**）

> 本节不是对 LR 的观测结论，而是把 §3 的实测基线套到我们自己的实现上得到的判断，**未在真实浏览器里观测我们的页面**（本次不启动 dev server）。请按"待验证假设"处理。

`src/modules/lexicon-corpus/ui/vocabulary-shelf.tsx` + `app/(product)/read/vocabulary/vocabulary-shelf.css`：

1. **卡片与两个按钮之间存在 4 px 死区**（最强嫌疑）。
   层是 `display: grid; gap: 4px`，卡片 `.vocabulary-shelf__translation` 与按钮组 `.vocabulary-shelf__translation-actions` 是**两个同级网格项**，而层本身 `pointer-events: none`（只有卡片和按钮组是 `auto`）。指针从卡片往下走到按钮，必须穿过这 4 px；这 4 px 里没有任何命中目标，`elementFromPoint` 会落到层**后面**的元素——层是 `position:absolute; top: calc(100% + 6px)`，浮在**下一行词**之上，所以落到的极可能就是下一行的 tile。于是 `onMouseOver` 的 `showTranslation(下一行的 tile)` 把卡片换到邻词，按钮随之消失。这与"从词走到卡片上就消失、按钮点不到"的现象一致。
   对照 LR：按钮在**卡片盒子内部**，`4px 8px` 的卡片里直接是 stage picker，**不存在这个缝**。

2. **进入卡片不会取消已调度的关闭**。关闭只由"离开行"调度（`onMouseOut` 里 `relatedTarget` 不在 `tile.parentElement` 内时 `hideAfterLeaving(tile)`），而取消条件是 `hoveredTileRef.current !== tile`——只有**另一个词**被 hover 才取消。LR 有显式的 `onMouseEnter → cancelHide()`。

3. **延迟 320 ms 比 LR 的 100 ms 长，但这不解决问题**。延迟只能容忍"离开触发器 → 进入弹层"这段**时间**；死区是**空间**问题：指针停在不属于任何命中目标的位置时，延迟到点照样关。

4. 已有的 6 px 外层桥（`::before`，`pointer-events: auto`）方向是对的，与 LR 的 12 px 内边距同构；缺的是**内层那条缝**也要被覆盖。

---

## 6. 源码证据（与线上逐字节相同）

`https://www.languagereactor.com/assets/index-B2o7oYbu.js`：HTTP 200，**3,167,852 字符，sha256 前 16 位 `4c3d5a881a91b926`**，与本地归档 `D:\workspace\.tmp-lr-research\assets\assets__index-B2o7oYbu.js` **完全相同**（对 `hideWithDelay` / Popper / `sentence-view` / stage picker / `cancelHide` 五段切片逐一比对，`identical: true`）。以下为当天线上代码原文。

**关闭/取消（store，`Bne` 类）**

```js
hideTooltip(){clearTimeout(this._hideTimeout),this._hoverDictRequestNum++,this.anchorEl=null,this.actionContext=null}
hideWithDelay(){clearTimeout(this._hideTimeout),this._hideTimeout=setTimeout(()=>this.hideTooltip(),100)}
cancelHide(){clearTimeout(this._hideTimeout)}
```

**触发器：整行句子，不是词**

```js
y.jsx("span",{className:"sentence-view",lang:…,dir:…,
  onMouseLeave:()=>{i.current=null,Fo.hideWithDelay()},
  onMouseEnter:()=>{Fo.cancelHide()},
  onClick:d=>{ … It.showFullDictionary({type:"WORD",item:m},null,t.phrasePump?"PHRASEPUMP":void 0) … },
  onMouseOver:d=>{const h=Zw(d);if(!h||h.wordEl===i.current)return;i.current=h.wordEl;
     const m=t.getWordItem(h.tokenIndex);
     m&&Fo.showHoverDictionary(m,{…},void 0,h.wordEl,t.phrasePump?"PHRASEPUMP":void 0)},
  onContextMenu:…,onMouseDown:…})
```

词由命中测试解析（`Zw`）：`e.target.closest(".lln-word")` 取其 `data-token-index`；同一个词元素不重复触发（`h.wordEl === i.current` 直接 return）。

**弹层：朝锚点一侧的 12 px 内边距 + 进入即取消**

```js
style:{zIndex:1500,pointerEvents:r?"auto":"none"},
children:({TransitionProps:a,placement:s})=>{
  const o=s.split("-")[0],
        l=o==="top"?{paddingBottom:12}:o==="bottom"?{paddingTop:12}:
          o==="left"?{paddingRight:12}:o==="right"?{paddingLeft:12}:{padding:12};
  return y.jsx($m,{...a,timeout:{enter:200,exit:0},…,children:
    y.jsx("div",{style:l,
      onMouseEnter:()=>t.cancelHide(),
      onMouseLeave:()=>t.hideTooltip(),
      children:y.jsx("div",{style:{background:"#303338",border:"1px solid #ffffff16",borderRadius:"4px",padding:"4px 8px"},
        children:y.jsx(cie,{hoverDictStore:Fo,…})})})})}
```

Popper 修饰符：`preventOverflow(boundary:"viewport")` + `flip(fallbackPlacements:["bottom","right","left"])`；过渡 `timeout:{enter:200,exit:0}`。

**弹层内容里的 stage 按钮**

```js
!o.data.readOnly && n.getUserSettings()?.showStageButtonsInHoverDict!=="NO" &&
y.jsx("span",{className:"lln-hover-stage-picker-wrap",children:y.jsx(b2,{variant:"in-hover-dict",
  onChange:h=>{h==="REMOVE"?r.removeItem(l.key):r.setItemStage(l,h,!1,s)}, …})})
```

**其他会关闭弹层的时机（源码）**：`window` 的 `scroll`（passive）→ `Fo.hideTooltip()`；出现 `[role=dialog]` 时 → 隐藏。

---

## 7. 未观测 / 未解（如实列出）

1. **LR 自己的词表页（`/saved-items` 的词汇 / ALL_WORDS）未能观测**：实测显示「请登录以使用此功能。」。持久化 profile 里的 Firebase 会话已过期，本次**未登录、未借用任何凭据、未绕过访问控制**。因此"LR 的词表列表是否也用 hover 弹层"**没有观测到**，只能说：我们观测到的字幕列表用的是共享的 `sentence-view` + `Fo`(hoverDictStore) 组件，而 `SavedItems` 分块 bundle（`assets/SavedItems-*.js`）里**完全不含** `sentence-view / hover-dict / hideWithDelay / lln-word-stage-btn` 任何一个字符串（实测 0 命中）——但这**不能**证明词表页没有 hover 弹层，因为共享组件打包在主 bundle 里。
2. **视频页 `词语` 标签的词表在本次运行中没有渲染出行**（`llnWords = 0`，表格行数 0），因此该表面是否可 hover **未观测**。
3. **点击词 → 右侧词典抽屉**这条路径**只有源码证据**（`onClick → showFullDictionary`；`MuiDrawer-root lri-Main-dict` 元素确实存在于页面中）。本次**刻意未点击**：该路径会写客户端设置 `Ae.settings.mainNavigationMinimizedOnDesktop = true`，属于改动账号态，超出"只读观测"范围。
4. `/text`（我的文本）在未登录时被重定向到媒体列表页，**阅读器视图未能观测**。
5. 未测量弹层"首次出现"的端到端延迟（需要网络往返）；只观察到换词时会有 ~8–9 ms 的卸载/重挂闪动。

---

## 8. 对我们要改的地方的具体建议

### 8.1 LR 只依赖三件事（按重要性）

1. **死区为 0**：弹层自身带 12 px 内边距，其外沿与词贴合（实测 186 == 186）。桥不是"另一个元素"，而是**弹层自身的一部分**——所以进入桥就等于进入弹层，同一个 `onMouseEnter` 就能取消关闭。
2. **进入弹层必须显式取消关闭**（`cancelHide()`）。100 ms 只是"从触发器容器离开到进入弹层"的容错窗口，不是主要机制。
3. **触发粒度是整行，不是词**：同句内词与词、词与空白/标点之间移动都不会调度关闭。

### 8.2 建议的改法

| # | 动作 | 依据 |
|---|---|---|
| 1 | **把两个标记按钮移进卡片盒子内部**（同一个 `padding`、同一个背景框），或在卡片与按钮之间加一条 `pointer-events: auto` 的桥，使这条缝也属于命中目标 | LR 的 stage picker 就在卡片的 `padding:4px 8px` 盒子里；我们的 4 px 网格缝没有任何命中目标 |
| 2 | 在卡片（以及按钮组）上加 `onMouseEnter → 清除待关闭计时器`；不要只靠"另一个词被 hover"来取消 | LR 有 `cancelHide()`，我们的取消条件只覆盖换词 |
| 3 | 关闭延迟 100–150 ms 即可（我们现在是 320 ms）。**不要用延迟弥补死区**：延迟管时间，死区管空间 | 实测 LR 100 ms；死区 0 px 时窗口根本用不到 |
| 4 | 保持"离开卡片本身立即关闭" | LR 实测 15.9 ms 关闭；残留卡片会遮住邻词 |
| 5 | 外层 6 px 桥保留，但让它与"进入即取消"的元素**是同一个**（或在两者上各挂一次取消） | LR 的 12 px 内边距与 `onMouseEnter` 同在一个 `div` 上 |

### 8.3 测试怎么改（"测试比真手宽容"的根因）

现状 `scripts/verify-vocabulary-page-browser.ts`（约 L467–484）：

```ts
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
await page.waitForTimeout(120);
```

三处使这个断言几乎不可能失败：

- `steps: 6` 的中间点由 Playwright **连续同步派发、步间无延时**，整段行程约 0 ms（真手是每帧 1–3 px、总耗时 200–600 ms）；
- 随后只等 120 ms 就断言存活，而关闭延迟是 180/320 ms——**即使真的被调度关闭，也发生在断言之后**；
- 6 个采样点等距落在一条直线上（间距约 8–10 px），正好可能整段跨过 4 px 死区。

改法：

1. **逐点移动 + 步间 `waitForTimeout(16–30)`，每一步都断言**层仍在（不是只在终点断言一次）。
2. 每一步同时断言命中目标合法：`document.elementFromPoint(x, y)` 的结果必须满足 `closest('[data-word-key], #vocabulary-translation-layer')` 非空——即"既没有落到别的词上，也没有落到层外"。**这条断言正是死区的探测器**，比"层是否还在"更早暴露问题。
3. 除直线外再走一条**弧线**（先横向过冲 20–40 px 再折回按钮），这是真手最常见的轨迹。
4. 到达按钮后再等 ≥ 关闭延迟 + 100 ms 才点击，验证"停住不动仍然在"。
5. 键盘路径（从词 Tab 进按钮）保留为兜底：它不依赖任何指针几何，实测我们已有该路径，LR 未观测到等价物。

---

## 9. 复现方式

只读，无需登录（hover 部分）。

```powershell
# 观测脚本都在 gitignored 的 .tmp-lr-research/ 下
cd D:\workspace\.tmp-lr-research\hover

node live-01-recon.mjs          # 会话状态 + 线上 bundle 字节数/hash + 哪个页面有 sentence-view
node live-02-hover.mjs          # 弹层解剖（祖先链/内边距/按钮）、40 步指针路径
node live-04-timing.mjs         # 桥几何、容错窗口表、按钮命中、滚动
node live-05-events.mjs         # 事件级延迟（100→实测 110/117 ms）、逐像素命中列、1.2 s 慢速行程
node live-07-leave-popup.mjs    # 离开弹层本身 = 立即（15.9 ms）
node live-06-other-surfaces.mjs # /saved-items 登录墙、词语标签
node compare-bundle.mjs         # 线上 bundle vs 本地归档逐字节比对

# 读 bundle（只读）
node scan.mjs "D:\workspace\.tmp-lr-research\assets\assets__index-B2o7oYbu.js" "hideWithDelay|cancelHide" 500 500 20
node slice.mjs "D:\workspace\.tmp-lr-research\assets\assets__index-B2o7oYbu.js" 3119500 3122100
```

手动步骤（最少版）：打开视频页 → 点 `文本` → 把指针放到任意西语词上（如 `terremoto`）→ 弹层出现 → 把指针慢慢往上移到 ✓ 按钮上停住 → 弹层不关。

**注意**：视频页有时会优先渲染 YouTube 播放器而**不渲染字幕列表**（本次约半数运行如此）。脚本里的 `loadTranscript()` 会点击 `文本` 标签并重载页面直到 `sentence-view > 0`。

---

## 10. 证据文件

| 路径 | 内容 |
|---|---|
| `docs/evidence/2026-10-12-language-reactor-hover/01-hover-popup-with-stage-buttons.png` | 弹层（3 条中文译文）+ ✓/📖 两个按钮，指针停在 ✓ 上 |
| `docs/evidence/2026-10-12-language-reactor-hover/02-transcript-hover-popup-1440x900.png` | 整页：视频页 `文本` 标签的逐句字幕列表 + 悬停弹层 |
| `docs/evidence/2026-10-12-language-reactor-hover/03-saved-items-login-wall.png` | `/saved-items` 的「请登录以使用此功能。」（§7.1 的证据） |
| `.tmp-lr-research/hover/live-{01,02,04,05,06,07}/report.json` | 每次运行的原始 JSON（事件时间戳、命中列、几何、网络日志） |
| `.tmp-lr-research/hover/live-bundle.js` | 当天线上 bundle 本地副本（sha256 前 16 位 `4c3d5a881a91b926`） |
| `.tmp-lr-research/assets/assets__index-B2o7oYbu.js` | 归档 bundle（与线上逐字节相同） |

> `.tmp-lr-research/` 被 `.gitignore` 的 `.tmp-*/` 规则忽略，其中的抓取产物不会进入版本库；本文引用的数值与代码片段均为本次实测逐字复制。
