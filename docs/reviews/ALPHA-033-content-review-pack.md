# ALPHA-033 正式内容双轨人工审核包

> 生成日期：2026-09-12  
> 审核对象：`alpha.core@1`、`alpha.scenario-practice@1`  
> 当前状态：审核准备完成，**尚未通过人工审核，不可据此发布**

## 1. 用途与边界

本文件把当前候选内容整理成可签字、可追踪的人工审核清单。权威源仍是：

- `content/bundles/alpha-core-v1.json`
- `content/bundles/scenario-practice-alpha-v1.json`

本次审核范围包括 26 条核心表达和 3 个基础场景：

- 西班牙语母语审核：自然度、地区适用性、语域、表达变体、语法和场景真实性。
- 中文教学审核：中文释义、交际意图、语法说明、发音提示、使用限制、分层提示和任务设计。

本次不审核 `alpha.core@1` 中的 5 篇文章，不替代版权/来源审核，也不执行内容导入。本文中的“AI 预审”仅用于提示真人重点检查，不代表母语者或教学专家意见。两个 JSON 的 `status` 和现有 review 记录在真人签字前保持不变。

## 2. 填写方式

每项审核分别选择一个结论：

- `approve`：可按当前版本进入本审核轨道的下一状态。
- `revise`：列明必须修改的具体字段和建议文本。
- `reject`：不应进入正式内容，说明原因。

审核意见应引用稳定 ID 和版本，例如 `restaurant.tomare-eso@1`。若任何正文、变体、说明、提示或任务内容被修改，应创建新内容版本，不能静默覆盖已有版本。

## 3. 表达审核清单：`alpha.core@1`

### 3.1 `start.como-va-todo@1`

- 西语：`¿Cómo va todo?`
- 中文 / 意图：一切都怎么样？／轻松问候，并邀请对方谈谈近况。
- 变体：`¿Qué tal todo?`（轻松问候；general / informal）；`¿Cómo te va?`（对熟人；general / neutral-informal）
- 元数据：A1；neutral-informal；es-ES
- 语法：`va` 是 `ir` 的第三人称单数；`todo` 指整体情况，是固定近况问候。
- 发音：重音落在 có-mo、va、to-do；问题开头自然上扬，`todo` 前不停顿。
- 使用：朋友、同学和轻松熟人；非常正式的首次服务场景宜换正式问候。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 3.2 `relationship.como-se-llama@1`

- 西语：`¿Cómo se llama?`
- 中文 / 意图：您叫什么名字？／礼貌询问初次见面的人的姓名。
- 变体：`Perdone, ¿cómo se llama?`（打断陌生人时更礼貌；general / formal）；`¿Cómo te llamas?`（同龄人或熟人；general / informal）
- 元数据：A1；neutral-formal；general
- 语法：`llamarse` 是反身动词；`se llama` 对应 `usted`，熟人可用 `cómo te llamas`。
- 发音：`llama` 的 `ll` 在西班牙通常接近 y 音；`cómo` 和 `llama` 重读，句末自然上扬。
- 使用：陌生人、老师或服务人员；已经知道姓名时不重复询问。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 3.3 `relationship.me-gusta-viajar@1`

- 西语：`Me gusta viajar y probar la comida local.`
- 中文 / 意图：我喜欢旅行和尝试当地美食。／分享个人兴趣，为对方追问创造机会。
- 变体：`Me gusta conocer sitios nuevos y probar la comida local.`（突出探索新地方；general / neutral）；`Me encanta viajar y descubrir restaurantes locales.`（更强烈地表达喜爱；general / neutral）
- 元数据：A2；neutral；general
- 语法：`me gusta` 后接动词原形；`viajar` 和 `probar` 由 `y` 并列，共用 `me gusta`。
- 发音：`viajar` 的 j 是清晰摩擦音；`me gusta viajar` 与 `y` 自然连读。
- 使用：自我介绍和兴趣闲聊；正式履历介绍应补充具体经历。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 3.4 `need.necesito-ayuda@1`

