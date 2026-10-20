# CHAT-ASSIST-001 交接

后续更新（2026-10-16）：用户要求更简洁的设计且无需辅助标注。002已移除输入区及消息标注，保留内部来源；本页其余描述是001交付时快照。当前结果与简化提案见[CHAT-ASSIST-002](CHAT-ASSIST-002.md)。

2026-10-16，状态 `review`。用户已批准聊天中的发送前翻译辅助；沿用共享分支 `codex/disable-legacy-readlang`，保留其他任务的改动。Commit：无；未提交、推送或部署，无数据库迁移或真实库写入。

## 交付与手动验收

刷新聊天页，进入已添加且可聊天的 Lucía，在输入区点「这句怎么说」。输入例如「我不是不想去，就是今天有点 cansado，想改天再约。」后点「生成西语表达」。应只出现一条自然西语，聊天中尚无新增消息。点击「听一遍」播放统一 MiniMax 女声；「填入输入框」后可修改，点击原发送按钮才发给角色。消息显示「翻译辅助」。仅预览/听过后关闭、自己打字或口述，也保留本轮辅助来源；下一轮重新开始。

生成中可以取消、修改源文或关闭；旧响应不得回填。生成失败保留当前输入并可重试。切换角色/账户、隐藏/离开页面、发送、开始录音/转写时取消并清除预览和朗读。手机面板可局部滚动，浅深主题与320–1440px已用Chromium检查。

中文草稿和临时译文不保存至聊天、关系记忆或学习证据，也不写普通日志。生成时，草稿与本用户本角色最多6条已完成、未撤回消息（每条最多2000字符）会发送给 MiniMax；不会读取其他角色或关系记忆。朗读会把西语文本发给统一TTS供应商。显式发送的消息正常持久化，标记 `translation_assisted`；当前普通聊天不产生学习能力证据。客户端来源声明缺失不能证明独立能力。

## 修改文件

新增：

- `app/api/v1/conversations/[characterId]/expression-assist/route.ts`：鉴权、严格协议、private/no-store与错误映射。
- `src/modules/conversation/application/assist-expression.ts`、`expression-assist-error.ts`、`expression-assist-attempts.ts`：角色/联系人门禁、30秒截止、只读上下文、临时单飞与取消。
- `src/modules/conversation/repositories/expression-assist-repository.ts`：本用户/本角色上下文与当前已发布版本投影。
- `src/modules/conversation/http/read-expression-assist-body.ts`、`schemas/expression-assist.ts`：16KiB流式body上限与严格DTO。
- `src/modules/conversation/ui/expression-assist.tsx`、`expression-assist.css`、`request-expression-assist.ts`：面板、共享朗读、显式填入、客户端截止与过期响应隔离。
- `contracts/schemas/v1/expression-assist-request.schema.json`、`expression-assist-response.schema.json`。
- `tests/unit/expression-assist.test.ts`、`expression-assist.test.tsx`、`expression-assist-route.test.ts`、`expression-assist-attempts.test.ts`、`chat-expression-assist.test.tsx`、`minimax-translation.test.ts`。
- `tests/contracts/expression-assist-contract.test.ts`、`tests/e2e/chat-expression-assist.spec.ts`。

修改：

- `src/modules/conversation/ui/voice-composer.tsx`、`chat-thread.tsx`、`domain/conversation-state.ts`：入口、焦点、中文输入法Enter保护、本轮辅助标记及发送/排队/重试来源。
- `app/api/v1/conversations/[characterId]/stream/route.ts`、`src/modules/conversation/repositories/conversation-repository.ts`、`drizzle-conversation-repository.ts`：接收辅助声明、保留来源、幂等重试异文409，复用既有 `source_type` 文本列。
- `src/modules/providers/translation/translation.ts`、`minimax-translation.ts`：保留西→中，增加中文/混输→es-ES与有界上下文、校验/截断/取消处理。
- `contracts/schemas/v1/conversation-stream-request.schema.json`、`contracts/openapi/v1/openapi.json`：可选 `assistance=translation`、正整数角色版本（当前Lucía为2）、新接口及409/429等响应。
- `tests/unit/conversation-route-persistence.test.ts`、`tests/database/conversation-persistence.test.ts`：发送与恢复来源、幂等、上下文隔离和撤回过滤。
- `PROJECT_STATUS.md`、内容供应实施计划本任务章节、`docs/architecture.md`、`docs/testing-strategy.md`、本交接。

共享文件中有其他任务已有改动，尤其聊天流完成处理、其他媒体API和OpenAPI部分；以上仅描述本任务增量，不宣称整个工作树或整个文件差异归本任务。独立构建自动追加的两个 `tsconfig.json` include 已移除，保留原有全部include。

