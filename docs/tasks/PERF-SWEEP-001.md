# PERF-SWEEP-001 全站响应速度普查（含二级导航）

- 状态：**部分完成**（P0/P1/P2 已修并提交；P3 阻塞于 `src/modules/explore/repositories/*` 正被其他会话编辑）
- 日期：2026-10-11
- 分支：`codex/disable-legacy-readlang`
- 提交：`bd1ba66`（阅读区短语缺陷）、`d294aef`（媒体目录缓存 + 对话侧栏）、`d5e8a5c`（媒体播放并发 + 非 Lucía 门禁）

## 1. 结论

慢的不是渲染，而是**「外壳已到、内容仍在等远端库」**；而且**公开内容常被 per-user 读取拖住**。多数页面的外壳在 50–200 ms 就到，内容要等到 0.5–3 s 之后。

远端库是主要地板，不是代码：单条语句 250–600 ms，池空闲 20 s 后首次握手约 2 s（实测 `select 1` 冷 2035 ms / 热 224 ms），拥塞时单条宽查询 0.5–3 s、整波 1.4–6.2 s。因此**判断该不该动代码，要看语句数与波次，而不是单次墙钟**。

## 2. 现状总表（首屏：外壳到达 / 内容到达，ms）

| 路由 | 外壳 | 内容 | 状态 |
|---|---|---|---|
| `/`、`/help` | 52 / 59 | 同左 | 静态，无需动 |
| `/me`、`/me/profile` | 87 / 88 | 同左 | 0 条服务端读，私有数据客户端取 |
| `/read` | 195 | 196 | 已修（私有读取移出渲染路径） |
| `/read/vocabulary`、`/read/corpus`、`/read/generate` | 51–102 | 同左 | 本地词表/静态，无阻塞 |
| `/learn/repetitions`、`/explore/history` | 73 / 79 | 489 / 503 | 各 1 条语句，已是最优 |
| `/learn/practice` | 204 | 205 | 0 条服务端读 |
| `/chat` | 85 | 580 | 侧栏 2 波（原 3 波），见 §4 |
| `/read/saved-items` | 64 | 1012 | 2 来源并发（4 语句 / 1 波），已是最优 |
| `/explore` | 144 | 1040 | **未修（P3）** |
| `/chat/lucia` | 193 | 1066 | 同侧栏 |
| `/read/article/[id]` | 149 | 2293 | 3 语句 / 2 波，已并发，受延迟约束 |
| `/read/phrases` | 60 | 2500 → **945–1100** | **已修** `bd1ba66` |
| `/learn` | 58 | 3093 → **450–1500** | **已修** `d294aef` |

> 同一路由在不同时段波动很大（`/learn` 450–1500 ms、`/read/saved-items` 1012–2551 ms），取决于远端库拥塞；上表是同一批次内的相对关系。

## 3. 二级导航（真实 Chrome：点击 → 目标内容可见）

| 分区 | 页签 | 改前 | 改后 |
|---|---|---|---|
| 阅读区 | 词汇 / 短语 / 语料 / 已保存 / 文章 | 2002（二次 424）/ 3070 / 110 / 1658 / 119 | 短语：外壳 55–66、内容 945–1100 |
| 已保存 | 文章 / 保存词语·短语 / 全部 | 855 / 1364 / 1862 | 已是最优（1 波） |
| 学习频道 | 视频 / 播客 / 全部 / 再点视频 | 7606 / 5056 / 155 / 75 | 575 / 460 / 155 / 75（缓存命中） |
| 我的 | 关系隐私 / 能力与活动 | 285 / 63 | 纯 hash，0 请求 |

导航方式本身没有浪费：阅读区与「已保存」是 RSC 导航（不整页刷新），学习频道是客户端原地切换 + `fetch /api/v1/media`（有内存 memo），「我的」是纯 hash。**成本全在各自的数据读取上。**

## 4. 已修（含实测）与如实说明

