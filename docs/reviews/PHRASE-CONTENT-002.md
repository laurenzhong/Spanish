# PHRASE-CONTENT-002：表达扩充与自测朗读

- 所有者授权：2026-10-15，认可新版短语设计后要求继续扩充，随后要求情境自测的说法提供发音按钮。
- 版本：`2026-10-15.v2`，60条；保留首版24条，新增36条，六个主题各10条。
- 内容：`src/modules/lexicon-corpus/content/phrasebook-v2.ts` 聚合首版及 `phrasebook-expansion-a.ts`、`phrasebook-expansion-b.ts`；稳定入口 `phrasebook.ts`。
- 起草：Codex AI 内容代理 `author_phrases_a` / `author_phrases_b`；修订与接入：主代理；独立双维复验：Codex AI `review_expansion`。
- 审核身份按仓库约定使用 `dsh-ai-owner-authorized-review`；实际执行者为 Codex AI，不是人工、母语者或教学专家签字，标识不代表执行平台事实。
- 来源：全部为原创教学示例，不冒充真实语料，不复制第三方正文。仅适用于所有者个人阶段。

首轮独立检查36条，`es-ES` 35/36、`zh-CN` 34/36通过。修正 `repair-check-understanding` 前句中缺少“去之前预订”导致的推导跳跃，以及 `everyday-exchange` 将退货与退款混同的中文说明。同时将 `connect-turn-back` 的句型、替换、说明和题干统一为 `qué me cuentas de`，避免重复首版练习；`requests-clarify-need` 明确由说话者选择使用 usted 称呼。

独立代理重新读取全部36条，最终 **es-ES 36/36 approved；zh-CN 36/36 approved**，各主题均6/6。复验包括自然度、语域、代词、对话衔接、含义、语用限制及题干与参考答案对应。内容批准后只将草稿导出符号和文件头改为最终名称与审核说明，条目不变；机器可读审核记录绑定最终文件。

所有依赖的 UTF-8/LF 规范化 SHA-256 见 `src/modules/lexicon-corpus/content/phrasebook-v2.review.json`。独立审核者再次核对最终文件哈希，确认只改了草稿注释和导出名，条目与批准版本完全一致；5个依赖、版本及活动入口均匹配。首版文件、首版审核与历史报告保持原值；单元测试同时锁定首版哈希、24条逐项不变、60个唯一ID及表达、每类10条和全部依赖哈希。

情境自测揭晓后，“一种自然的说法”旁可朗读/停止 `replacement.es`；展开核心表达后可单独朗读/停止 `expression`。复用浏览器 TTS，切题、退出、切主题、卸载以及收起正在朗读的核心表达均取消播放；旧回调由既有 generation 门禁隔离。不支持或失败时提供反馈，不影响查看与自测。无录音、收费供应商调用、能力证据或评分变更。旧收藏ID和账号隔离的localStorage key保持不变。

工程验证和验收限制以 `PROJECT_STATUS.md` 的同任务记录为准。浏览器音频使用可控的原生接口 fake 验证文本、es-ES和生命周期；不能据此声称真实扬声器听感或 iPhone Safari 真机已经通过。
