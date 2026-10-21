# Language Reactor 侧边栏词典（full dictionary drawer）实现逻辑与用法

- 日期：2026-10-12（观测窗口 `2026-10-12T22:0x–22:2x +08:00`）
- 观测对象：`https://www.languagereactor.com/c/es/yt/t_yt_mix_es/yt_NbwJNoL9EoM`（视频页「文本」标签，**未登录**）
- 观测目的：为 Sueño 词汇页的右侧侧边栏（点击单词打开）提供**实现逻辑与交互用法**的一手依据
- 方法：Playwright 真实 Chromium（1440×900，headless）客户端点击 + 同一个 bundle 的只读切片（`.tmp-lr-research/assets/assets__index-B2o7oYbu.js`，与线上逐字节相同）
- 原始产物：`.tmp-lr-research/drawer/run2/report.json`、`01-drawer-open.png`（均在 gitignored 目录）

## 0. 直接结论

| 问题 | 实测/源码答案 |
|---|---|
| 它是什么容器？ | MUI `Drawer`，`variant` 桌面为 **`persistent`**（**推开内容**，不是浮层），`anchor="right"` |
| 多宽？ | 按视口分档：`>=1440 → 440px`，`>=1200 → 400px`，否则 **350px**（`uRe(screenWidth)`，实测 1440 下 440px） |
| 怎么推开的？ | 主内容加 `margin-right: dockedDictInsetPx(showFullDict)`，该值即面板宽（关闭时为 0）。实测主区宽 **1381 → 941**（= 440 的差） |
| 定位与层级 | 容器 `position: fixed; z-index: 1000`；`paper` `height: 900`（满高）、`boxShadow: none`、圆角 0 |
| 动画 | `transition: transform 0.225s cubic-bezier(0, 0, 0.2, 1)` |
| 手机上呢？ | `variant="temporary"`、`anchor="bottom"`、**高 88%**、顶部两角 8px 圆角，并加 safe-area 底部内边距 |
| 点词怎么打开？ | 字幕里 `onClick` → `showFullDictionary({type:"WORD", item})`；同时**暂停正在播放的视频**（opening 后 200/400/600/800ms 四次检查并 pause），并把左侧主导航收起（`mainNavigationMinimizedOnDesktop = true`） |
| 点词会朗读吗？ | **会，但取决于设置**：`settings.speakWordOnClick`（默认 `true`）→ 同一次点击先开面板再读该词。本次实测该开关为 **off**，所以没出声 |
| 怎么关闭？ | ① 面板自己的 `onClose`；② **浏览器返回键**——打开时 `history.pushState({dictOpen:true})`，`popstate` 里置 `showFullDict=false`；③ 移动端**右滑**（`onSwipeRight`）。**`Escape` 不关闭**（实测按 Escape 后仍在，`stillOpen: true`） |
| 关闭时有哪些清理？ | `showFullDict === false` 时，若焦点还在 `.lri-Main-dict` 内则 `blur()`（避免焦点留在隐藏面板里） |
| 内容顶部是什么？ | 两个 tab：`词典`（默认选中）与 `Lexa AI 对话 beta`；tab 条高 **36px**、`border-bottom: 1px solid rgba(255,255,255,0.12)`、`variant="fullWidth"`（每个 tab 217px） |
| 打开时长什么样？ | 顶部一个**把点中的词填进去的翻译输入框**（`textarea`，实测 value = `un`）+ 清空按钮 + 历史按钮；下面是词条本体 |
| 词条本体结构（实测 class） | `.lln-full-dict`（高 1698，即内容远长于可视区）内含：`.lln-dict-contextual`（词 + 语境译文 + 喇叭 + 学习阶段按钮组）→ `hr` → Lexa 笔记 → `.lln-external-dicts-container`（`lln-external-dict-btn`：Re/Gl/Wi/GPT 等外链词典）→ `.lln-word-examples`（`示例：当前文本` + 每条 `.lln-word-example.sentence-row`，**每条都带 `lr-play-btn` 可单独播放原声**）→ `示例：Tatoeba` |
| 学习阶段按钮 | `.lln-word-stage-btn`，桌面为**三个 `<div>`**：`lln-stage-known`（56×35）、`lln-stage-learning`（56×35）、`lln-stage-skipped`（45×30），外加 `lln-stage-remove.ghost`（20×29）。`OFF` 表示未选中 |
| 滚动容器 | 面板内部一个 `overflow-y: auto` 的 div（实测 `scrollHeight 1753 / clientHeight 821`），并 `overscroll-behavior: contain`；滚动时**主动隐藏所有 tooltip**（`Fo.hideTooltip()`） |
| 焦点/键盘 | 面板内可聚焦元素在关闭时被 `blur()`；未观测到 Escape 或方向键快捷键 |
| 源码入口 | `showFullDictionary(type, anchor, actionContext)`：`type` 可为 `WORD` / `TRANSLATION` / `AUDIO`；请求带 `_fullDictRequestNum` **代次号**，过期响应直接丢弃 |

