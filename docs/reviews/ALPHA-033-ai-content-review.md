# ALPHA-033 所有者授权 AI 内容审核报告

- 审核日期：2026-09-12
- 审核者引用：`codex-ai-owner-authorized-review`
- 审核主体：Codex（AI）
- 授权：产品所有者于 2026-09-12 明确授权在仅供本人使用的个人产品阶段，由 Codex 独立完成西班牙语语言与中文教学两个审核维度
- 候选：`alpha.core@2`、`alpha.scenario-practice@2`
- 最终结论：26 条表达、3 个基础场景、9 个沟通领域、20 个学习目标和 1 个内容包在完成下述修订后通过；无 reject 项

本报告不代表真人、西班牙语母语者或语言教学专家签字。产品开始邀请、允许或面向其他真实用户使用前，必须按 ADR-0007 新增 ADR，重新决定外部复核门槛。

## 1. 审核方法与限制

每条表达分别检查西语正文、中文翻译、交际意图、自然变体、CEFR、地区、语域、语法、发音、语用、标签与权重；每个场景检查临时人物、开场、条件变化、任务、成功标准、三级提示、迁移和虚构现实边界。自动检查另覆盖 Schema、引用、版本、发布状态、双 locale 审核记录和版权字段。

尝试访问 RAE 的 `formalizar` 词条时遇到 Cloudflare 安全验证，Google 搜索连接超时，因此本次未完成外部网页权威资料核验，也不作此类声明。修订依据为高置信度的标准西班牙语规则、内容内部一致性和产品既定教学/安全准则；该限制不改变本次个人产品阶段的所有者授权，但应在未来扩大用户范围时纳入外部复核。

审核记录的共同结论：

- `es-ES`：语言、自然度、语域、地区和发音维度 approved。
- `zh-CN`：翻译、语法说明、语用说明、提示递进和教学安全维度 approved。
- AI 生成或既有草稿没有自动获得批准；本报告、逐项修订和自动门禁共同构成独立审核步骤。

## 2. `alpha.core@2` 表达审核

| 表达 | 结论 | 修改前 | 正式候选 | 理由 |
|---|---|---|---|---|
| `start.como-va-todo` | revise → approve，v1→v2 | 正文不变；重音与语调说明较含糊 | `¿Cómo va todo?`；明确 `Cómo` 重音在 `có`、`todo` 重音在 `to`，句末自然上扬 | 避免把问句语调或停顿说成机械规则 |
| `relationship.como-se-llama` | approve，保持 v1 | `¿Cómo se llama?` | 同左 | `usted` 与 `tú` 变体、翻译、语域和 `ll` 提示准确 |
| `relationship.me-gusta-viajar` | revise → approve，v1→v2 | 把 `viajar y` 描述成元音连读 | `Me gusta viajar y probar la comida local.`；改为末尾 `r` 与后接 `y` 自然衔接但保持清楚 | 原说明容易误导音素关系 |
| `need.necesito-ayuda` | revise → approve，v1→v2 | 发音说明不足 | `Necesito ayuda.`；补充 `necesito` 重音在 `si`、`ayuda` 重音在 `yu`，并说明 `y` 的起始音 | 给中文母语学习者更清楚且不过度拟音的提示 |
| `response.suena-bien` | approve，保持 v1 | `Suena bien.` | 同左 | 比喻性 `sonar` 用法、双元音和语用限制准确 |
| `maintain.que-le-gusta-hacer` | approve，保持 v1 | `¿Qué le gusta hacer en su tiempo libre?` | 同左 | `le/usted`、`te/tú` 变体和闲聊边界一致 |
| `repair.podria-repetirlo` | approve，保持 v1 | `¿Podría repetirlo?` | 同左 | 条件式礼貌、代词 `lo` 和正式度说明准确 |
| `repair.podria-hablar-mas-despacio` | revise → approve，v1→v2 | `avoidWhen` 混入系统行为 | `¿Podría hablar más despacio?`；限制改为对方已放慢时不重复请求，设备/转写故障走技术恢复 | `avoidWhen` 应描述真实使用限制，不能成为评分或产品流程规则的替身 |
| `need.cuanto-cuesta-esto` | revise → approve，v1→v2 | 双元音与重音说明不够准确 | `¿Cuánto cuesta esto?`；明确 `cuánto` 的 `ua`、`cuesta` 的 `ue` 均连贯发出 | 修正中文发音支架 |
| `navigate.creo-que-estoy-perdido` | revise → approve，v1→v2 | `Creo que estoy perdido.` 默认绑定男性说话者 | `Creo que me he perdido.`；补充现在完成时说明，并保留男性 `perdido`、女性 `perdida` 变体 | 主表达改为性别中性；过去分词与 `haber` 连用时不随性别变化 |
| `end.sigamos-en-contacto` | approve，保持 v1 | `Sigamos en contacto.` | 同左 | 虚拟式、固定搭配和不得承诺虚构线下行动的边界清楚 |