- 西语：`Necesito ayuda.`
- 中文 / 意图：我需要帮助。／在需要协助时直接说明核心需求。
- 变体：`Necesito ayuda, por favor.`（更礼貌；general / neutral）；`¿Me puede ayudar?`（直接请求；general / neutral-formal）
- 元数据：A1；neutral；general
- 语法：`necesitar` 后可直接接名词；说明行动时可接动词原形。
- 发音：`necesito` 的重音在 si；`ayuda` 的 y 要清楚。
- 使用：紧急或日常求助；对陌生人可加 `por favor`。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 3.5 `response.suena-bien@1`

- 西语：`Suena bien.`
- 中文 / 意图：听起来不错。／对建议给出自然正面回应。
- 变体：`Me parece bien.`（我觉得可以；general / neutral）；`Perfecto, me parece una buena idea.`（更明确认可；general / neutral）
- 元数据：A1；neutral；general
- 语法：`sonar` 用第三人称 `suena`；可评价计划或建议，不限于真实声音。
- 发音：`suena` 的 ue 连贯发音；`bien` 的 ie 连贯，句末不吞 n。
- 使用：回应朋友或同事建议；已决定接受时可补充具体确认。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 3.6 `maintain.que-le-gusta-hacer@1`

- 西语：`¿Qué le gusta hacer en su tiempo libre?`
- 中文 / 意图：您空闲时喜欢做什么？／通过询问兴趣维持对话。
- 变体：`¿Qué te gusta hacer en tu tiempo libre?`（对熟人使用 tú；general / neutral-informal）；`¿Qué suele hacer los fines de semana?`（询问习惯，保留 usted；general / neutral-formal）
- 元数据：A2；neutral-formal；general
- 语法：`gustar` 的人用间接宾语 `le`；对熟人使用 `qué te gusta hacer`。
- 发音：`gusta hacer` 中元音自然衔接；qué、gusta、libre 是主要重音点。
- 使用：初次认识时的中性闲聊；对方赶时间或不愿闲聊时不追问。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 3.7 `repair.podria-repetirlo@1`

- 西语：`¿Podría repetirlo?`
- 中文 / 意图：您能再说一遍吗？／没有听清时礼貌请求对方重复。
- 变体：`¿Podría repetirlo, por favor?`（更柔和；general / formal）；`¿Puede repetirlo?`（较直接但仍礼貌；general / neutral-formal）
- 元数据：A1；formal；general
- 语法：`podría` 是 `poder` 的条件式；`lo` 指前面听到的信息。
- 发音：`podría` 的重音在 rí；`repetirlo` 连贯读出。
- 使用：陌生人、老师和服务人员；亲密朋友间可用更直接形式。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 3.8 `repair.podria-hablar-mas-despacio@1`

- 西语：`¿Podría hablar más despacio?`
- 中文 / 意图：您能说慢一点吗？／对方语速过快时礼貌请求调整。
- 变体：`¿Podría hablar un poco más despacio?`（更委婉；general / formal）；`¿Puede hablar más despacio?`（较直接但仍礼貌；general / neutral-formal）
- 元数据：A1；formal；general
- 语法：`más` 加副词表示程度变化；`podría` 后接 `hablar` 原形。
- 发音：`despacio` 的重音在 pa；`más despacio` 中 s 清楚但不断开。
- 使用：听力跟不上时立即使用；当前 `avoidWhen` 为“技术转写失败不能成为能力负面证据”。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 3.9 `need.cuanto-cuesta-esto@1`

- 西语：`¿Cuánto cuesta esto?`
- 中文 / 意图：这个多少钱？／在购物或服务场景中询问价格。
- 变体：`¿Cuánto vale esto?`（常见价格问法；general / neutral）；`¿Qué precio tiene esta camiseta?`（点名物品；es-ES / neutral）
- 元数据：A1；neutral；general
- 语法：`cuánto` 询问价格或数量；复数物品时 `costar` 用复数。
- 发音：`cuánto` 和 `cuesta` 的 ue 连贯；重读 cuán 和 cues。
- 使用：商店、市场和售票处；远处或已命名物品宜说得更具体。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 3.10 `navigate.creo-que-estoy-perdido@1`

