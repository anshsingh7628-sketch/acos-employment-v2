import { compile, COMPILER_VERSION } from "../../../kernel/src/compiler.js";
import { demand, supply, NOW } from "../../../kernel/scenario.js";

export const dynamic = "force-dynamic";

export function GET() {
  const run = compile(demand, supply, { now: NOW });
  const names = Object.fromEntries(supply.map((s) => [s.actorId, s.name]));
  return Response.json({
    demand,
    run,
    names,
    builtAt: new Date().toISOString(),
    scenarioAt: new Date(NOW).toISOString(),
    compilerVersion: COMPILER_VERSION,
    live: true,
  });
}