## 3. `alpha.scenario-practice@2` 表达审核

| 表达 | 结论 | 修改前 | 正式候选 | 理由 |
|---|---|---|---|---|
| `restaurant.queria-pedir` | approve，保持 v1 | `Quería pedir el menú del día.` | 同左 | 餐厅服务语境自然，未完成过去时的委婉效果说明准确 |
| `restaurant.lleva` | approve，保持 v1 | `¿Lleva frutos secos?` | 同左 | `llevar` 表示含有配料自然；严重过敏仍需明确说明 |
| `restaurant.soy-alergico` | approve，保持 v1 | `Soy alérgico a los frutos secos.` | 同左 | 性别变化、介词 `a` 和“偏好不等于过敏”边界准确 |
| `restaurant.que-recomienda` | approve，保持 v1 | `¿Qué me recomienda?` | 同左 | `usted` 语域与替代选择语境自然 |
| `restaurant.tomare-eso` | revise → approve，v1→v2 | `Entonces, tomaré eso.` | `Pues tomaré eso.` | 在接受现场建议时更自然；同步三级提示 |
| `campus.vengo-para` | revise → approve，v1→v2 | `Vengo para completar mi matrícula.` | `Vengo para formalizar mi matrícula.` | 学校行政窗口中更明确表达完成正式注册手续；同步语法、发音与三级提示 |
| `campus.que-documentos` | approve，保持 v1 | `¿Qué documentos tengo que presentar?` | 同左 | 文件清单、`tener que` 与西班牙用语变体准确 |
| `campus.aqui-tiene` | approve，保持 v1 | `Aquí tiene mi pasaporte y el formulario.` | 同左 | 递交文件时自然；未携带材料时的使用限制清楚 |
| `campus.me-falta` | approve，保持 v1 | `Me falta ese documento.` | 同左 | 单复数 `falta/faltan` 与补交语境准确 |
| `campus.puedo-enviarlo` | approve，保持 v1 | `¿Puedo enviarlo por correo electrónico?` | 同左 | 代词 `lo` 指单数文件，且没有假定邮件一定被接受 |
| `rental.cuanto-cuesta` | revise → approve，v1→v2 | 重音说明含糊 | `¿Cuánto cuesta el alquiler al mes?`；明确 `cuánto`、`alquiler` 重音及 `cuesta` 的 `ue` 双元音 | 修正中文发音支架并保留虚构报价边界 |
| `rental.gastos-incluidos` | approve，保持 v1 | `¿Están incluidos los gastos?` | 同左 | 复数一致和额外费用语境准确，不把练习回答当合同条款 |
| `rental.cuanto-dura` | approve，保持 v1 | `¿Cuánto dura el contrato?` | 同左 | 期限询问自然，现实签约以书面合同为准 |
| `rental.se-permiten` | revise → approve，v1→v2 | 说明含 `se permits` 拼写错误，语法命名不准确 | `¿Se permiten mascotas?`；改为 `pasiva refleja`，明确复数主语对应 `permiten` | 修复明显错误并提高教学准确性 |
| `rental.otra-hora` | revise → approve，v1→v2 | `¿Podríamos quedar a otra hora?` 对“看房”动作指向不够明确 | `¿Podríamos ver el piso a otra hora?` | 明确协商的是虚构看房时间；同步语法、发音与三级提示 |

## 4. 场景审核

| 场景 | 结论 | 修改前 | 正式候选与理由 |
|---|---|---|---|
| `scenario.restaurant-ordering` | revise → approve，v1→v2 | 第三级提示引用旧版 `Entonces, tomaré eso.` | 改为 `¿Qué me recomienda? Pues tomaré eso.`；人物先等待用户完整表达，售罄条件只创造表达机会，不中途纠错 |
| `scenario.campus-administration` | revise → approve，v1→v2 | 第一级任务引用旧版 `completar mi matrícula` | 改为 `Vengo para formalizar mi matrícula.`；材料缺失后允许承认缺少并协商补交，不把虚构要求说成真实学校规定 |
| `scenario.rental-conversation` | revise → approve，v1→v2 | 协商时间提示使用含糊的 `quedar` | 改为 `¿Podríamos ver el piso a otra hora?`；开场、条件、成功标准和任务均显式标为虚构，不代表真实房源、报价、合同或预约 |

三个场景的三级提示均保持“意图 → 关键词/骨架 → 完整示范与自然替代”的递进。成功标准以交际任务完成为先，不要求唯一参考句；文字输入不构成发音、语流或真实口头反应证据。

## 5. 沟通领域审核

