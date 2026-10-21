# TTS-READALOUD-001：MiniMax 女声全站合成朗读交接

- 日期：2026-10-16
- 授权：所有者在 TTS-AUDITION-001 后选择 MiniMax 女声，并要求现有全部朗读入口及未来功能沿用同一标准。
- 分支：共享 `codex/disable-legacy-readlang`；保留其他会话全部改动。
- Commit：无，未提交、推送或部署；本地开发服务可热更新。
- 决策：[ADR-0019](../adr/0019-unified-minimax-read-aloud.md)。本任务不修改数据库、正式内容、历史审核、评分或关系记忆。

## 交付

固定 `speech-2.8-turbo` / `Spanish_SereneWoman` / synthesis speed 1 / Spanish / 32kHz、128kbps、单声道MP3。它是合成女声，未宣称真人或经核验的 es-ES 母语发音。文章可继续调整播放速度；旧浏览器声音选择改成固定 MiniMax 女声及试听。

全部合成入口共用 `createReadAloud` / `useReadAloud` → `/api/v1/tts`。覆盖词汇点词/朗读、Tatoeba缺录音时的合成、短语主表达/逐句对话/自测参考、语料及对照、媒体点词、阅读书架、文章单词/段落/全文/试听、内容包、训练参考句/重播、场景表达及聊天消息。Tatoeba许可真人录音、视频和播客原声保留；原声失败不静默替换。

共用客户端按最多1000字符分段、串行按需请求，固定声音与服务器合成参数，速度在本地 playbackRate 调整。取消、换内容、隐藏页面和卸载释放资源并隔离旧回调；跨实例合成朗读互斥。真实 playing 才发出 onStart，文章/词汇/媒体与场景/内容包区分准备和播放。正常停止不报错，技术失败不自动完成内容包听力活动。朗读不产生学习能力证据。

通用路由先鉴权再严格Zod校验；旧 `/api/v1/conversations/tts` 作为别名。API key只在服务端，客户端不能指定供应商/模型/音色。Application使用内部provider接口；响应转内部类型并校验，记录供应商、模型/音色、供应商请求ID、延迟和可用计费字符。未知金额/置信度为null。

短期缓存只在进程内，按HMAC(userId+text+policy)隔离，最多128项/32MiB，成功10分钟、失败30秒定时释放。并发/短期重复请求复用；取消客户端等待不会重新启动已开始的付费任务。没有自动重试，没有磁盘/公开缓存/原文日志。跨实例、重启、到期或淘汰后仍可能再次计费，不宣称持久化全局幂等。私人文本朗读也会发送MiniMax，供应商自身保留政策以其条款为准。

## 修改文件

- 共用实现：`src/modules/providers/tts/{policy.ts,read-aloud.ts,use-read-aloud.ts,use-browser-speech.ts,minimax-tts.ts,index.ts,application/synthesize-read-aloud.ts}`；旧hook为兼容别名，旧browser adapter未作产品兜底。
- 路由：`app/api/v1/tts/route.ts`、`app/api/v1/conversations/tts/route.ts`。
- 产品：`src/modules/lexicon-corpus/ui/{vocabulary-shelf.tsx,phrasebook.tsx,corpus-workbench.tsx}`、`media/ui/lexical-drawer.tsx`、`reading/ui/saved-items-library.tsx`、`training/ui/fake-training-loop.tsx`、`content/ui/content-pack-experience.tsx`、`conversation/ui/chat-thread.tsx`、`scenario-practice/ui/scenario-expression-list.tsx`（后七项同属`src/modules`），以及 `app/(product)/read/article/[articleId]/article-reader.tsx`。这些文件已有其他任务改动，本任务只迁移朗读及其生命周期。
- 协议/约束：`contracts/schemas/v1/tts-request.schema.json`、`contracts/openapi/v1/openapi.json`、`AGENTS.md`、`.env.example`。新静态回归禁止产品绕过共享入口直接使用浏览器TTS。
- 测试：新增read-aloud客户端/hook/application/标准测试及tts-contract；更新MiniMax/路由和13份UI回归；新增 `tests/helpers/read-aloud-fake.ts`、`tests/e2e/fixtures/read-aloud.ts`、`tests/e2e/shared-read-aloud.spec.ts`，迁移文章/短语/语料/训练/内容包/媒体E2E朗读mock。
- 文档：本报告、ADR-0019、README、PROJECT_STATUS、架构/内容/测试策略与2026-09-12实施计划。

