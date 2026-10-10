# CONV-ROLE-001 复核包（阶段 0–1 角色运行时边界）

状态：等待产品本人复核（实现在当前分支历史中）
分支：当前分支 `codex/disable-legacy-readlang`
复核包整理时间：2026-10-10

## 1. 关键事实（先看这条）

阶段 0–1 的三个实现/修复提交都已是当前分支 HEAD 的祖先：

```
d5e3502  feat: enforce published character conversation runtime   ancestor-of-HEAD = True
9acb380  fix: close conversation privacy and identity leaks        ancestor-of-HEAD = True
d02253c  fix: remove memories before conversation deletion         ancestor-of-HEAD = True
```

因此本项**不需要再写实现代码**，剩下的是产品本人确认边界与后续阶段排期（第 4、6 节）。

## 2. 交付内容

| Commit | 说明 |
|---|---|
| `d5e3502` | 阶段 0–1 角色运行时边界：Lucía 要求数据库 `published` 版本，Mateo/Inés 保持 draft/coming-soon |
| `9010d60` | 交付记录（状态页与实施计划） |
| `9acb380` | 关闭会话隐私与身份泄露（撤回的助手消息不再出现在联系人预览/未读/搜索投影；用户消息与助手子消息事务删除；request-bound 认证；账号缓存 generation 隔离；虚构故事边界） |
| `d02253c` | 删除路径先清理 `source_message_id` 关系记忆再删消息，并允许 draft/retired 角色的历史隐私 mutation，清理失败时源消息保留并返回可重试错误 |

改动分布（相对 `d5e3502^`）：`app/api/v1` 20 个文件、`src/modules/conversation` 14 个、`contracts/schemas/v1` 11 个、`src/modules/character-network` 5 个、`src/shared/auth` 2 个、`app/(product)/chat` 2 个、`src/modules/characters` 2 个，以及对应单测。

## 3. 记录中的验证结果

- 交付时记录：依赖完整时聚焦回归 `21 files / 96 tests`、契约 `23 files / 85 tests` 通过；本提交新增 3 个回归测试。
- 复核环境记录：Node-only 聚焦测试 `2 files / 17 tests` 通过；浏览器测试当时因缺少 `@asamuzakjp/css-color`/`picocolors` 未能启动，扩大聚焦运行在 worker OOM 后为 `14 files / 50 tests` 通过。
- 当时 `tsc` 被并行会话的 `src/modules/media/ui/media-library.tsx` 与 Playwright 类型依赖错误阻断；当前工作树 `tsc --noEmit` 已为 exit 0（本次整理时实测）。

**未执行（本次整理）**：全量 Vitest、Playwright、真实 provider、远端数据库、iPhone Safari/PWA、Lucía canonical/replay 发布门禁。

## 4. 复核时应确认的安全边界

- [ ] Lucía 的会话入口只接受数据库 `published` 的运行时；draft/coming-soon 角色（Mateo/Inés）不会因静态清单而被当作可用。
- [ ] 撤回的助手消息不会出现在联系人预览、未读计数或搜索投影里。
- [ ] 无效 bearer token 不再回退到 cookie 会话。
- [ ] 删除会话前先清理指向该会话的关系记忆；清理失败时不删除源消息，并返回可重试错误。
- [ ] 客户端历史/联系人缓存按账号隔离，登出、切号与迟到响应都会失效。
- [ ] 缺少 `reveal policy` 的持久化事实默认不注入 provider（fail-closed）。
- [ ] 已撤销的共享权限在角色退回 draft 后仍然保持撤销。

## 5. 复核结论（待填）

- 结论：`approve` / `revise` / `reject`
- 复核人：
- 日期：
- 备注：

## 6. 尚未完成的范围（下一步排期用，不是本项缺陷）

阶段 2–4 仍待领取：逐路由 Schema 补齐、真实 provider 与远端数据库验证、iPhone Safari/PWA 真机、Lucía canonical/replay 发布门禁、跨模块原子事务、撤回路径失败重试、stream completion CAS。这些按 `docs/plans/2026-09-26-character-runtime-and-conversation-closure-implementation-plan.md` 的顺序推进，不阻塞阶段 0–1 的合并。