- 西语：`Creo que estoy perdido.`
- 中文 / 意图：我想我迷路了。／说明方向困境，为寻求帮助创造机会。
- 变体：`Creo que me he perdido.`（强调已经找不到路；es-ES / neutral）；`Estoy perdida, ¿me puede ayudar?`（女性说话者并请求帮助；general / neutral-formal）
- 元数据：A2；neutral；general
- 语法：`estar perdido` 表示处于迷路状态；女性说 `perdida`，`creo que` 缓和断言。
- 发音：`creo` 的 e、o 分开清晰发音；`perdido` 重音在 di。
- 使用：向路人或工作人员说明困境；后续地点和路线必须来自可验证来源。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 3.11 `end.sigamos-en-contacto@1`

- 西语：`Sigamos en contacto.`
- 中文 / 意图：我们保持联系。／结束积极交流时表达未来继续联系的意愿。
- 变体：`Mantengamos el contacto.`（同义；general / neutral）；`Espero que sigamos hablando.`（更柔和；general / neutral）
- 元数据：A2；neutral；general
- 语法：`sigamos` 是 `seguir` 的 nosotros 虚拟式；`en contacto` 是固定搭配。
- 发音：`sigamos` 重音在 ga；`contacto` 重音在 tac。
- 使用：结束与新朋友或同事的交流；不能承诺虚构线下见面或不存在的联系方式。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

## 4. 表达审核清单：`alpha.scenario-practice@1`

### 4.1 `restaurant.queria-pedir@1`

- 西语：`Quería pedir el menú del día.`
- 中文 / 意图：我想点今日套餐。／礼貌说明想点什么。
- 变体：`Para mí, el menú del día, por favor.`（简洁自然；es-ES / polite-neutral）；`Voy a tomar la sopa.`（明确选择；general / neutral）
- 元数据：A2；polite-neutral；es-ES
- 语法：未完成过去时 `quería` 可弱化语气，在服务场景中比 `quiero` 委婉。
- 发音：重读 rí、dir、dí；`Quería` 连贯说出，不在 que 后停顿。
- 使用：餐厅礼貌点单；不能理解为只能点固定菜名。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 4.2 `restaurant.lleva@1`

- 西语：`¿Lleva frutos secos?`
- 中文 / 意图：里面有坚果吗？／确认菜品是否含某种配料。
- 变体：`¿Tiene frutos secos?`（通用询问；general / neutral）；`¿Este plato lleva gluten?`（明确当前菜品；general / neutral）
- 元数据：A2；neutral；es-ES
- 语法：`llevar` 可表示菜品含有配料；主语为当前菜品，使用第三人称单数。
- 发音：注意 `lleva` 的 ll 音；问句末尾自然上扬。
- 使用：点餐前确认配料；严重过敏时还应明确说出过敏。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 4.3 `restaurant.soy-alergico@1`

- 西语：`Soy alérgico a los frutos secos.`
- 中文 / 意图：我对坚果过敏。／明确说明过敏信息。
- 变体：`Soy alérgica al marisco.`（女性说话者；general / neutral）；`No puedo comer frutos secos.`（说明不能食用；general / neutral）
- 元数据：A2；neutral；general
- 语法：形容词随说话者性别变化，使用 `alérgico` 或 `alérgica`，并接介词 `a`。
- 发音：重音在 lér；`alérgico` 与 `a` 之间保持连贯。
- 使用：明确健康限制；偏好不是过敏时不要误用。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 4.4 `restaurant.que-recomienda@1`

- 西语：`¿Qué me recomienda?`
- 中文 / 意图：您推荐什么？／在需要替代选择时请求建议。
- 变体：`¿Qué plato me aconseja?`（更明确；general / polite）；`¿Tiene alguna alternativa?`（直接询问替代；general / neutral）
- 元数据：A2；polite；general
- 语法：使用 `usted` 对应的 `recomienda`；`me` 表示建议对象是说话者。
- 发音：重读 qué 和 mien；保持问题节奏紧凑。
- 使用：礼貌询问服务人员；明确知道选择时无需使用。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 4.5 `restaurant.tomare-eso@1`

