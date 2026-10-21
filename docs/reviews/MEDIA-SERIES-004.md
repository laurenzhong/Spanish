# MEDIA-SERIES-004：视频播后同系列推荐验证

- 日期：2026-10-16。
- 当前状态：后端、工作台/组件单元、技术失败门禁及桌面/手机 Chromium 专项验证已完成；最终门禁与任务状态由主任务登记。
- 权威规格：[系列设计第 3.3 节](../superpowers/specs/2026-10-15-media-series-and-episode-navigation-design.md)、[实施计划第 5 节](../plans/2026-10-15-media-series-implementation-plan.md)。
- 验证身份：AI 编码代理；本报告是工程验证，不是内容语言或教学审核签字。

## 1. 后端补充证据

新增 `tests/database/media-series-recommendations.test.ts`，使用真实 PGlite PostgreSQL 执行现有 Drizzle SQL。应用媒体基础迁移、当前资产约束、CEFR 及 `0046_media_series_directory`；不是内存 fake，不连接外部数据库。

| 检查 | 结果 |
| --- | --- |
| 2、7、9 个可见视频产生 1、6、6 条推荐 | 通过，排除当前稳定媒体 ID，限制六条 |
| ordered 顺序明确而官方季/集标签未知 | 通过，按 position 排序，标签保持 null |
| 最后一集没有后续集 | 通过，按系列顺序以前面的可见集补足 |
| episodic 发布日期、同一时刻和空日期 | 通过，日期降序、稳定键打破平局、空日期排后 |
| 单集系列及已有多集归属的播客节目 | 通过，返回零推荐；播客不进入视频播后推荐 |
| 候选的当前版本替换 | 通过，仅返回 currentVersion 的标题、内容哈希和版本，不退回历史版本 |
| 草稿、受限版权、撤下、到期、无当前版本、无资产和 unavailable 资产 | 通过，同时从推荐及可见数量排除；其他系列不混入 |
| 用户进度隔离 | 通过，用户 A/B 的播放位置分别返回，无跨用户缓存；已看状态不改变排序或排除成员 |
| 查询范围及写入副作用 | 通过，一条窄查询、不读取字幕；推荐前后进度及 evidence_events 保持完全一致 |

执行：`corepack pnpm exec vitest run tests/database/media-series-recommendations.test.ts`，1 文件、8 用例通过。

补充联跑 `media-series-recommendations`、`media-series-persistence`、`media-series-domain`、`media-series-sql-parameters`：4 文件、30 用例通过，包含真实 SQL bind 与既有后端回归。

已有 `tests/database/media-series-persistence.test.ts` 继续覆盖当前媒体本身失效的 404、系列归档为空、所有者写入 CAS/幂等/审计及分页权限；本补充测试重点验证先前缺少的 SQL 边界组合。

## 2. 播放器与组件证据

`video-learning-workbench.test.tsx` 与 `media-series-recommendations.test.tsx` 最终联跑 **2 文件、35 用例通过**（`.tmp-media-series-004-unit-final3.log`）。只读复核涉及工作台、YouTube/本站视频 adapter、推荐组件、请求协议与纯 reducer。

| 检查 | 结果 |
| --- | --- |
| 本次结束与历史进度分离 | 通过；历史 completed、普通暂停、逐句暂停和接近片尾的位置均不启动请求，YouTube/本站视频 seam 均覆盖有效 ended |
| 推荐卡片及协议 | 通过；1/6 张视频、查看全部和手动切集；超过六张、自己、重复、跨系列、播客或缺失归属的卡片拒绝并局部重试 |
| 目录变更 | 通过；以本次鉴权查询返回的当前系列为准，不因旧播放摘要仍指向旧系列而错误拒绝合法移动 |
| 重复结束与开发生命周期 | 通过；同次 ended 复用结果，重复渲染不重新请求；StrictMode 同步卸载先取消，再在 microtask 检查后创建唯一请求 |
| 重播、seek、换集/版本/资产/实例 | 通过；回内容区清除完成状态，旧请求 abort，下一次结束重新读取；旧 generation 的响应和播放器回调不能重显旧推荐 |
| 截止与错误 | 通过；20 秒截止且 fetch 忽略取消也能退出，失败和超时均支持局部重试；成功空结果、无系列和播客隐藏推荐区 |
| 技术失败与迟到 ended | 通过；同步 failure ref 拒绝当前实例 error 后的 ended，并清除已显示结果；ready/playing 恢复、port 替换或显式重试后才接受新的结束，YouTube/本站视频两组回归覆盖 |
| 学习证据与进度 | 通过；推荐仅 GET，进度保存 503 不阻碍显示；不生成额外完成写入或能力证据 |
| 焦点与滚动 | 通过；组件不自动 focus、scroll 或 play；内部键盘操作不冒泡成工作台快捷键 |