## 1. 打开这一下发生了什么（源码顺序）

```js
onClick: (event) => {
  const hit = wordFromEvent(event);              // closest('.lln-word') → tokenIndex
  if (!hit) return;
  event.preventDefault(); event.stopPropagation();
  const item = getWordItem(hit.tokenIndex);
  if (!item) return;
  settings.mainNavigationMinimizedOnDesktop = true;      // 收起左侧主导航
  fullDict.showFullDictionary({ type: "WORD", item });    // 打开右侧面板
  if (settings.speakWordOnClick) speakWord(text, lang);   // 默认开：顺手朗读
}
```

`showFullDictionary` 内部：

```js
this.data._fullDictRequestNum += 1;                 // 代次号
this.data.showFullDict = true;
[200, 400, 600, 800].forEach(ms => setTimeout(() => {   // 视频还在播就暂停
  const man = this.data.currentSubsContext?.playbackMan;
  if (man?.isPlaying()) man.pause();
}, ms));
```

**代次号是这套实现里最值得抄的一条**：任何一次新的打开都会让旧请求的结果作废，避免「连点两个词，后到的旧响应把新词的词条覆盖掉」。

## 2. 布局机制（为什么它是「推开」而不是「盖住」）

```js
// 面板宽随视口分档
function fullDictWidthPx() { return uRe(screenWidth) }   // 1440→440, 1200→400, else 350
// 主内容让位
dockFontInsetPx(open) { return open && !floatFullDict() ? fullDictWidthPx : 0 }
// → 主内容 style: marginRight: dockedDictInsetPx(showFullDict)
```

面板本身：

```jsx
<Drawer
  className="lri-Main-dict"
  sx={{ flexShrink: 0, position: "fixed", zIndex: 1000,
        "& .MuiDrawer-paper": { paddingTop: 0, display: "flex",
          ...(mobilePhone
            ? { height: "88%", width: "100%", borderTopLeftRadius: 8, borderTopRightRadius: 8,
                paddingBottom: "calc(64px + var(--safe-area-bottom, 0px))" }
            : { width, maxWidth: "100%" }) } }}
  variant={floatFullDict() ? "temporary" : "persistent"}
  anchor={mobilePhone ? "bottom" : "right"}
  open={showFullDict}
  onClose={() => { showFullDict = false }}
>
  {!mobilePhone && <div style={{ height: 58, flexShrink: 0 }} />}   {/* 让开顶部工具条 */}
  <DictTabs />                                                     {/* 词典 / Lexa AI 对话 */}
  <div style={{ overflowY: "scroll", overscrollBehavior: "contain" }} onScroll={hideAllTooltips}>
    <FullDictContent />
  </div>
</Drawer>
```

`floatFullDict()` 为真时（`/c/.../drills/` 路径或移动端主导航状态）走 `temporary`（浮层），否则 `persistent`（推开）。

## 3. 面板内的信息层级（实测截图 + DOM）

```
[词典] [Lexa AI 对话 beta]                    ← tab，36px，fullWidth
┌ 翻译输入框（预填点中的词 un）        [×] [⟳] ┐   ← textarea，可改词重新查
├ un                                    🔊      ← 词 + 发音按钮
├ 一, 一个, 某                        9  ⓘ    ← 语境译文 + 排名/已知度
├ [✓] [📖] [🚫]                    tags >>     ← 学习阶段三按钮 + 标签入口
├ Lexa 笔记  登录                              ← 需要登录的功能位
├ ──────────────────────────────────────────
├ uno                                          ← 词元
│ (det.) 一, 一个   (pron.) 一, 一位, 一个 …   ← 按词性的义项分组
├ Re Gl Wi GPT                                 ← 外部词典跳转
├ 示例：当前文本                                ← **每条带播放按钮的真实例句**
│   ▶ Y en Panamá, un terremoto de magnitud 7.2 …
│   ▶ El presidente José Raúl Mulino dice que …
├ 示例： Tatoeba
```

## 4. 与 Sueño 当前侧边栏的差距

