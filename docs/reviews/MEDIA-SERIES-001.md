# MEDIA-SERIES-001：系列目录基础交接

- 日期：2026-10-16
- 范围：001领域、存储、鉴权读写协议；整体目标仍包括002库存归属、003导航和004播后推荐UI。
- Commit：无；未提交、推送、部署或在真实项目执行迁移。保留共享树其他任务的已有改动。
- 权威设计：[系列规格](../superpowers/specs/2026-10-15-media-series-and-episode-navigation-design.md)、[ADR-0018](../adr/0018-media-series-directory.md)、[实施计划](../plans/2026-10-15-media-series-implementation-plan.md)。

## 实现范围

`media` 拥有系列目录、稳定媒体成员关系与追加审计。每集最多归属一个同类型系列，ordered使用有间隔的唯一正position；季/集号未知保持null，来源真实标注0时保留0。目录revision独立于不可变媒体版本，不修改字幕、审核、进度和学习证据。

所有者写入经严格有界Zod与领域规则完整校验，HTTP/application/repository重新校验allowlist；1MiB请求体上限同时覆盖Content-Length与实际流式字节，并在超限时取消。单事务目录锁串行化创建、改序与移动，检查目标及显式原系列revision，追加双方审计；相同幂等键同输入回放原结果，冲突全部回滚。三表启用RLS并撤销客户端直接权限，审计触发器拒绝更新、删除及清空。

鉴权读接口提供简介/真实可见计数、有界分页/anchor/邻接，以及最多6条同系列其他视频。查询按当前版本、发布、清权和有效资产过滤，计数/顺序/邻接在同一SQL快照，用户进度只取本次UUID；不读取字幕。ordered后续集优先再补之前集，episodic按发布日期降序且缺日期排后。cursor绑定目录revision、页大小及可见当前版本集合，变化后明确拒绝旧游标。归档隐藏系列投影，仍可用的原单集保留播放路径。

接口均使用`private, no-store`；无效显式Authorization不回退cookie，所有者身份来自服务端鉴权参数，客户不能在payload覆盖userId。无归属且可见的媒体返回成功空推荐，不可见媒体404，读取故障503。既有媒体卡响应兼容可省略或可空series摘要。

## 修改文件分组

仅列001所涉及路径或共享文件内相关改动，不包含共享树其他任务的修改。

| 分组 | 文件 |
| --- | --- |
| 领域与应用 | `src/modules/media/domain/media-series.ts`、`domain/media.ts`、`application/media-series.ts`、相关domain/application入口导出 |
| 校验与repository | `src/modules/media/schemas/media-series.ts`、`repositories/media-series-repository.ts`、`repositories/drizzle-media-series-repository.ts`、既有媒体repository的系列摘要投影及相关入口导出 |
| 数据定义与迁移 | `src/shared/db/schema/media-series.ts`、`schema/index.ts`、`drizzle/0046_media_series_directory.sql`、`drizzle/meta/0046_snapshot.json`、`drizzle/meta/_journal.json` |
| HTTP | `src/modules/media/http/series-http.ts`；`app/api/v1/media-series/[seriesKey]/route.ts`、`episodes/route.ts`；`app/api/v1/media/[stableKey]/series-recommendations/route.ts`；`app/api/v1/internal/content-workflow/media-series/[seriesKey]/route.ts` |
| 合同 | `contracts/schemas/v1/media-series-*.schema.json`、既有`media-item.schema.json`与API错误schema、`contracts/openapi/v1/openapi.json`、`src/shared/contracts/v1/api-contract.ts` |
| 测试 | `tests/unit/media-series-{domain,application,routes}.test.ts`、`tests/contracts/media-series-contract.test.ts`、`tests/database/media-series-{migration,persistence}.test.ts` |
| 文档 | `docs/database.md`、`docs/architecture.md`、`docs/testing-strategy.md`、本交接；状态页及实施计划由协调者同步 |

## 已执行验证

聚焦测试使用已安装Node入口；数据库元数据、最新typecheck与专项lint结果由协调者提供。本节记录本轮共享树时点，不代表之后并行修改仍通过。

| 检查 | 结果 |
| --- | --- |
| 系列领域/application/Route/合同及原媒体兼容 | **6 files / 51 tests通过**，精确命令见下 |
| 隔离PGlite迁移与实际repository SQL | **2 files / 16 tests通过**：迁移7项，持久化9项 |
| 合计聚焦 | **8 files / 67 tests通过** |
| `db:check` | 通过 |
| 13个新增TS文件专项ESLint | 通过，0警告 |
| 最新全树typecheck | `corepack pnpm typecheck`通过，exit0；先前并行TTS fixture六处implicit-any已由该任务修复并重跑 |
| 全仓lint | OOM终止，未通过 |
| 全量Vitest | 发现既有基线错误后中断，未完成，不能记为通过 |

精确聚焦命令：

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/media-series-domain.test.ts tests/unit/media-series-application.test.ts tests/unit/media-series-routes.test.ts tests/contracts/media-series-contract.test.ts tests/contracts/media-contract.test.ts tests/unit/media-domain.test.ts
node node_modules/vitest/vitest.mjs run tests/database/media-series-migration.test.ts tests/database/media-series-persistence.test.ts
```

PGlite执行真实迁移SQL、触发器、角色/RLS及Drizzle repository SQL，不用fake模拟事务。测试只建立媒体依赖的前置迁移链，并未覆盖仓库全部空库或上版本迁移。存储用例包含事务失败零部分写入、幂等重放、双方revision移动、两个账号进度、当前版本/版权/资产到期/撤下/归档、游标失效；角色用例另验证客户端无权限，以及误授表权限后无RLS策略仍拒写。它们不证明真实Supabase部署、独立连接并发锁竞争或完整仓库迁移链通过。

## 未执行、限制与下一步

- 未执行真实数据库迁移、生产导入、完整空库/上版本迁移链或目标项目角色验收；真实目录尚未上线。
- 未执行本轮`build`、Playwright/E2E、实际媒体结束事件或iPhone Safari/PWA真机验证。001没有新的系列UI，不能用接口测试声称用户端播后推荐已完成。
- 全量lint及Vitest仍未全部通过；OOM与既有基线错误单列，不把它们算作本次系列回归或通过。发布候选必须补齐这些检查。
- 所有者目录写入采用表级锁，适用于当前低频个人Alpha；真实双连接并发仍需独立验证。审计保留操作者UUID而不以profile外键级联删除。
- 下一项是`MEDIA-SERIES-002`：只读盘点真实库存，准备至少一个视频系列和一个播客节目的可核验映射，再通过默认dry-run、哈希绑定的受控导入进入目录；不得只按来源名猜测归属。随后实施003导航与004播后推荐UI。

## 用户验证路径

当前可先运行上面的67项聚焦检查审阅基础行为。真实项目完成迁移、配置所有者allowlist并按002受控导入后，用已登录会话请求`GET /api/v1/media-series/:seriesKey`及`/episodes?pageSize=20`，核对本次可见数量、顺序和账号自己的播放进度；请求`GET /api/v1/media/:stableKey/series-recommendations`应最多返回6条同系列其他视频。非所有者PUT应403，撤下/到期内容应从计数、邻接和推荐同时消失，旧cursor应报错而非静默跳页。

最终用户路径“学习卡片→系列/选集→视频真实结束→播放器下方同系列推荐→手动切集”仍需003/004完成后验证；此处不声明整体需求已完成。
