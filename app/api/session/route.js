import { cookies } from "next/headers";

const ACCOUNTS = {
  "priya@aco.dev": { role: "seeker", name: "Priya Sharma", org: "Seeker · Bengaluru" },
  "meera@aco.dev": { role: "employer", name: "Meera Iyer", org: "Kesar Foods" },
  "kavita@aco.dev": { role: "institution", name: "Dr. Kavita Rao", org: "RVCE placement" },
};

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const account = ACCOUNTS[email];
  if (!account || password !== "demo") {
    return Response.json({ ok: false, error: "Unknown email or password." }, { status: 401 });
  }
  const jar = await cookies();
  jar.set("aco_session", encodeURIComponent(JSON.stringify({ email, ...account })), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  return Response.json({ ok: true, account: { email, ...account } });
}

export async function GET() {
  const jar = await cookies();
  const raw = jar.get("aco_session")?.value;
  if (!raw) return Response.json({ ok: false }, { status: 401 });
  try {
    return Response.json({ ok: true, account: JSON.parse(decodeURIComponent(raw)) });
  } catch {
    return Response.json({ ok: false }, { status: 401 });
  }
}

export async function DELETE() {
  const jar = await cookies();
  jar.set("aco_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return Response.json({ ok: true });
}
