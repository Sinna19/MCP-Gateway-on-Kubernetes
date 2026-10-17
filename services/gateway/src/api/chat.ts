import { Router } from "express";
import { z } from "zod";
import type { ChatAgent } from "../chat/agent.js";
import { ChatError } from "../chat/errors.js";
import { currentUser, requireUser } from "./middleware.js";

const toolCall = z.strictObject({
  id: z.string().max(200),
  type: z.literal("function"),
  function: z.strictObject({ name: z.string().max(200), arguments: z.string().max(20_000) }),
});

// No "system" role: the server adds its own system prompt, the client cannot.
const message = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("user"), content: z.string() }),
  z.strictObject({ role: z.literal("assistant"), content: z.string().nullable(), tool_calls: z.array(toolCall).max(20).optional() }),
  z.strictObject({ role: z.literal("tool"), tool_call_id: z.string().max(200), content: z.string() }),
]);

const body = z.strictObject({
  messages: z.array(message).min(1).max(100),
  confirm: z.strictObject({ id: z.uuid(), approve: z.boolean() }).optional(),
});

// agent is null when the LLM is not configured: the route still exists and says so.
export function chatRoutes(agent: ChatAgent | null): Router {
  const router = Router();

  router.post("/chat", requireUser, async (req, res, next) => {
    if (!agent) {
      res.status(503).json({ error: "chat not configured" });
      return;
    }
    const started = performance.now();
    const user = currentUser(res);
    const log = (status: number, steps: number, tools: string[], pending: boolean) =>
      // Never the prompt, the messages, the key or any header: counts and tool names only.
      console.log(`chat: user=${user.id} status=${status} steps=${steps} tools=${tools.join(",") || "-"} pending=${pending} ms=${Math.round(performance.now() - started)}`);
    try {
      const { messages, confirm } = body.parse(req.body);
      const result = await agent.run({ user, messages, confirm });
      log(200, result.steps, result.toolCalls.map((c) => c.tool.slice(0, 100)), result.pendingToolCall !== undefined);
      res.json({ reply: result.reply, messages: result.messages, toolCalls: result.toolCalls, pendingToolCall: result.pendingToolCall });
    } catch (err) {
      if (err instanceof ChatError) {
        log(err.status, 0, [], false);
        res.status(err.status).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  return router;
}
