export const metadata = { title: "Security · Aco's Employment" };

export default function Security() {
  return (
    <main className="canvas" style={{ maxWidth: 720 }}>
      <p className="kicker">Security</p>
      <h1>What this alpha actually enforces</h1>
      <div className="grid">
        <article className="card"><h2>Session</h2><p>HttpOnly, SameSite=Lax cookie. Work routes redirect to sign-in. Password is the shared alpha secret <span className="mono">demo</span>, not a production identity provider.</p></article>
        <article className="card"><h2>Authority</h2><p>Offers, rejections and disclosure are human-only. The policy route returns prepare_only for offer.send. External boards never go above “you press submit”.</p></article>
        <article className="card"><h2>Consent</h2><p>Compiler hard-filters anyone without a disclosure audience. Kiran stays excluded. Revoke is meant to apply before the next run.</p></article>
        <article className="card"><h2>Not yet</h2><p>Production Postgres, DPDP counsel review, and V1 Supabase auth are not attached. SQL lives in db/sql for a staging apply.</p></article>
      </div>
    </main>
  );
}
