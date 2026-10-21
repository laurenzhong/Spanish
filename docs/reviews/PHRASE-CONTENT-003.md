# PHRASE-CONTENT-003：120条实用表达与对话朗读

- 授权：2026-10-15，所有者批准将60条扩充至120条，并为示例对话增加朗读。
- 内容版本：`2026-10-15.v3`；沿用六个交际主题，每类20条。旧60条、ID、收藏存储键及历史审核保留不变。
- 内容文件：`src/modules/lexicon-corpus/content/phrasebook-v3-social.ts`（接话、修复沟通、观点各10条）及 `phrasebook-v3-practical.ts`（安排、请求、办事各10条）；聚合 `phrasebook-v3.ts`。
- 起草：Codex AI `author_phrases_a`、`author_phrases_b`；主代理修订和实现；独立内容审核：Codex AI `review_expansion`。
- 审核身份使用仓库约定 `dsh-ai-owner-authorized-review`，实际执行者为Codex AI，不代表真人、母语者或教学专家签字。仅适用于当前所有者个人阶段。
- 内容来源：原创情境示例，不引述第三方语料。健康、办事、租房、退款均为语言练习，不给诊断、法规承诺或虚构真实行动。

## 审核与修订

practical首轮 `es-ES` 30/30、`zh-CN` 29/30通过。修正 `everyday-missing-document` 模板：明确阳性单数材料配 `aportarlo`，说明阴性/复数代词及 `me faltan` 的对应关系。

social首轮 `es-ES` 29/30、`zh-CN` 27/30通过。修正 `repair-one-at-a-time`，使第一轮成为单个说话者明确报告多人同时讲话，与逐句朗读和下一轮复数称呼连贯；`connect-encourage-another-try` 模板补 `bien` 并校准中文；`repair-check-digits` 准确说明 `comprobarlo` 中 `lo` 指待核对的号码或信息。

重新独立完整读取后，最终 **es-ES 60/60 approved；zh-CN 60/60 approved**。六个主题的新增内容均10/10。对全部120条进行规范化主表达、ID及人工交际任务重复检查，未见凑数近重复；完整对话、自然回应、语域、代词、替代表达、语用、模板及自测对应均通过。

批准后仅将文件头和Draft导出名改为最终名称；独立审核者在内存恢复草稿元信息，对比此前批准哈希，确认正文未改。最终规范化LF SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `phrasebook-v3-social.ts` | `af3c216ae5d066e1864b6be1103ada1de89b094f2cb780d8ba73773299b0a9b5` |
| `phrasebook-v3-practical.ts` | `3d236412c89a1342c8af290e01e3253b3eaef2c8c20dfc9d7063bda36886405e` |

机器可读记录 `phrasebook-v3.review.json` 绑定7个内容依赖，独立复核均匹配；v2的5个来源哈希也保持匹配。v2审核记录曾绑定 `phrasebook.ts` 的入口文本，因此该文件原样保留为v2兼容入口，当前UI明确导入 `phrasebook-v3.ts`，避免改写旧审核证据。

## 行为与工程验证

示例对话每句可单独朗读/停止，只读该句西语；与主表达、自测参考和核心表达共用一个浏览器TTS实例。切句取消旧播放，收起、筛选、主题、自测或卸载时停止；取消收藏或跨标签页存储变更导致正在朗读的条目消失时也停止。错误可重试，不支持时仍可阅读和自测；无新增供应商、录音、API、数据库、评分或能力证据。

新增朗读和取消收藏回归先复现缺失行为，再实现并验证。`phrasebook-v3.test.ts` 锁定旧60条逐项不变、120个唯一ID/主表达、每类20条、完整Schema及7项依赖哈希；首版和v2历史审核回归保留。浏览器验证逐句实际西语/es-ES、切换/停止/收起/主题/自测/取消收藏、旧回调隔离、失败重试与不支持，并验证新增报修情境、收藏刷新、长表达、浅深主题、320–1440px和44px朗读按钮。

执行结果及完整修改范围见 `PROJECT_STATUS.md` 的同任务记录。音频浏览器测试使用原生接口fake，不代替真实扬声器音色或iPhone Safari/PWA真机验收。