- 西语：`Entonces, tomaré eso.`
- 中文 / 意图：那我就要这个。／接受替代建议并完成选择。
- 变体：`Perfecto, me quedo con eso.`（口语化接受；es-ES / neutral）；`De acuerdo, pediré eso.`（明确接受；general / neutral）
- 元数据：A2；neutral；general
- 语法：简单将来时表达当下决定；也可以用现在时 `tomo`。
- 发音：重读 ré；`Entonces` 后短暂停顿。
- 使用：接受对方推荐；未确认过敏信息时先不要决定。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 4.6 `campus.vengo-para@1`

- 西语：`Vengo para completar mi matrícula.`
- 中文 / 意图：我是来完成注册手续的。／清楚说明办理目的。
- 变体：`Estoy aquí para terminar la matrícula.`（更直接；general / neutral）；`Necesito completar la matrícula.`（突出需要办理；general / neutral）
- 元数据：A2；polite-neutral；general
- 语法：`venir para + infinitivo` 说明目的，适合在窗口直接说明来意。
- 发音：重读 ven、tar、trí；`para` 不需要过度重读。
- 使用：学校行政窗口；非本人办理时需要补充说明。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 4.7 `campus.que-documentos@1`

- 西语：`¿Qué documentos tengo que presentar?`
- 中文 / 意图：我需要提交哪些文件？／确认所需材料。
- 变体：`¿Qué documentación necesito?`（更简洁正式；es-ES / formal-neutral）；`¿Me puede decir qué documentos hacen falta?`（礼貌请求说明；es-ES / polite）
- 元数据：A2；neutral；general
- 语法：`tener que + infinitivo` 表示需要做某事；疑问词 `qué` 修饰复数 `documentos`。
- 发音：重读 qué、men、tar；`tengo que` 连贯说出。
- 使用：办理前确认清单；不要假设对方已经知道具体事项。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 4.8 `campus.aqui-tiene@1`

- 西语：`Aquí tiene mi pasaporte y el formulario.`
- 中文 / 意图：这是我的护照和表格。／递交并说明已有材料。
- 变体：`Le entrego el pasaporte y el formulario.`（稍正式；general / formal-neutral）；`Traigo estos dos documentos.`（说明带来材料；general / neutral）
- 元数据：A2；polite；general
- 语法：`Aquí tiene` 是递交物品时的礼貌表达，后接所递交文件。
- 发音：重读 quí、tie、por；列举文件时保持自然节奏。
- 使用：递交文件时使用；未实际携带材料时不要这样说。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 4.9 `campus.me-falta@1`

- 西语：`Me falta ese documento.`
- 中文 / 意图：我缺少那份文件。／如实说明材料缺失。
- 变体：`No tengo ese documento ahora mismo.`（目前没有；general / neutral）；`Todavía no tengo la copia.`（尚未准备好；general / neutral）
- 元数据：A2；neutral；general
- 语法：`faltar` 表示某物对我而言缺失；一项用 `falta`，多项用 `faltan`。
- 发音：重读 fal、men；`me falta` 连贯说出。
- 使用：说明当前缺少材料；已经提交时不要误说缺少。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 4.10 `campus.puedo-enviarlo@1`

- 西语：`¿Puedo enviarlo por correo electrónico?`
- 中文 / 意图：我可以通过电子邮件发送吗？／确认补交材料的方式。
- 变体：`¿Se lo puedo mandar por email?`（较口语；es-ES / neutral）；`¿Puedo traerlo mañana?`（询问次日补交；general / neutral）
- 元数据：A2；polite；general
- 语法：`poder + infinitivo` 询问是否可以；`lo` 指代前文的单数文件。
- 发音：重读 pue、viar、tró；`enviarlo` 连续发音。
- 使用：材料缺失后提出补救；不能假设邮件一定被接受。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 4.11 `rental.cuanto-cuesta@1`

