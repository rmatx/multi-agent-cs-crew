/**
 * Dev-only mock stream. Same signature as `startTurn`, same frozen DTO types — the SAD
 * contract-freeze gate requires the mock to IMPORT `StreamEvent`, never restate it.
 * Enable with NEXT_PUBLIC_USE_MOCK_STREAM=1.
 */

import type { ChatRequest, StreamEvent } from "@shared/dto";

const TOKEN_DELAY_MS = 40;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function* mockStartTurn(req: ChatRequest): AsyncIterable<StreamEvent> {
  yield { type: "session", conversationId: req.conversationId ?? "mock-conversation" };

  const orderId = req.identity?.orderId;
  if (orderId === undefined) {
    for (const text of ["I can look that up — ", "what is your order number?"]) {
      await sleep(TOKEN_DELAY_MS);
      yield { type: "token", text };
    }
    yield { type: "done", status: "needs_input" };
    return;
  }

  yield { type: "agent_hop", agentId: "order-specialist", hop: 1 };
  yield { type: "tool_call", agentId: "order-specialist", tool: "get_order" };

  const sentence = `Order ${orderId} is completed. It was placed on 2026-07-30 for $64.36 (1 item).`;
  for (const word of sentence.split(" ")) {
    await sleep(TOKEN_DELAY_MS);
    yield { type: "token", text: `${word} ` };
  }
  yield { type: "done", status: "resolved" };
}
