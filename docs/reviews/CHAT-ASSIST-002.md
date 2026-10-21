# CHAT-ASSIST-002：翻译交互调研与去除标注

后续更新：用户已批准本页三状态方案，003已实现单输入框翻译，当前交互及验证见[CHAT-ASSIST-003](CHAT-ASSIST-003.md)。下文保留本次调研交付时的记录。

2026-10-16，状态 `review`。用户要求调研更简洁的设计，并明确不需要“翻译辅助”标注。本次交付为官方设计模式调研、具体简化提案及已完成的去标注修改。整体交互提案尚未替换当前面板；沿用共享分支 `codex/disable-legacy-readlang`，保留其他任务改动。Commit无，未提交/推送/部署。

## 调研证据

以下官方页面于2026-10-16正常取得HTTP200正文。结论基于官方说明，不冒称已亲自操作其应用或对竞品用户做可用性实验。

| 来源 | 已核实的交互 | 对本产品的启发 |
| --- | --- | --- |
| [DeepL for Chrome](https://www.deepl.com/en/chrome-extension) | 支持在网页编辑文字时选择文本，点击DeepL图标进行翻译；写作建议也从当前可编辑文字进入 | 入口靠近正在写的文字，复用原输入，不另开一套常驻翻译表单 |
| [iPhone：在App中翻译文本](https://support.apple.com/guide/iphone/translate-text-in-apps-iphab4dcff1d/ios) | 选中文字调用翻译，可播放原文或译文；可用“Replace with Translation”替换可编辑原文 | 翻译、试听、采用围绕当前文字完成，替换需要用户明确操作 |
| [iPhone：Writing Tools](https://support.apple.com/guide/iphone/writing-tools-write-improve-summarize-iph6f08da1d2/ios) | 从正在写的选中文本进入，按需改写/校对等；文档也描述查看生成结果、采用及恢复原文 | 工具随写作出现，结果可检查和撤销；本产品不需要照搬语气菜单或多种生成任务 |

未将Apple的本地翻译、系统菜单或Writing Tools能力推定为本产品能力；这里只借鉴交互方式，供应商仍为现有MiniMax。尝试取得Gboard官方页失败，猜测的WhatsApp页面404，均未作为证据。UI/UX技能两次局部检索未得到与渐进展示直接匹配的条目，不引用其无关排名；采用技能原有可访问性/触控/反馈检查表。

公开正文与抓取脚本存于仓库外 `D:/workspace-artifacts/chat-assist-002/research.json`、`research.mjs`，无私人聊天或密钥。

## 当前界面为何显得复杂

1. 聊天输入框之外又有一个中文输入框，用户需要在两处编辑文字。
2. 常驻入口、标题、生成按钮、结果分隔、试听、填入和解释文字同时争夺注意力。
3. 手机面板最高占42dvh，内部还要滚动，聊天内容被压缩。
4. “本轮已用翻译辅助”和消息尾标注把内部来源状态变成持续视觉负担。用户已明确要求去掉。

## 推荐交互：单输入框，临时预览

[三状态设计示意](/D:/workspace-artifacts/chat-assist-002/translation-design.png) · [HTML稿](/D:/workspace-artifacts/chat-assist-002/translation-design.html)

直接在现有聊天框写中文/混合文字 → 点击输入栏内的「译」 → 输入框上方出现小型西语预览 → 可「听一遍」或「使用」 → 使用后替换成可编辑西语，预览收起，用户再用原发送按钮发送。

- 常态只增加一个翻译入口；使用文字「译」并提供完整可访问名称/提示，避免不明图标。
- 复用当前草稿，不再单独输入中文；不默认生成、不随着每次打字请求供应商。
- 结果只显示译文、试听、使用和关闭。去掉重复标题、分隔层级与常驻操作说明。
- 原文在点击使用前保留；关闭、失败或超时不替换草稿。修改原文使已有结果失效。
- 点击使用后继续编辑/自行发送；试听或生成都不能自动发送。
- 加载状态在原翻译操作处显示并可取消，错误在附近简短说明和重试。保留取消、30秒截止、旧generation隔离和账户/页面生命周期清理。
- 正式实现须保留44px触控目标、可访问名称、焦点恢复、Escape关闭、输入法Enter保护、键盘/安全区适配与浅深主题；简化视觉不能以缩小点击区域或删掉错误恢复实现。

另一个可行方向是点击翻译后直接替换并提供撤销，可少一次“使用”。本项目仍有听说学习目标，用户可能只想听后自己说，因此推荐保留小预览；这一取舍属于本产品建议，并非竞品研究已证明的优劣。

本次没有把提案直接写入产品。下一步是确认这张具体交互稿，再以独立切片改造输入区；不需要另做供应商或数据库设计。

## 已完成的修改

- `src/modules/conversation/ui/expression-assist.tsx`：移除输入区“本轮已用翻译辅助”，删去仅为展示使用的prop。
- `src/modules/conversation/ui/expression-assist.css`：移除无用badge样式。
- `src/modules/conversation/ui/voice-composer.tsx`：移除展示状态的传递。
- `src/modules/conversation/ui/chat-thread.tsx`：移除发送/历史消息的“翻译辅助”尾标；删除仅用于显示的React state，保留内部ref及发送、排队、重试的来源。
- `tests/unit/chat-expression-assist.test.tsx`、`tests/e2e/chat-expression-assist.spec.ts`：改为验证界面不标注，同时继续断言显式发送、编辑、无中文草稿泄露、内部来源及下一轮重置。
- `PROJECT_STATUS.md`、实施计划本任务章节、`docs/architecture.md`、`docs/testing-strategy.md`、001交接的后续说明与本报告。

无API、provider、数据库或能力评分逻辑变更；去标注不删除来源数据，也不把辅助表达当作自主表达证据。

## 验证与限制

先修改实际ChatThread回归断言，旧UI因仍显示“本轮已用翻译辅助”失败，再修改组件移除标注。

```powershell
corepack pnpm exec vitest run tests/unit/chat-expression-assist.test.tsx tests/unit/expression-assist.test.tsx tests/unit/voice-composer.test.tsx tests/unit/conversation-thread.test.tsx
corepack pnpm exec playwright test tests/e2e/chat-expression-assist.spec.ts --reporter=list
corepack pnpm exec eslint src/modules/conversation/ui/expression-assist.tsx src/modules/conversation/ui/voice-composer.tsx src/modules/conversation/ui/chat-thread.tsx tests/unit/chat-expression-assist.test.tsx tests/e2e/chat-expression-assist.spec.ts --max-warnings=0
corepack pnpm typecheck
```

- 聚焦4文件45项通过；桌面/手机Chromium E2E10/10通过；5个TS/TSX文件专项lint通过。
- 全树typecheck exit2：`src/modules/content-acquisition/application/process-media-candidate.ts`及`tests/unit/media-processing-orchestrator.test.ts`缺少 `processingAudience`，共10项错误。发生于本次未修改的内容处理模块，没有改断言或扩张范围处理；本次全树类型检查不能记通过，也未隔离回退证明其历史归因。
- 未重新运行全仓lint/全量Vitest/全套E2E或生产build：本次只删显示标注，已验证相关路径，且当前全树类型门禁有上述错误；上轮全量还存在OOM与其他失败，不能引用上轮通过替代本次通过。未验真实收费provider、真实库/RLS或iPhone Safari/PWA真机。
- UI截图/布局JSON、`unit.log`、`e2e.log`、`typecheck.log`及HTML提案/PNG位于 `D:/workspace-artifacts/chat-assist-002/`。静态提案用本地Chromium渲染并人工检查；提案不是已经实现的交互。

用户验证：刷新聊天，生成/试听/采用/修改后发送，输入区与消息均不应显示“翻译辅助”；原翻译功能仍能正常工作。新的更简洁布局见提案，尚未部署或替换。