- 西语：`¿Cuánto cuesta el alquiler al mes?`
- 中文 / 意图：每月租金是多少？／在虚构练习中确认月租。
- 变体：`¿Cuál es el precio mensual?`（询问每月价格；general / neutral）；`¿Qué precio tiene el alquiler?`（通用价格询问；general / neutral）
- 元数据：A2；neutral；general
- 语法：`cuánto` 询问金额；`al mes` 表示按月计算。
- 发音：重读 cuán、qui、mes；`alquiler` 重音在 ler。
- 使用：确认租金；这是虚构练习，不代表真实房源报价。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 4.12 `rental.gastos-incluidos@1`

- 西语：`¿Están incluidos los gastos?`
- 中文 / 意图：费用包含在内吗？／确认租金是否包含其他费用。
- 变体：`¿El agua está incluida?`（确认具体费用；general / neutral）；`¿Hay que pagar los gastos aparte?`（询问是否另付；es-ES / neutral）
- 元数据：A2；neutral；general
- 语法：`estar incluido` 表示被包含；复数 `gastos` 对应 `están incluidos`。
- 发音：重读 tán、clui、gas；`incluidos` 中的元音保持清楚。
- 使用：确认费用构成；不要把练习回答当作现实合同条款。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 4.13 `rental.cuanto-dura@1`

- 西语：`¿Cuánto dura el contrato?`
- 中文 / 意图：合同期限是多久？／确认合同期限。
- 变体：`¿Cuál es la duración del contrato?`（更正式；general / formal-neutral）；`¿El contrato es de un año?`（确认具体期限；general / neutral）
- 元数据：A2；neutral；general
- 语法：`durar` 表示持续多久；主语 `contrato` 为单数。
- 发音：重读 cuán、du、tra；`contrato` 的 r 保持轻触。
- 使用：确认虚构合同期限；实际签约应以真实书面合同为准。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 4.14 `rental.se-permiten@1`

- 西语：`¿Se permiten mascotas?`
- 中文 / 意图：允许养宠物吗？／确认一项重要居住条件。
- 变体：`¿Puedo vivir con mi gato?`（说明具体宠物；general / neutral）；`¿Aceptan animales?`（较简短；general / neutral）
- 元数据：A2；neutral；general
- 语法：无人称被动 `se` 询问是否允许；复数 `mascotas` 对应 `permiten`。
- 发音：重读 mi、co；当前详情为“`se permits` 之间不要吞音”。
- 使用：确认房屋规定；练习设定不能替代真实房源确认。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 4.15 `rental.otra-hora@1`

- 西语：`¿Podríamos quedar a otra hora?`
- 中文 / 意图：我们可以换个时间吗？／原定时间不可用时协商替代时间。
- 变体：`¿Le viene bien por la tarde?`（提出具体替代时段；es-ES / polite）；`¿Podemos cambiar la hora?`（更直接；general / neutral）
- 元数据：B1；polite；general
- 语法：条件式 `podríamos` 让协商更礼貌；`quedar` 在这里表示约定时间。
- 发音：重读 drí、ho；`podríamos` 的元音分开清晰。
- 使用：在虚构练习中协商；不能把练习约定说成现实预约。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

## 5. 场景审核清单

### 5.1 `scenario.restaurant-ordering@1`