| 维度 | Language Reactor（实测） | Sueño 现状 | 判定 |
|---|---|---|---|
| 布局 | 桌面 `persistent`：**推开**主内容（主区 1381→941），宽 440/400/350 分档 | 网格第二列（`minmax(260px,320px)`），**也是推开**，宽固定区间 | 机制相同；**宽度档位缺失** |
| 手机 | `temporary` + `anchor="bottom"` + **88% 高** + 圆角 + 安全区 | 断点下退化为单列（面板排在词架下方） | **需调整**：手机应是底部抽屉 |
| 顶部 | **翻译输入框**（预填点中的词，可改词重查）+ 历史 + 清空 | 无（只有词标题 + 朗读 + 关闭） | **需新增**：这是「查另一个词」的入口 |
| 关闭方式 | 返回键（`pushState`/`popstate`）＋面板 `onClose`；**Escape 不关** | `Escape` 关（含停声）＋「关闭」按钮 | **我们更好，保留**；可另加返回键 |
| 焦点清理 | 关闭时把仍在面板内的焦点 `blur()` | 未处理 | **需新增** |
| 收起主导航 | 打开时 `mainNavigationMinimizedOnDesktop = true` | 无（导航不在本页控制范围） | 不适用 |
| 暂停媒体 | 打开后 200/400/600/800ms 四次检查并暂停视频 | 词汇页无媒体 | 不适用 |
| 代次号 | `_fullDictRequestNum` 丢弃过期响应 | 朗读有 `generation`，**词条数据本身没有**（词条是服务端渲染，不请求） | 我们暂无此问题 |
| 阶段按钮 | 三个 `<div>`（**非 button**，已知/学习中/不学习）+ 清除 | 四个真 `<button>`（含 `正在学习`），语义更好 | **我们更好，保留** |
| 例句播放 | 每条真实例句带 `lr-play-btn` 播**该句原声** | 「原声」按钮播当前词的片段 | **需新增（高价值）**：逐条例句播放 |
| 外部词典 | Re/Gl/Wi/GPT 外链 | 无 | 不照搬（外链跳走，与「不出页面」相悖） |
| 滚动时隐藏 tooltip | `onScroll` 里隐藏所有 tooltip | 浮层由 `content-visibility`/band class 处理，无 tooltip 常驻 | 不适用 |
| 关闭后复查 | 面板可反复打开，内容替换 | 点第二个词替换内容 | 相同 |

## 5. 建议对 Sueño 侧边栏做的改动（按价值排序）

1. **手机改成底部抽屉**（`position: fixed; inset: auto 0 0 0; height: 88%`、顶部圆角、`--safe-area-bottom`），桌面维持右侧列。理由：现在手机上侧边栏被挤到词架下方，用户点词后**看不到面板**（要滚动到底），这是真实可用性缺口。
2. **宽度按视口分档**：`>=1440 → 440px`、`>=1200 → 400px`、否则 350px；桌面仍用 `sticky` 列宽而非 `fixed`（我们的布局是网格，更简单且不遮内容）。
3. **面板顶部加「查另一个词」输入框**：预填当前词，回车按 `word` 走同一个解析端点替换内容。这是 LR 面板里最实用的一条，且我们的接口已经支持任意词。
4. **每条真实例句加播放按钮**：我们的 `resolve-word-audio` 目前按「词的片段」解析；例句逐条播放需要按**例句所在的附件段**解析（同一套逻辑，换输入）。可以在现有接口上加可选 `segmentIndex`，或新增 `POST /api/v1/read/sentence-audio`。
5. **关闭时 `blur()` 面板内焦点**，避免焦点留在隐藏区域。
6. **可选**：返回键关面板（`history.pushState` + `popstate`），与 LR 一致；但**不要**照搬「Escape 不关」——我们的 Escape 关面板+停声更符合预期。

## 6. 复现方式

```powershell
# 观测脚本（gitignored）
node .tmp-lr-drawer-observe.mjs "https://www.languagereactor.com/c/es/yt/t_yt_mix_es/yt_NbwJNoL9EoM" ".tmp-lr-research/drawer/run3"
# 只读切片：面板容器、宽度分档、代次号
node .tmp-lr-dict-extract.mjs .tmp-lr-research/assets/assets__index-B2o7oYbu.js "showFullDictionary("
```

关键源码位置（归档 bundle 字符偏移）：`showFullDictionary` @ 1265930、抽屉容器 `lri-Main-dict` @ 3119414、宽度分档 `uRe` @ 1225031、主内容让位 `dockedDictInsetPx` @ 3132096。

## 7. 未观测 / 限制

1. **`/saved-items` 页面本身未能观测**：该页的「词汇 / 保存的单词 / 保存的短语」需要登录，而本机 **Google 认证端点不可达**（经代理 `127.0.0.1:7897` 仍 `Client network socket disconnected`），Firebase ID token 已过期且无法续期；`dioco` 端点可达（200）。因此本次是在**同一套共享组件**的字幕页上观测（bundle 证据：抽屉、tab、词条组件都在主 bundle 内，`SavedItems` 分块不含这些字符串）。
2. 未点击面板里的学习阶段按钮（会改动账号状态），因此「点阶段后是否关闭面板」**未验证**。
3. 未观测登录态下的 `Lexa 笔记` 与 `Lexa AI 对话` tab 内容。
4. 手机端行为**来自源码**（`anchor="bottom"`、88% 高、`onSwipeDown`），本次未做移动视口实测。
5. 未测 1200/1440 两档之外的真实宽度值（`uRe` 是纯函数，代码即证据）。
