# READ-LOAD-001：公共文章目录读取故障恢复

- 日期：2026-10-16；状态：review；负责人：本聊天。
- 授权：所有者报告阅读页 SQL 运行时错误，后确认页面已经正常。
- 分支：沿用共享 `codex/disable-legacy-readlang`；Commit：无，未提交、推送或部署；其他任务改动保留。

本机首次真实只读 repository 查询复现 Drizzle 包装错误，其 cause 为 `ENOTFOUND` / `getaddrinfo`，查询尚未到 PostgreSQL。两项数据库 URL 配置均为直连，同一项目且相同连接；未改凭据、DNS、代理或数据库。所有者随后确认页面恢复；再次绕开运行时列表缓存调用真实 repository 成功：202 篇公开文章、返回12篇、801ms。这证明复验时连接与列表查询可用，不保证后续网络稳定。

实现：读取失败显示“文章暂时无法读取”和重试，保持阅读导航；重试刷新当前 URL，保留筛选/搜索/页码，并在请求期间禁用按钮。覆盖连接创建、首查和超范围页码收敛后的第二次查询故障。成功零条继续使用正常空态，不回退本地 bundle，不向客户端传递底层错误，不添加日志或写入操作。

修改文件：

- `app/(product)/read/read-shelf-data.tsx`
- `app/(product)/read/read-shelf-unavailable.tsx`（新增）
- `tests/unit/read-page.test.tsx`
- `tests/unit/read-shelf-unavailable.test.tsx`（新增）
- `tests/e2e/read-library-unavailable.config.ts`（新增，隔离故障数据库）
- `tests/e2e/read-library-unavailable.spec.ts`（新增）
- `PROJECT_STATUS.md`、自动内容供应实施计划、`docs/architecture.md`、`docs/testing-strategy.md`、本交接。

验证：

- 新增查询/初始化故障回归在修复前2项失败，确认复现。
- 最终聚焦 Vitest：6文件34项通过，含书架、导航、骨架及 runtime repository。
- 桌面/手机 Chrome 专项最终2/2通过：真实 loopback 数据库失败、错误态、导航、按钮尺寸、发起 RSC、慢请求禁用/aria-busy、恢复可点击、URL保持、无溢出、零 pageerror。首次简版2/2通过；补充在途断言后一次worker异常退出 `3221226505`、另一次导航超时，未计通过；随后复验发现Next route announcer与错误面板都有alert角色，收窄到有名称的错误区域后最终通过，未放宽行为断言。
- 类型检查和改动TS/TSX的定向ESLint通过，限定diff空白检查通过。
- 首次专用E2E配置因工作目录解析启动失败；显式指定仓库cwd后修正。

未执行全仓lint、全量Vitest、整个E2E或生产build：本轮局部读取错误与UI恢复修复，无跨模块接口、迁移或发布候选；共享树有大量其他在途任务和已记录的全量OOM/失败，聚焦结果不等于全仓通过。无数据库结构/RLS/写入变更，未跑远端迁移/RLS验证；未做iPhone Safari/PWA真机或真实provider调用。

用户验证：刷新 `/read` 应显示原文章库；搜索、筛选、翻页应正常。若再次发生连接故障，应保留阅读导航并显示错误与重试；网络恢复后点击重试，当前URL条件继续生效。

限制及下一步：没有改变DNS、连接策略或缓存语义，无法保证消除网络故障；此轮真实列表恢复且用户已确认，不新增后续功能任务。如同类错误再次出现，单独核验当时的DNS/代理及官方应用连接配置，不猜测替换连接端点。