- 名称 / 等级：餐厅沟通：点单与饮食限制；A2
- 设定：`fictional-restaurant-practice`；`service.restaurant`；明确为虚构场景。
- 临时角色：Marina，餐厅服务员；es-ES；友好、简洁，会先回应用户的完整表达。
- 开场：`Buenas, ¿ya sabe qué va a tomar?`（Marina 递来菜单，等你开始点单。）
- 建议轮数：4
- 条件变化：第 2 个用户轮次后触发 `restaurant.sold-out`：`Lo siento, justo se nos ha terminado ese plato.`
- 任务 1：目标 `daily.restaurant.order`；礼貌点一份主菜；意图 `order-a-main-dish`；表达 `restaurant.queria-pedir`；提示依次为“说明你想点什么”→“使用 Quería pedir...”→完整参考句；迁移要求更换主菜、改成更正式关系或使用自然替代表达。
- 任务 2：目标 `daily.restaurant.allergy`；确认配料并说明过敏；意图 `clarify-allergen`；表达 `restaurant.lleva`、`restaurant.soy-alergico`；提示从意图到句块再到完整例句；迁移要求替换过敏原、面向忙碌服务员或自由说明饮食限制。
- 任务 3：目标 `daily.restaurant.alternative`；售完后询问并接受替代；意图 `accept-alternative`；表达 `restaurant.que-recomienda`、`restaurant.tomare-eso`；提示从询问建议到完整参考句；迁移要求处理不符合初始偏好的替代、不同服务人员和自然替代表达。
- 安全/教学边界：必须等用户完整表达后回应；严重过敏信息不能被弱化；自然替代表达可完成任务，不要求匹配唯一参考句。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 5.2 `scenario.campus-administration@1`

- 名称 / 等级：校园办事：注册与材料；A2
- 设定：`fictional-campus-office-practice`；`service.campus`；明确为虚构场景。
- 临时角色：Javier，学校行政人员；es-ES；专业、耐心，只根据练习材料回答。
- 开场：`Buenos días. ¿En qué puedo ayudarle?`（Javier 在行政窗口接待你。）
- 建议轮数：4
- 条件变化：第 2 个用户轮次后触发 `campus.missing-copy`：`Veo que falta una copia del pasaporte.`
- 任务 1：目标 `daily.campus.purpose`；说明完成注册手续；意图 `state-administration-purpose`；表达 `campus.vengo-para`；提示从来意到 `Vengo para...` 再到完整参考句；迁移要求改为领取学生卡、换行政人员或自由说明来意。
- 任务 2：目标 `daily.campus.requirements`；确认并递交材料；意图 `confirm-required-documents`；表达 `campus.que-documentos`、`campus.aqui-tiene`；提示从清单/已有材料到完整例句；迁移要求替换文件、改为电话沟通或自由列举材料。
- 任务 3：目标 `daily.campus.missing-document`；处理缺失材料；意图 `repair-missing-document`；表达 `campus.me-falta`、`campus.puedo-enviarlo`；提示从承认缺失到完整补交询问；迁移要求替换缺失项、面对更严格人员或提出其他可行补交方式。
- 安全/教学边界：角色只能根据练习材料回答，不能把虚构行政要求说成真实学校规则；自然替代表达可完成任务。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

### 5.3 `scenario.rental-conversation@1`

- 名称 / 等级：租房沟通：费用与时间；B1
- 设定：`fictional-rental-practice`；`service.rental`；完全虚构，不代表真实房源或现实预约。
- 临时角色：Elena，虚构房源联系人；es-ES；清楚、克制，绝不把练习房源说成现实存在。
- 开场：`En este ejercicio ficticio, ¿qué le gustaría saber primero?`（Elena 说明这是虚构练习，并请你开始询问。）
- 建议轮数：4
- 条件变化：第 2 个用户轮次后触发 `rental.time-unavailable`：`En este ejercicio, la hora prevista ya no está disponible.`
- 任务 1：目标 `daily.rental.costs`；询问月租和费用；意图 `clarify-rental-costs`，`fictional: true`；表达 `rental.cuanto-cuesta`、`rental.gastos-incluidos`；迁移要求改问水电、改为中介关系或自然确认总成本。
- 任务 2：目标 `daily.rental.conditions`；确认期限和条件；意图 `clarify-rental-conditions`，`fictional: true`；表达 `rental.cuanto-dura`、`rental.se-permiten`；迁移要求替换为访客规定、合租室友关系或其他真实关心的条件。
- 任务 3：目标 `daily.rental.schedule`；重新协商时间；意图 `renegotiate-fictional-viewing`，`fictional: true`；表达 `rental.otra-hora`；迁移要求提出下午/次日、改为电话或自由提出替代时间。
- 安全/教学边界：任何房源、费用、合同、联系人和预约都必须保持虚构；不得暗示现实存在、可验证报价或已完成现实预约。
- 母语审核：☐ approve ☐ revise ☐ reject；意见：
- 教学审核：☐ approve ☐ revise ☐ reject；意见：

