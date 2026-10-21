# CHAT-RHYTHM-001：自然分条与连续消息承接

日期：2026-10-17。所有者已授权本聊天完成设计、任务切片和实现，并自行决定剩余细节。分支沿用 `codex/disable-legacy-readlang`；共享工作树原有大量改动保留。Commit：无，未提交、推送或部署。

## 交付范围

- 回复按意思形成1条、2条、3条或更多气泡，数量不固定；空行是模型编写的语义边界，单换行、标点和字数不决定分条。普通闲聊尽量简短，不要求每轮夸赞、解释、列举、追问全套输出。
- 连续提交在120ms窗口合并；生成或分条期间提交的新消息会启动包含全部未回应消息的新代次。保留已显示内容，重新组织尚未发送的内容；只打字不打断回复。
- 相关话题试探连接，独立话题保留有用回应，最新更正与明确停止优先；“喜欢摄影→买书”可以问是否摄影书，不能认定书的主题，也不机械发完旧问题。
- 每条用户消息保留独立ID和翻译辅助来源；最多20条，每条2000字符，超限保留草稿并提示。一个角色逻辑消息可显示多个气泡，整轮只有一次done和完成后的记忆入口。
- 持久代次所有权、前缀保存、取消、重试、完成重放及过期回调隔离均在实现范围内。现有聊天、初识背景和已发布Lucía v3不重置或覆盖。

设计：[技术规格](../superpowers/specs/2026-10-17-conversation-bubbles-and-followups-design.md)。执行：[A/B/C/D切片](../plans/2026-10-17-conversation-bubbles-and-followups-plan.md)。

## 文件

以下是本任务触及的文件范围；其中部分文件原已包含其他任务的修改，不代表整个文件diff都由本任务产生。

| 层次 | 文件 |
|---|---|
| 语义与生成 | `src/modules/conversation/domain/reply-bubbles.ts`；`application/build-reply-context.ts`、`stream-reply.ts`；`src/modules/providers/conversation/{conversation,minimax-conversation,openai-conversation}.ts` |
| 持久化与协议 | `conversation/application/{prepare-reply-generation,list-history}.ts`；`repositories/{conversation-repository,drizzle-conversation-repository,drizzle-reply-generations}.ts`；`schemas/conversation-stream-request.ts`；conversation导出；stream Route Handler；`contracts/schemas/v1/conversation-stream-request.schema.json`、OpenAPI与共享v1 DTO |
| 数据库 | `src/shared/db/schema/conversation-reply-sources.ts`及schema导出；`drizzle/0047_conversation_reply_sources.sql`、`meta/0047_snapshot.json`、`meta/_journal.json` |
| 客户端 | `conversation/domain/conversation-state.ts`；`ui/{chat-thread,pending-reply,conversation-history-cache}`及必要聊天样式 |
| 回归 | `tests/unit/conversation-bubbles.test.ts`、`conversation-batch-schema.test.ts`、`conversation-rhythm-state.test.ts`、`conversation-rhythm.test.tsx`、route持久化及两个provider测试；`tests/database/conversation-generations.test.ts`；相关typing、契约与桌面/手机E2E |
| 文档 | 本报告、真实合成样本JSON、设计、计划、`docs/adr/0020-durable-conversation-reply-sources.md`、`docs/database.md`、`docs/architecture.md`、`docs/testing-strategy.md`、`PROJECT_STATUS.md` |

## 一致性与数据边界

NDJSON仍为v1的meta/delta/done/error，一个generation只完成一个逻辑角色消息。全文通过现有安全门禁后才发送完整气泡，间隔约450ms且可取消。批次在写入前完整校验，短事务内锁定本用户会话并幂等保存/认领；网络模型请求不持有数据库事务。完整未回应批次独立于8000字符历史预算进入内部provider DTO。

前缀只允许当前streaming代次追加，完成时再次校验代次及来源用户消息。`supersedes`只能裁剪本用户未完成消息的已知前缀；客户端不能提供角色正文，completed内容不可改写。未知旧代次使用空取消标记阻止晚到请求认领。中断没有done，不构成完整记忆来源；已完成重放不重新收费或提取记忆。新增有序来源关联表和版本化迁移（[ADR-0020](../adr/0020-durable-conversation-reply-sources.md)），修复较早来源被撤回时依赖回复残留，以及同generation可删减/重排批次的可复现缺口；不新增学习证据、评分入口或私密正文诊断日志。

## 检查记录

