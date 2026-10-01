import { evaluate } from "../../../kernel/src/policy.js";

export const dynamic = "force-dynamic";

const NOW = Date.parse("2026-10-15T09:00:00Z");

const GRANT = {
  id: "grant:allocation",
  actions: ["offer.send", "outcome.draft", "application.prepare", "demand.draft", "configuration.recommend"],
  level: 2,
  subjectIds: ["*"],
  expiresAt: NOW + 86_400_000 * 30,
  limits: {},
};

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const action = body.action || "offer.send";
  try {
    const decision = evaluate({
      action,
      actor: { type: "agent", id: "agent:allocation" },
      grant: GRANT,
      tenantCeiling: 5,
      context: body.context || {},
      now: NOW,
    });
    return Response.json({ action, decision, live: true });
  } catch (error) {
    return Response.json({ action, error: String(error.message || error) }, { status: 400 });
  }
}