## 验证结果

最终专项 **12 files / 187 tests** 通过：11文件150项联合运行，另 `tests/unit/conversation.test.ts` 37项。包含实际PGlite repository的12项，无真实数据库访问；PGlite不等于Supabase/RLS实测。

```powershell
corepack pnpm exec vitest run tests/unit/expression-assist.test.ts tests/unit/expression-assist.test.tsx tests/unit/chat-expression-assist.test.tsx tests/unit/expression-assist-route.test.ts tests/unit/expression-assist-attempts.test.ts tests/unit/minimax-translation.test.ts tests/unit/conversation-route-persistence.test.ts tests/unit/conversation-thread.test.tsx tests/unit/voice-composer.test.tsx tests/database/conversation-persistence.test.ts tests/contracts/expression-assist-contract.test.ts
corepack pnpm exec vitest run tests/unit/conversation.test.ts
corepack pnpm exec playwright test tests/e2e/chat-expression-assist.spec.ts --reporter=list
corepack pnpm typecheck
```

新增Playwright桌面/手机Chromium **10/10**，覆盖生成/听/填入/编辑/显式发送、关闭后自写保留来源、503与重试、晚到响应、两主题四宽度与44px目标。最终专项lint覆盖本任务27个TS/TSX文件，exit0。全树typecheck exit0。隔离输出目录 `.next/chat-assist-build` 执行 `corepack pnpm build` exit0，生产编译、TypeScript与77页静态生成成功；未设置 `NEXT_MEASUREMENT_BUILD`，未忽略类型错误，未占用开发服务3000端口。

全量门禁未全绿：

| 检查 | 实际结果 |
| --- | --- |
| `corepack pnpm lint` | V8约2GB内存不足，exit134，未完成 |
| `corepack pnpm test --run` | 404文件：397通过/7失败；2526项：2515通过/10失败/1跳过 |
| 新增E2E与 `tests/e2e/conversation.spec.ts` 联跑 | 46项：38通过/6失败/2跳过；新增翻译用例全通过 |

Vitest失败分布：`article-acquisition-publish.test.ts` 2、`corpus-form-frequency-materialisation.test.ts` 1、`account-data-route.test.ts` 2、`desktop-navigation.test.tsx` 2、`learning-heatmap.test.ts` 1、`lucia-data-route.test.ts` 1、`vocabulary-page.test.tsx` 1。扩展聊天E2E失败涉及从 `/chat` 搜索时的页头期待、未发布Mateo/Inés的输入区期待、撤回确认/菜单位置。**没有以隔离回退本任务的方式证明基线归因，不能把这些失败认作通过或断言全部既有。** 本任务专项均通过，未删除测试或放宽断言处理全量失败。

日志与截图位于仓库外 `D:/workspace-artifacts/chat-assist-001/`：`focused-tests.log`、`domain-tests.log`、`focused-lint.log`、`full-lint.log`、`full-vitest.log`、`build.log`、`e2e.log`，另有桌面/手机四宽度两主题PNG和JSON布局数据。测试默认使用Playwright输出目录，本机通过 `CHAT_ASSIST_EVIDENCE_DIR` 指向上述外部目录，无机器路径硬编码。人工检查最终375px浅色和1440px深色截图。所有供应商、音频和聊天网络验证使用fake/拦截，不代表真实发音或供应商生成质量。

## 限制与下一步

- 未跑整个Playwright项目；已跑新增流程与原聊天扩展集，后者失败尚待独立定位。未改Flutter，未跑Flutter检查。
- 未真实调用收费MiniMax或鉴权Supabase/RLS，未验iPhone Safari/PWA真机、麦克风或扬声器。下一步由所有者在现有登录/有效联系人/供应商配置环境按上述步骤体验，观察表达是否贴合语境和播放是否正常。
- 翻译内容为AI生成，并非唯一标准答案或正式内容审核；西语基本文字校验不能证明语义质量。
- attempt成功结果仅在服务进程内短暂保留30秒，最多128项/512KiB，HMAC隔离用户/角色/版本/attempt；无持久化或跨进程去重。相同attempt异文409、待处理满载429；最后等待者退出取消底层调用，取消不能退还已发生供应商费用。用户主动重新生成使用新attempt，可能产生新费用。
- 仅本轮客户端辅助来源保守传播，不提供防篡改的独立能力认证；普通聊天仍无评分写入。若将来增加聊天评分，必须重新设计服务端可证明的证据边界。
- 建议另立任务归因并修复全量门禁失败，再做发布验证；本次没有部署。
