# 媒体系列与播后推荐实施计划

- 日期：2026-10-15
- 文档切片：`MEDIA-SERIES-000`，2026-10-16所有者确认；001–006已按依赖顺序实施并进入review。
- 权威规格：[系列设计](../superpowers/specs/2026-10-15-media-series-and-episode-navigation-design.md)；决策：[ADR-0018](../adr/0018-media-series-directory.md)。
- 实施完成：001–006已实现并进入review；0046迁移及首批真实目录已受控应用。[整体验收与交接](../reviews/MEDIA-SERIES-001-006.md)记录最终文件、199项联合测试、123项契约、40项媒体E2E、77页构建与全量/真机限制；实时状态仍以状态页为准。

## 1. 范围、依赖与领取

用户于2026-10-16要求“实现整个需求”，确认本规格与001–006实施范围。000设计已确认，001从ready由本会话领取为in_progress；002–006依赖满足后逐项领取，不同时扩大当前切片。沿用已登记共享树 `codex/disable-legacy-readlang` 并保留其他会话改动；共享基线尚未整理期间不混合提交，不改其他任务负责人或全局顺序。

| 任务 | 范围 | 依赖 | 初始状态 | 建议分支 |
| --- | --- | --- | --- | --- |
| MEDIA-SERIES-000 | 规格、ADR、切片及权威文档索引 | 用户设计讨论 | review，本会话 | 共享树文档，无新增分支 |
| MEDIA-SERIES-001 | 系列领域、迁移、只读协议与所有者写入用例 | 000 详细规格确认 | blocked，未分配 | codex/media-series-001-foundation |
| MEDIA-SERIES-002 | 库存归属清单、校验及受控导入 | 001 | blocked，未分配 | codex/media-series-002-catalogue |
| MEDIA-SERIES-003 | 卡片系列入口、系列页和选集 | 002 至少一组确认映射 | blocked，未分配 | codex/media-series-003-navigation |
| MEDIA-SERIES-004 | 视频结束后的下方同系列推荐 | 003 | blocked，未分配 | codex/media-series-004-after-playback |
| MEDIA-SERIES-005 | 换一批的系列多样性 | 004；本人决定推进 | blocked，后续可选 | codex/media-series-005-browse |
| MEDIA-SERIES-006 | 白名单采集的待确认系列建议 | 004；本人决定推进 | blocked，后续可选 | codex/media-series-006-acquisition |

001–004 构成首版；005、006互不依赖，不阻塞首版验收，但属于此次整个需求的后续实施范围。上表保留初始依赖记录，实时领取状态只以 PROJECT_STATUS 为准。建议分支尚未创建；共享树中各切片保持独立文件/变更交接，不混合其他任务提交。

## 2. MEDIA-SERIES-001：领域、数据与协议

拟触及：`src/modules/media/domain/{media-series,media}.ts`、`schemas/media-series.ts`、专用 repository/application，`src/shared/db/schema/media.ts`、版本化 Drizzle 迁移、`app/api/v1/media-series/`、媒体 `series-recommendations` route、内部 `content-workflow/media-series` route、`contracts/openapi/v1/openapi.json` 与版本化 JSON Schema。

先写领域/契约测试及 fake，再实现：

- 按规格第 4/5 节建立三表、单一归属、类型校验、唯一顺序、可空集号；catalogue revision 与 media version 分离。
- 所有者批量命令先完整校验，事务/CAS/幂等；成员挪动校验原/目标 revision，拒绝并发抢占，审计与成员同事务。
- 只读简介/可见数量、分页与 anchor、当前集邻接、最多 6 条播后推荐；全部使用窄查询，currentVersion/发布/版权/资产门禁与现有目录一致。
- MediaCard 可空摘要及旧响应兼容，明确 400/401/403/404/409/503 和 no-store；复用现有稳定码，新增领域码同步 Schema。

验收：领域合法/非法排序、同名不同来源、无系列、跨类型拒绝；数据库迁移空库/上版本、普通用户拒写、跨用户进度隔离、事务失败零部分写入、重复导入、并发冲突和追加审计通过。推荐排序和撤下过滤在服务端单独验证，不只测 UI。原媒体无归属时播放/进度/字幕契约保持。

停点：不导入真实映射、不改播放器 UI、不抓公网或调用收费 provider。同步数据库、架构、测试文档。

## 3. MEDIA-SERIES-002：已有归属与导入

拟新增 `scripts/import-media-series.ts`、版本化映射文件 `content/media-series/` 与 `docs/reviews/MEDIA-SERIES-002.md`；复用 001 的所有者 application，不直接写库。

- 先只读盘点稳定媒体 ID、来源标识与可核验节目/顺序，记录每项证据、拟系列、未知集号及冲突。不仅按 sourceName 或标题聚类。
- 导入默认 dry-run，输出新增/修改/冲突及文件哈希；显式 apply 绑定哈希、幂等键、expectedRevision 和服务端所有者身份。生产写入作为可审阅清单后的独立动作，不能把文档授权当成已运行导入。
- 至少准备一个真实视频系列与一个真实播客节目；若库存证据不足，如实报告缺口，fixture 只用于测试，不能代替真实归属验收。
- 规范化顺序不伪造官方集号；仅目录修订，不重发媒体或重写旧审核身份。