| 领域 | 结论 | 审核说明 |
|---|---|---|
| `communication.start` | approve | “开始交流”命名、说明和目标归属准确 |
| `communication.relationship` | approve | “建立关系”覆盖询问姓名与分享兴趣，范围一致 |
| `communication.need` | approve | “表达需要”覆盖求助与询价，不扩大为评分标签 |
| `communication.response` | approve | “回应对方”与接受建议目标一致 |
| `communication.maintain` | approve | “维持对话”与兴趣追问目标一致 |
| `communication.repair` | approve | “修复沟通”覆盖重复和放慢请求，边界清楚 |
| `communication.navigate` | approve | “处理方向问题”与说明迷路目标一致 |
| `communication.end` | approve | “结束与延续”与保持联系目标一致 |
| `communication.daily-life` | approve | 餐厅、校园和租房练习共同归入日常生活沟通合理 |

上述 9 个领域文字保持不变，仅在审核通过后按导入规则从 draft 单向推进到 published。

## 6. 学习目标审核

| 目标 | 结论 | 审核说明 |
|---|---|---|
| `communication.start.check-in` | approve | 轻松询问近况，A1–A2 合理 |
| `communication.relationship.ask-name` | approve | 礼貌询问姓名，A1–A2 合理 |
| `communication.relationship.share-interest` | approve | 分享兴趣并创造追问机会，A2–B1 合理 |
| `communication.need.ask-help` | approve | 直接说明需要协助，A1–A2 合理 |
| `communication.response.accept-suggestion` | approve | 正面回应建议，A1–A2 合理 |
| `communication.maintain.ask-interest` | approve | 用兴趣问题维持对话，A2–B1 合理 |
| `communication.repair.ask-repeat` | approve | 未听清时请求重复，A1–A2 合理 |
| `communication.repair.ask-slower` | approve | 语速过快时请求调整，A1–A2 合理 |
| `communication.need.ask-price` | approve | 询问商品或服务价格，A1–A2 合理 |
| `communication.navigate.signal-lost` | approve | 说明迷路并寻求帮助，A2–B1 合理 |
| `communication.end.keep-contact` | approve | 结束交流并表达继续联系，A2–B1 合理 |
| `daily.restaurant.order` | approve | 自然点单，A2–B1 合理 |
| `daily.restaurant.allergy` | approve | 确认配料并说明过敏，A2–B1 合理 |
| `daily.restaurant.alternative` | approve | 菜品不可用时询问并接受替代，A2–B1 合理 |
| `daily.campus.purpose` | approve | 在行政窗口说明办理目的，A2–B1 合理 |
| `daily.campus.requirements` | approve | 确认所需文件和步骤，A2–B1 合理 |
| `daily.campus.missing-document` | approve | 处理材料缺失并确认补交方式，A2–B1 合理 |
| `daily.rental.costs` | approve | 只询问虚构练习中的租金费用，A2–B1 合理 |
| `daily.rental.conditions` | approve | 询问合同和居住条件，A2–B1 合理 |
| `daily.rental.schedule` | approve | 只协商虚构练习中的看房时间，A2–B1 合理 |

上述 20 个目标文字保持不变，仅在审核通过后按导入规则从 draft 单向推进到 published。

## 7. 内容包审核

`immersive.first-cafe-conversation@1`（《咖啡馆里的新朋友》）结论为 approve。3 个片段与 6 个活动保持原版本和原文字：西语对话、中文翻译、意群、活动顺序与模态一致；打字活动明确不产生口语证据，显式口语活动才进入后续口语复核。来源是 `ai_assisted_original`，作者、original license、署名、许可证据、`cleared` 版权状态和 AI 辅助说明完整。为保护既有收藏与断点，实体版本保持 1，只把状态和 `publishedAt` 按允许的单向推进规则更新。

## 8. 版本、审核记录与发布决定

- Bundle 创建后继版本 `alpha.core@2` 与 `alpha.scenario-practice@2`；v1 文件保留为历史候选。
- 教学或语义字段发生变化的表达升到 v2；未变化表达保持 v1。三个场景因三级提示引用修订而升到 v2。
- 每条正式表达和每个正式场景都写入 `es-ES`、`zh-CN` 两条 approved review，审核者引用均为 `codex-ai-owner-authorized-review`。
- 领域、目标和内容包写入 owner-authorized approved review；相关西语与教学内容已经纳入本报告。
- 本次范围内 domain、goal、expression、variant、scenario 和 content pack 均设置为 published；`publishedAt` 使用 `2026-09-12T04:30:00.000Z` 的等价 UTC 表示。
- `alpha.core@2` 不携带旧 5 个场景、文章或角色；文章运行时继续读取 v1 与其既有发布来源。
- 旧表达版本、收藏、断点和学习证据不得被重写或静默改绑；运行时发布投影使用 v2，历史引用继续按原稳定 key 和版本解析。

## 9. 自动验证

正式发布候选必须至少通过：

```powershell
pnpm content:validate -- content/bundles/alpha-core-v2.json
pnpm content:validate -- content/bundles/scenario-practice-alpha-v2.json
pnpm test --run tests/unit/published-content-bundles.test.ts tests/database/content-import.test.ts
```

最终导入和发布候选结果在 `PROJECT_STATUS.md` 的 ALPHA-033 交接中记录；本报告本身不等于数据库导入完成。