- 最终主线联合39文件404/404通过（97.86s），覆盖完整批次、先前AI问询与中文请求、全轮问题预算、1/2/3/4气泡、状态/组件/契约/路由、PGlite来源隐私及最后的客户端撤回同步。PowerShell选择：`$rhythmTests = @(rg --files tests/unit tests/contracts tests/database | rg 'conversation|reply-plan|reply-continuity|expression-assist|character-provider-projection|character-runtime|memory.test')`，执行：`node node_modules/vitest/vitest.mjs run @rhythmTests --maxWorkers=1`。其他专项集合与此有重叠，不累加。
- 后端专项3文件46/46通过，最初复现的6个失败全部转绿；含逐来源记忆、同代次批次删减/重排拒绝、较早来源撤回/删除后的完成与取消回复清理、持久完成检查。加强实际跨用户代次supersedes后，数据库15/15复验通过。`drizzle-kit check`通过。
- 最终客户端6文件100/100通过，包含撤回/删除后权威历史清理、受影响reader取消、隐藏取消标记、无关活流短服务端前缀后的继续delta、草稿/其他pending保留、删除唯一pending不重发旧历史、切角色晚回调隔离、强制历史读取拒绝旧缓存结果及空取消标记不复活。
- 桌面/手机Chromium的`conversation-rhythm.spec.ts`最终12/12通过（`PLAYWRIGHT_PORT=3143 corepack pnpm test:e2e tests/e2e/conversation-rhythm.spec.ts --reporter=line`），覆盖分条、补充、停止、失败/手动恢复、刷新及删除来源后立即清理依赖回复；人工查看两种宽度的合成截图。短手机气泡曾因grid压缩换行，已修正并增加高度断言。
- 全树TypeScript及生产构建通过，77/77静态页面，未关闭类型检查。构建使用`CIRCLE_NODE_TOTAL=2`、`NEXT_DIST_DIR=.next/prod-check`、`NEXT_MEASUREMENT_BUILD=0`限制页面worker。
- 旧typing测试最初在120ms请求窗口前发送模拟done，已改为等待真实请求开始，原typing/done断言保留。初轮39文件381/382、中间provider安全拒绝与测试夹具失败均不计最终通过。
- 本任务37个TS/TSX文件定向ESLint严格零警告通过，限定53文件diff/空白检查通过；全conversation目录另有`conversation-contact-rail.tsx`三处既有`prefer-const`报错。全仓ESLint未通过：除共享树源代码问题，还扫描`.tmp-*`研究产物及`.next-3000`生成目录；排除临时目录后仍产生40281项报告（4261错误、36020警告），不能用该数值代表本任务源代码质量，也未改动无关配置以掩盖结果。
- 全量单worker Vitest已完整执行：418文件中409通过、9失败；2764项中2751通过、12失败、1跳过，exit1。它早于最后修改启动，其中本任务typing时序和recover-pending两项已在当前聚焦回归转绿，其余10项位于本任务未修改的测试路径：article-acquisition-publish缺`user_generated_articles`夹具表（2）、corpus频率fast path断言（1）、account/lucia data route鉴权请求上下文（3）、desktop navigation按钮（2）、learning heatmap日期范围（1）、vocabulary词典文案（1）。未隔离旧提交证明其历史归因，不宣称全仓通过，也未扩大范围修复这些问题。

## 数据库执行记录

通过标准版本化Drizzle迁移流程应用`0047_conversation_reply_sources.sql`。预检确认数据库最近一项是0046，按迁移时间仅0047待执行；执行后登记条数49→50，最近项为0047，按时间无待执行项，未重放旧迁移。历史0035—0039存在hash差异和7项无法与当前本地hash匹配的既有登记，未据此重放或修改历史。

新表、顺序约束、外键、作用域触发器与RLS已存在；仅authenticated授予SELECT，anon/authenticated无写权。真实远端只读事务切换角色验证：本人能读取本人来源、随机其他用户读取0条、anon读取遭42501拒绝。没有用真实用户消息进行写入式隐私演练；写入/级联/撤回由PGlite覆盖。可信历史replyTo回填1项来源，未推断旧批次成员。

迁移前后对`messages`、`characters`、`relationship_memories`全部行做服务端聚合hash，三者完全一致。未输出正文、密钥或连接URL，未重置聊天或发布人物修订。数据库结构迁移完成不等于应用代码已部署。

## 真实模型检查

使用当前已发布Lucía v3的只读快照、真实MiniMax-M3和四组合成输入，无用户消息、记忆或聊天写入。最终四组均done：共同摄影兴趣2气泡，摄影+买书2气泡，已显示前缀后补充1气泡，料理书+驾考通过2气泡。样本见[原始合成结果](CHAT-RHYTHM-001-provider-samples.json)。

摄影+买书输出包含 `¿Es de fotografía o de otra cosa?`；可见前缀场景包含 `Oye, y el libro, ¿es de fotografía o de otra cosa?`，未重复已显示开头；独立话题同时祝贺通过并接回料理书。此前检查曾出现只回答最新一句、泛泛问书的主题、两问题超预算及夹杂中文；据此完善完整批次/承接提示，现有安全门禁会阻止违规全文并最多重生成一次。这些中间结果不能算自然度通过。

最终模型仍可能比理想回复稍长或出现生硬措辞；四组样本证明实际路径能形成预期承接，不能保证任意输入都完美自然。供应商估算成本字段为null，不代表零费用。

## 用户验证

完整刷新 `/chat/lucia`，正常发送一句，再在她生成前或第一条气泡出现后补充一句。检查：用户两句都保留；已显示回复不消失；新增回复结合两句话；摄影和买书只作试探关联；无关话题仍能被接住。随后试停止、失败重试及刷新，检查旧气泡不会晚到或重复。

需要验证撤回时，可用新建的测试对话消息在允许时间内撤回，确认关联回复立即消失、其他回复与输入草稿保留；不必删除已有真实聊天。刷新恢复中断回复后由用户明确重试才继续，不会自动发送。若删除/撤回已成功但历史读取失败，明确提示稍后刷新，不伪装同步完成。

## 限制与下一步

尚未验证iPhone Safari真机或真实登录用户浏览器全链路；远端仅执行上述迁移及只读RLS核验，未做真实用户写入演练。PGlite与Chromium不能替代真机验证。持久前缀代表服务端已提交发送，无法单凭网络enqueue证明像素已经显示；后续请求以可见气泡数校正未完成前缀，completed历史保持不可改写。取消已发生的模型请求可能仍收费，不承诺全局exactly-once。

整个E2E套件未执行：本次使用覆盖变更路径的桌面/手机12项，未把共享树其他任务纳入验收。全仓lint和全量Vitest已执行但未全绿，失败与当前专项通过分别记录。未提交、推送或部署应用代码。

下一步是所有者实聊验收与iPhone Safari键盘/后台恢复检查；不自动扩张语音、角色设定或其他功能。