验收：导入错误零部分写入、重复文件不重复审计/关联、同键不同输入拒绝、非法媒体/类型/归属/排序冲突明确；导入前后媒体版本、字幕、用户进度与 evidence 无变更。验证真实库仅在明确环境及受控写入授权下执行；未执行不能声称目录上线。

## 4. MEDIA-SERIES-003：卡片、系列页与选集

拟触及 `src/modules/media/ui/media-card.tsx`、`media-learning-workbench.tsx`、新增 `media-series-page.tsx`/`media-episode-picker.tsx`、`app/(product)/learn/series/[seriesKey]/` 与相关 loading/error，复用现有 MediaCard、媒体详情路径与字幕/点词组件。

- 按规格 3.1/3.2 实现独立系列链接、真实可见集数、顺序、当前集定位、上一集/下一集及原有进度。
- 系列为空/撤下、列表错误、游标过期、加载重试、无归属与未知集号都有明确状态；不得阻塞原媒体播放。
- 请求可取消、20 秒截止、旧响应隔离；抽屉焦点限制/恢复、Escape、44px、底栏安全区；卡片避免嵌套链接。
- 切集释放原播放器/词典请求/朗读资源，原进度同步仍有界，不因导航新增证据。

验收：新增领域/组件与桌面/手机 `tests/e2e/media-series.spec.ts`，覆盖列表直达单集、系列返回、超首屏当前集定位、前后集、空/失败/旧回调、320–1440px 与浅深主题。视频/播客原播放、逐句暂停、字幕、点词和进度专项回归。写 Next.js 代码前读取安装版本的相关指南。

## 5. MEDIA-SERIES-004：视频播后同系列推荐

拟新增 `src/modules/media/ui/media-series-recommendations.tsx`，接入工作台已有 `ended` 回调与 001 的推荐查询，新增 `tests/unit/media-series-recommendations.test.tsx` 和 `tests/e2e/media-series-after-playback.spec.ts`。

- 实现规格 3.3：当前有效 ended 后在播放器下方显示最多六条同系列其他视频；后续集优先，点击进入、无自动连播，不占播放器覆盖层或字幕滚动区。
- 使用显式可测试编排状态 `idle/loading/ready/empty/error`，由 ended、重播/seek、换集/版本/实例、重试与卸载驱动；用 generation 隔离旧事件/请求。
- 零结果隐藏；错误局部重试；20 秒截止、重复 ended 合并；完成进度写失败仍可展示，但不补写完成记录。

验收：先测试暂停/逐句暂停/接近末尾不会展示，当前 ended 才请求；同系列同类型、排除当前稳定 ID、1/6/超过6条、顺序未知、末集补前集、下架/到期、空/失败/超时/重试、旧视频 ended/响应、重播隐藏、再次结束刷新。浏览器验证实际播放器事件→下方卡片→点击跳转→原进度恢复，无自动 play/倒计时/焦点或页面滚动抢占，无新增 evidence 写入。桌面/手机均检查位置与可访问性；播客仍为原选集体验。

## 6. 后续独立切片

`MEDIA-SERIES-005`：改 `domain/media-browse.ts`、相关查询/filter/schema 与游标上下文，仅随便看看按稳定来源及来源内系列轮换。测试 seed 确定性、筛选/最近展示排除、完整分页不漏不重、系列不足补齐、归属变化使游标失效、历史恢复、显式系列筛选和普通排序保持。先提供可比较样例，不添加掌握度/观看时长权重。

`MEDIA-SERIES-006`：仅更新已有白名单 adapter/normalizer 与内部建议 DTO，通过 media 用例确认。验证 feed/播放列表并不总是系列、缺字段与冲突保持未确认、重复发现幂等、旧 generation 隔离和原审核发布门禁。默认只用 fake，不新增来源、抓取权限、收费调用或自动确认/发布。不得与 005 混在同一分支。

## 7. 检查、交接与回退

每项先运行受影响用例，再执行 `pnpm lint`、`pnpm typecheck`、`pnpm test --run`。001 的迁移/协议和跨模块发布候选还需 `pnpm test:contracts`、`pnpm db:check`、`pnpm test:e2e`、`pnpm build`；其他新增 API/迁移任务同样适用。OOM、迁移缺基线等必须区分既有失败与本次回归，缺 DATABASE_URL 时不得用 fake 声称 RLS 或真实库通过。

每个任务交接提供 Commit、修改文件、专项/全量结果、未执行原因、用户验证路径、已知限制及下一任务；实现提交推送后按仓库规则追加状态页后置同步提交。合并者维护 main 状态，不改其他负责人的记录。

用户首版验证：学习页打开单集→看到系列入口→查看系列/选集→播放一个视频至实际结束→下方出现同系列其他视频→点击目标集。再验证重播隐藏、无系列不展示和网络失败重试。Playwright fake 不代替真实媒体结束事件和 iPhone Safari/PWA 真机验证。

关闭新 UI 入口可以回到原单集路径；归属纠正追加审计，迁移只向前，不重写内容或删除学习证据。
