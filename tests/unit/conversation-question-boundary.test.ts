import { describe, expect, it, vi } from "vitest";
import { questionPolicyForReply } from "../../src/modules/conversation/domain/reply-plan";
import { buildReplyContext } from "../../src/modules/conversation/application/build-reply-context";
import { streamReply } from "../../src/modules/conversation/application/stream-reply";

describe("explicit current-turn question boundary", () => {
  it.each(["No me hagas preguntas.", "No quiero más preguntas.", "Prefiero que no me preguntes nada.", "别再问我问题。",
    "No me hagas preguntas, solo escucha.", "Prefiero que no me preguntes nada, gracias.",
    "No me hagas más preguntas, gracias.", "Por favor, no me hagas preguntas.",
    "No me hagas preguntas. ¿Qué me recomiendas hacer?"])("takes precedence over normal conversational initiative: %s", (userMessage) => {
    expect(questionPolicyForReply({userMessage})).toEqual({maxSubstantiveQuestions:0,allowReciprocalQuestion:false,maxQuestionPressure:"none"});
  });
  it.each(["¿Cómo se dice «no me hagas preguntas»?", "Traduce no quiero más preguntas.", "No tengo más preguntas.", "No me hagas preguntas sobre mi trabajo.",
    "Sobre mi trabajo, no me hagas preguntas.", "Mi amigo dijo: no me hagas preguntas.", "关于我的工作，不要再问我问题。"])("does not turn a quotation or unrelated statement into a boundary: %s", (userMessage) => {
    expect(questionPolicyForReply({userMessage}).maxQuestionPressure).not.toBe("none");
  });
  it("keeps a separate direct boundary after a translation request", () => {
    expect(questionPolicyForReply({userMessage:'Traduce «buenos días». No me hagas preguntas.'}).maxQuestionPressure).toBe("none");
  });
  it("allows one low-pressure topic question after a substantive greeting", () => {
    expect(questionPolicyForReply({ userMessage: "Hola, soy Álex. Me gusta cocinar." })).toEqual({
      maxSubstantiveQuestions: 1, allowReciprocalQuestion: true, maxQuestionPressure: "low",
    });
    expect(questionPolicyForReply({ userMessage: "Hola, Álex" }).maxSubstantiveQuestions).toBe(0);
    expect(questionPolicyForReply({ userMessage: "Hola, ¿qué haces?" }).maxSubstantiveQuestions).toBe(0);
  });
  it.each(["¿Qué has hecho hoy?", "Qué has hecho hoy?", "¿Y tú?", "Cuéntame qué has hecho hoy."])("rejects a follow-up through the public application without injected policy: %s", async (bad) => {
    const userMessage="No me hagas preguntas.";
    const context=await buildReplyContext({userId:"synthetic-boundary",generationId:"boundary-check",userMessage,now:new Date("2026-10-25T10:00:00Z")});
    const generate=vi.fn().mockResolvedValueOnce({text:bad,provider:"minimax",modelVersion:"fake",providerRequestId:null,latencyMs:0,estimatedCostMicros:null})
      .mockResolvedValueOnce({text:"De acuerdo.",provider:"minimax",modelVersion:"fake",providerRequestId:null,latencyMs:0,estimatedCostMicros:null});
    const events=[];
    for await(const event of streamReply({characterKey:"lucia",characterVersion:context.character.characterVersion,text:userMessage,
      clientMessageId:"boundary-client",generationId:context.generationId,messageId:"boundary-message",replyContext:context,replyProvider:{generate},wait:async()=>{}})) events.push(event);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(events.filter(e=>e.type==="delta").map(e=>e.text).join("")).toBe("De acuerdo.");
    expect(events.at(-1)?.type).toBe("done");
  });
});