| 项 | 改动 | 实测 |
|---|---|---|
| `/read/phrases` 假错误 | 页面同步渲染（导航+标题为静态外壳、数据进 `<Suspense>`），超时预算按实测 2500→8000 ms | 外壳 55–66、内容 945–1100；不再渲染 `role="alert"` 的「短语库暂时不可用」 |
| 媒体目录 | 新增 `media-catalogue-cache.ts`（10 分钟进程内缓存 + in-flight 去重 + 失败保留旧值），只包公开行读取，per-user 进度每次现读 | `/learn` 3093→450–467、频道切换 5056–7606→460–575 |
| 对话侧栏 | 「最新消息」与「未读数」两条聚合改 `Promise.all`（3 波→2 波） | **A/B 未看出差异**（含改动 467–492 中位 vs 回退后 450–473）；收益上限=较短语句耗时，保留因语义不变且波次更少 |
| 媒体播放 | `getPlayback` 的 progress 与 segments 改 `Promise.all`（3 波→2 波） | **无干净 A/B**：直接测量时 500 行 segments 读取 ECONNRESET，HTTP 口径 668–1883 波动；按结构记账 |
| 非 Lucía 门禁 | `getRelationshipStatus` 两条语句并为一条 `characters ⟕ character_relationships`，保持 fail-closed | **当前无线上路径受益**：只有 Lucía 是 published，Mateo/Inés 仍 draft；保留为形状正确与前置条件 |

## 5. 未完成：P3 `/explore`

- 入口：[`app/(product)/explore/page.tsx:54`](../../(product)/explore/page.tsx) 的单个 `await Promise.all([dashboardPromise, libraryPromise])` 决定整页何时出现。
- 问题：6 条**全部为用户私有**的语句（1 波）挡住了 3 个**完全来自内存 JSON、0 条语句**的公开视图；`explore-library-panel.tsx` 的卡片是原生 `<a href>`，下钻走整文档加载（无 prefetch）。
- 建议顺序：①先加 `server-timing` 量出这 1 波的真实 RTT（对话路由已有先例），排除「6 条并发连接建立」而非查询本身；②把公开视图放进首个 flush、把 6 条私有读移到自己的 `<Suspense>` 或客户端（照 `read/page.tsx` + `read-shelf-data.tsx` 的法子）；③顺手去掉同一波里重复读 `user_saved_expressions` 的一次（6→5 条）；④卡片换 `next/link`。
- 风险：`pack.saved`/`pack.route` 参与筛选，「我的收藏」会短暂误筛；`privateState` 需区分 loading 与 unavailable，否则文案会说谎；相关单测与 Playwright explore 路径要同步更新。
- **阻塞**：`catalog-explore-library-repository.ts`、`catalog-scenario-suggestion-repository.ts`、`drizzle-scenario-suggestion-context-repository.ts` 仍被其他会话编辑中，动它们会把别人的在途改动一起提交。

其他未做：~~建议 POST 的两波（`suggest-scenario.ts:33-36`，candidates→context 可合并）~~ **已完成**；`/explore` 之外未再发现串行链。

> 2026-10-11 更新（Commit `c2871de`）：P3 中**不触碰脏文件**的两项已完成——④ 场景卡片已由原生 `<a>` 改为 `next/link`（预取 + 客户端跳转），以及上面那条「建议 POST 两波」合并为一波（两者都只以 `userId` 为键，上下文保留自身兜底）。因此 §5 剩余的唯一实质项是 ②③：公开视图先进首个 flush、6 条私有读移进自己的 Suspense 或客户端；①（`server-timing`）对页面行不通（App Router 的页面不能设置响应头，那只在 Route Handler 里成立），需要改用应用层计时脚本。

## 6. 复现方法

```powershell
# 首屏时间线（外壳/内容/分块）
$env:PROBE_BASE='http://127.0.0.1:3120'; $env:PROBE_ROUTES='/learn,/read/phrases'; $env:PROBE_RUNS='3'; node .tmp-routes-timing.mjs
# 二级导航点击
node .tmp-subnav-timing.mjs
# 骨架 vs 页面几何（真实 Chrome 量 box）
node .tmp-read-geom-check.mjs
# 仓库级计时（绕开 HTTP 噪声）
$env:PROBE_RUNS='4'; node --conditions=react-server --import tsx/esm .tmp-phrases-legs.ts
```

## 7. 读这份数据时的注意事项

- 探针**必须带** `spanish-e2e-user` cookie 与 `accept-encoding: identity`；E2E 环境（`DATABASE_URL=""`）测不到这些路径，Playwright 套件因此只能做结构回归。
- dev 模式的 turbopack 按需编译会污染首次点击（可达 2 s），每个路由先热身一次再记数。
- 单条语句 250–600 ms、握手 ~2 s、拥塞时数秒；**报告里区分「实测数字」与「结构推断（语句数/波次）」**，不要把结构性改动包装成测得的提速。
- `.tmp-*.mjs` / `.tmp-*-legs.ts` 是本次的测量脚本（未跟踪，沿用仓库既有约定）。
