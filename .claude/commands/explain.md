---
description: Write an interview-prep explanation of a component so I can defend it in the demo
argument-hint: [component, e.g. gateway-routing | woo-mcp | store-chart | api-keys | chat-agent]
---
Write or update docs/explain/$ARGUMENTS.md for me, the person who must explain this live.

Read the actual code and charts for $ARGUMENTS first. Then cover, briefly and concretely, pointing at `file:line`:
1. What it does and why it exists (two sentences).
2. The request flow step by step, from the caller to the store and back, naming every hop (Ingress, Service, pod, protocol message).
3. The Kubernetes objects involved and what each field that matters does (probes, limits, Secrets, NetworkPolicy, PVC).
4. Failure modes and how the code handles each.
5. Security: what is trusted, what is not, where credentials live and travel.
6. Ten questions an interviewer is likely to ask, each with a short, honest answer. Include "why not X?" alternatives.
7. Anything in the code you think is weak or that I should be ready to defend.

Then quiz me: ask me three of those questions, one at a time, and correct my answers.