## 6. AI 预审重点（不构成人工结论）

以下问题由 AI 预先发现，审核者应独立判断：

1. `rental.se-permiten@1`：发音详情中的 `se permits` 疑似拼写错误，应核对为 `se permiten`，并重新判断整条发音指导。
2. `restaurant.tomare-eso@1`：`Entonces, tomaré eso.` 语法成立，但餐厅口语自然度需母语者判断；比较 `Entonces, tomaré eso.`、`Pues, tomaré eso.`、现在时表达及现有变体。
3. `campus.vengo-para@1`：确认西班牙高校行政语境中 `completar mi matrícula` 是否自然，是否更常用 `formalizar/terminar la matrícula`。
4. `campus.puedo-enviarlo@1`：确认 `por correo electrónico` 与 `por email` 在 es-ES 中的自然度、语域和适用对象。
5. `rental.otra-hora@1`：确认房源/看房沟通中 `quedar a otra hora` 是否自然，是否宜改为 `quedar para otra hora` 或 `ver el piso a otra hora`。
6. `repair.podria-hablar-mas-despacio@1`：当前 `avoidWhen` 是系统评分规则，不是真正的“不适用场景”，中文教学审核应给出合适的使用限制。
7. `navigate.creo-que-estoy-perdido@1`：主表达使用男性形 `perdido`；确认是否应显式呈现 `perdido/a`、性别变体或更中性的替代表达。
8. 多条发音提示使用“重读 ven、tar、trí”等中文简写；教学审核需确认这些切分是否准确、对初学者是否会造成错误音节或重音理解。
9. 三个场景均需确认条件变化在用户完成表达后出现，不会中途纠错或打断，并且成功标准以交际意图为先。

## 7. 审核者总体签字

### 7.1 西班牙语母语审核

- 审核者姓名：
- Reviewer reference（可追踪的内部 ID、工单或签字记录）：
- 母语及地区背景：
- 审核日期（ISO 8601）：
- 审核范围：☐ 26 条表达 ☐ 3 个场景 ☐ 其他（请说明）
- 总体结论：☐ approve ☐ revise ☐ reject
- 未逐项覆盖的内容：
- 总体意见：
- 签名或可验证确认：

### 7.2 中文教学审核

- 审核者姓名：
- Reviewer reference（可追踪的内部 ID、工单或签字记录）：
- 教学背景 / 审核视角：
- 审核日期（ISO 8601）：
- 审核范围：☐ 26 条表达 ☐ 3 个场景 ☐ 其他（请说明）
- 总体结论：☐ approve ☐ revise ☐ reject
- 未逐项覆盖的内容：
- 总体意见：
- 签名或可验证确认：

## 8. 收到反馈后的仓库操作

1. 保存两类审核者的 reviewer reference、日期、逐项结论和意见；不得把本文件的 AI 预审标记为真人签字。
2. 对 `revise` 项逐条修改：文本或教学字段变化时创建新版本，并保留旧版本；只变更审核状态时按内容模型记录状态流转。
3. 按 `draft → language-reviewed → pedagogy-reviewed → published` 顺序推进；任一必需审核未通过时不得跳级或发布。
4. 更新相应 review 记录，审核者引用必须能追溯到真实审核凭据；移除或保留临时 AI review 时必须明确其非人工性质。
5. 对两个 bundle 分别运行 `pnpm content:validate -- <bundle>`；所有内容完整校验通过后，才能在事务中导入，失败时不得部分发布。
6. 若内容已产生学习证据，不得静默覆盖其版本；生产发布前再次核对角色安全、来源许可和用户可见状态。
