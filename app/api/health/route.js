import { COMPILER_VERSION } from "../../../kernel/src/compiler.js";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ok: true,
    product: "Aco's Employment",
    compiler: COMPILER_VERSION,
    roles: ["seeker", "recruiter", "institution"],
  });
}
