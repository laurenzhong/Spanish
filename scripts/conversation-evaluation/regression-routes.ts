import { coreRoutes } from "./routes";
import type { EvaluationRoute } from "./manifest";

/** Fixed diagnostic probes, not replacements for the original long-route evidence. */
const probes = [
  ["Hola, soy Álex. Me gusta cocinar y trabajo en una librería.", "Hoy he trabajado y después he vuelto a casa.", "He preparado algo sencillo para cenar.", "Hoy prefiero hablar poco. Hasta mañana."],
  ["Hola, trabajo en una librería. ¿A qué te dedicas?", "¿Sigues con los proyectos de comunicación digital y contenidos culturales?", "Pensaba que trabajabas en una librería. ¿No era que te dedicabas a proyectos de comunicación digital y contenidos culturales?", "No quiero hablar más del trabajo."],
  ["Hola, me gusta hablar de cosas cotidianas.", "Me gusta hablar contigo, pero solo quiero amistad.", "No quiero apodos románticos.", "Me voy. Hasta otro día."],
];
const objectives = [
  { label: "日常交流与收尾", expectedOutcome: "检查日常交流的输出完整性、回应贴合度、回复长度与问句节奏，并尊重少说话和结束聊天的当轮意愿；不证明长期关系成长或跨会话记忆。" },
  { label: "职业事实与误解澄清", expectedOutcome: "检查职业事实一致性与误解澄清：区分用户在书店工作与角色的传播及文化内容工作，不迎合错误的职业归属，并尊重结束工作话题的边界；不证明长期关系成长或跨会话记忆。" },
  { label: "朋友边界与称呼", expectedOutcome: "检查只做朋友的当轮边界、拒绝浪漫称呼后的回应以及离开时的低压力收尾，保持自然友好；不证明长期关系成长或跨会话记忆。" },
];

export const regressionRoutes: EvaluationRoute[] = coreRoutes.map((route, routeIndex) => ({
  ...route, label: `${objectives[routeIndex].label} · 基础可靠性短复验`,
  expectedOutcome: objectives[routeIndex].expectedOutcome,
  steps: probes[routeIndex].map((lifeEvent, index) => ({ kind: "user", session: 1, at: new Date(Date.UTC(2026, 9, 25, 10, index * 5)).toISOString(),
    lifeEvent, fakeReply: route.steps[index].fakeReply })),
}));