## 验证记录

- 核心客户端、hook、application、路由、供应商与契约最终聚焦：**8 files / 63 tests**通过。含西语locale兼容/长空白段、损坏或截断MP3/ID3、完整首帧、Content-Length与流式大小上限；真实录音经过新结构校验仍逐字节相同，未重复收费调用。
- 产品UI：12 files / 202 tests 与词汇回想11 tests分别通过，合计13 files / 213 tests；延迟onStart、同ID取消再播、技术失败不完成、过期回调和不写证据均有断言。
- 受影响产品、供应商/路由、单元与E2E文件ESLint通过；全局typecheck在收尾前曾通过。最终执行因其他在途新增`tests/unit/media-series-navigation.test.tsx:97`的TS2345失败，该文件不属本任务且未修改。限定diff whitespace检查通过，不把最终全局typecheck算作通过。
- 专项Playwright：desktop重点28/28、文章/短语对话/共享入口双项目22/22、最终媒体/共享/文章设置双项目14/14均通过；播客/内容包双项目通过。这些批次有重叠，不合并成独立用例总数。默认供应商均为fake，不收费。
- 真实MiniMax一次：原创短句`Buenos días.`，计费字符12，1122ms、21300 bytes、所选模型与音色，两个并发application请求复用同一结果，供应商调用数1。音频保存于忽略目录 `out/tts-readaloud-20261016/smoke.mp3`。浏览器解码约1.184秒/单声道。
- 原生Chrome播放：桌面及Pixel 7仿真分别用真实MP3拦截响应，保持原生Audio和用户点击、禁用speechSynthesis；各1次请求，真实unlock playing → speech playing → speech ended，页面复位且无audio error。这是播放管线冒烟，未用同一短句音频冒称验证所有词的发音。
- 生产构建中途通过（77/77页面）；最终默认15-worker构建在page-data阶段OOM（exit134）。核实本机Next配置源码后用仅本次进程`CIRCLE_NODE_TOTAL=2`限制为单worker重试，最终被上述其他在途测试TS2345阻塞，未绕过类型检查，不算最终构建通过。未持久修改Next配置；本次distDir自动追加的两条tsconfig include已移除，保留其他改动。
- 全量Vitest实际执行，出现Windows Zone OOM和数据库/现有页面等失败，后中止；不报告全量通过。当前源码未涉及的词架旧LR标题、导航/账号鉴权、learning-heatmap、数据库发布测试等失败与本任务测试分列。最初本任务OpenAPI内部ref失败已改用仓库约定的本地schema路径并复验通过；初次旧native mock导致的朗读UI失败也已迁移复验。
- 默认全量lint异常退出3221226505，未得到通过；受影响文件单独通过。真实DB/RLS验证未执行（无数据访问/迁移改动）；PGlite测试失败不能冒称真实库验证。
- 全量Playwright执行至**265/304**时中止，日志记录41项失败；早期有聊天入口/角色、好友介绍、媒体旧空态、场景标题重复匹配和旧焦点断言等非朗读失败，随后其他在途`MEDIA-SERIES-003`新增引用但尚未创建`media-episode-picker`使编译持续失败。未覆盖/修复其他任务；文件稍后创建后，**最终版本文章+词汇/场景/聊天共享入口双项目14/14**重新通过。默认全量运行未完成且不算通过；未经逐项改动前复跑的失败不一概认定历史基线。

## 如何验证与限制

刷新网站，在词汇、短语/逐句、真实用例、媒体点词、文章全文/选词、聊天消息菜单、场景表达、训练重播和内容包点击原有朗读按钮。应听到同一女声；文章设置显示MiniMax女声、试听和语速。准备期间可取消的入口继续可取消，换词/离页停止；断网后显示可恢复错误。已有Tatoeba录音和原视频/播客应仍是原声。

需要网络和服务端 `MINIMAX_API_KEY`，MiniMax按用量计费。没有把Kokoro/Azure接入产品，也没有浏览器合成静默兜底。iPhone Safari/PWA的真实用户手势音频解锁、外放/耳机和听感仍需真机验证；Chrome触屏仿真不代替。下一项建议为所有者在iPhone上逐入口试听验收；全量非朗读失败另开任务治理，不混入本任务。
