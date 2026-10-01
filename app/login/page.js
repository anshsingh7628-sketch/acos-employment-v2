"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const DEMOS = [
  ["priya@aco.dev", "Seeker · Priya"],
  ["meera@aco.dev", "Employer · Meera"],
  ["kavita@aco.dev", "Institution · Kavita"],
];

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("priya@aco.dev");
  const [password, setPassword] = useState("demo");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error || "Could not sign in.");
    router.push("/work");
    router.refresh();
  }

  return (
    <div className="auth">
      <form className="card authcard" onSubmit={submit}>
        <p className="kicker">Aco's Employment</p>
        <h1>Sign in</h1>
        <p className="lede">Alpha desk. Three roles, one session. Password for every demo account is <span className="mono">demo</span>.</p>
        <label className="field">Email<input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
        <label className="field">Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <button className="primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <div className="row" style={{ marginTop: 12 }}>
          {DEMOS.map(([value, label]) => (
            <button type="button" className="ghost" key={value} onClick={() => setEmail(value)}>{label}</button>
          ))}
        </div>
        <p className="lede" style={{ marginTop: 16 }}>LinkedIn sign-in is on V1. It is not wired here — no fake OAuth.</p>
        <Link href="/">Back</Link>
      </form>
    </div>
  );
}
