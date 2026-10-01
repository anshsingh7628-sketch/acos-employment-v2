import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

export function GET() {
  const html = readFileSync(join(process.cwd(), "app/console.html"), "utf8");
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
