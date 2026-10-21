# MEDIA-SERIES-003：系列入口、系列页与选集

- 日期：2026-10-16。
- 本轮任务仅为 MEDIA-SERIES-003，依赖已完成的系列协议与首批受控目录归属；完整需求仍包含后续 004、005、006。
- 实现状态：导航代码及聚焦验证已落地；浏览器28个独立用例已分次通过，最终全树类型检查与隔离生产构建通过。Commit：无，未提交、推送或部署。

## 1. 用户可见行为

学习资料库仍直接展示单集卡片。封面和标题继续进入原单集详情，系列名称与“查看系列”是独立的相邻链接，不嵌套在单集链接内。只在真实归属存在时显示系列与已知季集信息，不为未知集号编序。

`/learn/series/[seriesKey]` 显示简介、真实可见的“本站已收录 N 集”和单集卡片，按服务端当前顺序分页。不存在或不可见、空目录、加载、失败、超时和失效游标都有明确恢复状态。数量表示本站当前可播放条目，不声称节目总集数。

播放器下方新增“选集”入口，视频和播客共用同一导航。桌面展开局部面板，手机打开独立抽屉。首次请求带当前稳定媒体 ID，服务器返回包含当前集的页和前后邻接项，因此当前集在第 20 条之后也能定位；可上一集、下一集、定位当前集、从头浏览或查看全部。已有播放位置只作为条目进度显示，不表示能力掌握。

手机抽屉限制 Tab 焦点、支持 Escape、关闭后恢复触发按钮焦点，并留出底部导航与安全区。portal 挂载到当前 `.product-shell`，继承产品壳的浅/深主题变量；关闭时使用 `focus({ preventScroll: true })` 恢复焦点，避免页面随焦点跳动。当前集定位只滚动选集容器，不滚动播放器所在文档或抢播放器焦点。选集失败保持原播放器可用；点击单集才沿原媒体详情路径切换，本轮没有自动连播或播后推荐。

## 2. 实际数据与资源边界

现有媒体 repository 在列表、换批、详情查找和播放投影中增加批量系列摘要读取：只关联 active 目录，按媒体 item ID 查询；目录元数据位于原目录缓存之外，因此系列 revision 或归档变化不要求重发媒体版本或等待旧目录缓存过期。原发布、currentVersion、版权、资产与用户进度门禁继续先行。无系列时返回 null；归档隐藏系列入口，不撤下原单集。

`use-media-library.ts` 的 Zod 卡片解析显式保留可选/可空 `series` 摘要，兼容没有新字段的旧响应。系列读取客户端校验响应结构、系列 ID/类型、条目去重、anchor 和 cursor/hasMore 一致性；固定每页 20 条，所有读取携带会话并禁用缓存。

`useMediaSeriesEpisodes` 为请求维护 generation、AbortController 和 20 秒截止。重试、切页、换系列和卸载取消旧读取；旧响应不能覆盖当前状态。cursor-invalid 清空失效游标并重新读取；晚页 anchor 与“从头浏览”分开，避免把当前集所在页误称全系列第一页。媒体/版本/目录 revision 切换重建选集会话；实际媒体导航仍由原工作台生命周期释放播放器、点词请求和朗读资源。

系列页面与选集通过已有窄 API 读取卡片和邻接项，不读取字幕或播放资产，不新增证据写入、供应商调用或数据库结构。服务端鉴权与 `private, no-store` 沿用 001。

协调者通过真实主媒体 repository 的 `findByStableKey` 读回已发布 Peppa 内容，确认返回 `series.peppa-pig-es-latino` 摘要。真实目录仍为9系列、63归属、9追加审计，本轮导航集成未增加目录写入。这是服务端真实投影核验，不等同真实账号浏览器验收。

## 3. 修改文件

| 范围 | 文件 |
| --- | --- |
| 系列页面路由 | `app/(product)/learn/series/[seriesKey]/{page,loading,error}.tsx` |
| 客户端读取与状态 | `src/modules/media/ui/{media-series-client,use-media-series-episodes}.ts` |
| 页面与选集 | `src/modules/media/ui/{media-series-page,media-episode-picker}.tsx`、`media-series.css` |
| 卡片与播放器接入 | `src/modules/media/ui/{media-card,media-learning-workbench}.tsx`、`media-card-series.css` |
| 摘要投影与解析 | `src/modules/media/repositories/drizzle-media-repository.ts`、`src/modules/media/ui/use-media-library.ts`、`src/modules/media/schemas/media-series.ts` |
| 受控浏览器 fixture | `src/modules/media/testing/{media-series-e2e-fixture,video-learning-e2e-fixture,podcast-learning-e2e-fixture}.ts`、`src/modules/media/http/series-http.ts` |
| 自动回归 | `tests/unit/{media-card-series,media-series-navigation,media-series-e2e-fixture}.test.*`、`tests/database/media-card-series.test.ts`、`tests/e2e/media-series.spec.ts`、`tests/e2e/fixtures/media-series.ts` 及相关既有用例 |