adapter/fixture 回归 **3 文件、18 用例通过**，覆盖 `video-player-generation`、`media-plyr-default` 与 `media-series-e2e-fixture`。当前实例 replacement/unmount 立即使 generation 失效，同时移除 ended/timeupdate/seeking/seeked 监听；即使 SDK 已排队的旧回调仍被门禁拒绝。

只读审核发现的 error→当前实例迟到 ended 漏洞已由主任务修复，并补足上述两组回归；本轮复核确认修复使用同步 ref，避免依赖 React 异步 state 门禁。

## 3. 浏览器专项证据

`media-series-after-playback.spec.ts` 三条路径在 desktop-chromium、mobile-chromium 各执行一次，**6/6 通过**（`.tmp-media-series-004-e2e-final.log`）：

- 通过本站视频 DOM 的 ended 事件显示六条同系列其他视频，位于播放器下方、字幕区外；暂停及近尾 timeupdate 不显示，重复 ended 只有一次读取。
- 进度保存失败时仍显示；前后焦点、页面 scrollY 和 play 调用数不变，手动点击才换集，并恢复目标已有播放位置；零 evidence/skill-state 写请求。
- seek 回内容区立即隐藏，下一次 ended 重新读取；读取失败局部重试，成功空结果隐藏；播客保留选集且不请求视频推荐。

主任务已人工读取桌面/手机截图，推荐布局在主列且无横向溢出。E2E 的媒体与结束事件是明确安装的 fixture/fake；它验证浏览器事件接线与页面行为，不代表真实视频解码自然结束、YouTube 外部 SDK 或 iPhone Safari/PWA 真机通过。

## 4. 限制与完成条件

最后的 failure-ref 补充后，004/005 受影响文件专项 lint 与全树 `typecheck` 均由主任务确认 exit 0（`.tmp-media-series-004-005-lint-final.log`、`.tmp-media-series-004-005-typecheck-final.log`）。全仓 lint/Vitest/E2E、生产 build、真实外部媒体与 iPhone Safari/PWA 不由本轮聚焦证据替代。PGlite 是本地真实 PostgreSQL 执行证据，不代表远程 Supabase/RLS/真实双连接并发验证。未调用收费供应商，未改写任何生产内容或用户数据。

## 5. 文件范围与人工复验

产品范围：`src/modules/media/ui/media-learning-workbench.tsx`、`video-player-adapter.tsx`、新增 `media-series-recommendations.tsx` / `.css`、`media-series-recommendation-state.ts`、`request-media-series-recommendations.ts`；验证范围为本报告列出的工作台/推荐/adapter 单元、PGlite 推荐专项及 `tests/e2e/media-series-after-playback.spec.ts`。架构与质量策略同步到 `docs/architecture.md`、`docs/testing-strategy.md`。

人工复验：打开归属于多集视频系列的当前可播放集，播放结束后检查下方最多六张其他视频；查看全部进入当前系列，点击单卡才切集。重播或把时间拉回内容区后推荐消失；暂停或打开历史已完成集不应直接出现推荐。网络故障时仅推荐区显示重试；播客仍只有选集。真实 iPhone Safari 和真实外部播放器自然结束应另行复验。建议下一切片为计划中的 MEDIA-SERIES-005 浏览分散，不把其目录排序改动混入004。