文档同步为本文、`docs/architecture.md` 与 `docs/testing-strategy.md`；已有共享树其他任务改动保持。

## 4. 验证证据

| 验证 | 实际结果与覆盖 |
| --- | --- |
| UI、卡片及学习列表 | `media-series-navigation`、`media-card-series`、`media-library-browse`：**三个文件累计30项分次通过**。最新导航12项通过，卡片2项与列表16项在前轮通过。覆盖独立链接、分页/晚页 anchor、邻接、未知集号、空/失败/游标失效、超时/旧响应、抽屉焦点、产品壳主题继承和当前集局部滚动。 |
| fixture 与原路由 | `media-series-e2e-fixture`、`media-series-routes`：**2 files / 22 tests 通过**。真实 HTTP handler 在 E2E gate 下无数据库/字幕读取；25 视频、3 播客、空/归档场景；所有可选目标均可由原播放 fixture 打开。 |
| 数据库与媒体持久化 | `media-card-series`、`media-browse-persistence`、`media-playback-segments`、`media-persistence`、`video-acquisition-publish`、`podcast-acquisition-publish`、`media-stream-source`：**7 files / 21 tests 通过**。使用实际 repository 与 PGlite 验证系列摘要、归档/更新和原媒体发布/播放/流读取回归；不是线上 Supabase 角色或真机验证。 |
| ESLint 与类型 | 最终受影响11个路径 ESLint 通过。测试辅助函数类型修正后，全树 `tsc --noEmit` 复跑通过，退出码0。 |
| 浏览器 | 产品壳主题继承修复后，`media-series.spec.ts` 新路径最终 **10/10 通过**，日志 `.tmp-media-series-003-e2e-navigation-final.log`；原视频/播客 **18/18 通过**，见 `.tmp-media-series-003-e2e-final.log`。共28个独立用例分次通过，未声称同一轮28项全绿。 |
| 构建 | 隔离生产构建最终通过，退出码0，日志 `.tmp-media-series-003-build-final.log`；包括编译、TypeScript检查及页面/路由生成，不代表部署。 |

浏览器用例覆盖桌面/手机下的单集入口、系列分页、晚页当前集、前后集、播客读取失败重试、空/不可见系列，并在 **320/375/768/1440px** 检查横向溢出，切换浅/深主题。截图仅留存 375/1440px 及选集视图，是本地测试产物，不代表每个设备的人工真机验收：

- [桌面 1440px 深色](../../test-results/media-series/desktop-chromium-1440-dark.png)。
- [桌面 375px 浅色](../../test-results/media-series/desktop-chromium-375-light.png)。
- [手机 375px 深色](../../test-results/media-series/mobile-chromium-375-dark.png)。
- [桌面选集面板](../../test-results/media-series/desktop-chromium-picker.png)。

fixture 只在 `NODE_ENV !== production && AUTH_E2E_ENABLED=1` 同时成立时生效，读取按请求构建独立卡片，不调用字幕/播放 repository；关闭 gate 后已创建的 fake repository 也拒绝读取。fake save 恒定抛出 `MEDIA_SERIES_UNAVAILABLE`，不会让所有者写入得到虚假成功。生产路径继续使用真实数据库。

## 5. 用户验证与剩余范围

使用真实账号打开学习页，选择已有系列归属的 Peppa 等内容，确认卡片直接播放与“查看系列”链接各自可用；打开系列页核对本站收录数量，再在视频或播客详情打开选集，检查当前集、上一集、下一集和原播放位置。手机可验证 Escape/关闭后焦点恢复、抽屉不覆盖底栏；无归属单集仍按原路径播放。

本轮尚未完成 iPhone Safari/PWA 真机、真实视频解码/听感、真实账号浏览器全路径及全仓 lint/Vitest/E2E 的完整门禁。隔离生产 build 已通过；fake SDK/媒体与 PGlite不能代替真机与真实账号验证，已有全量内存/基线失败不能记作通过。没有提交、推送或部署。

下一任务为 **MEDIA-SERIES-004：当前视频真实 ended 后在下方显示同系列其他视频**；005 浏览系列多样性和 006 白名单采集归属建议仍待独立任务推进。001–003 的实现不构成整个需求已完成。
