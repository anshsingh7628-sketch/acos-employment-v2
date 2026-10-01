import Link from "next/link";

export default function Home() {
  return (
    <div className="marketing">
      <header className="top">
        <div className="brand"><Mark /> <div>Aco<small>Employment · V2</small></div></div>
        <nav className="row mnav">
          <a href="#system">System</a>
          <a href="#loop">Loop</a>
          <a href="#security">Security</a>
        </nav>
        <div className="spacer" />
        <Link className="ghost" href="/login">Sign in</Link>
        <Link className="primary" href="/login">Enter</Link>
      </header>
      <main>
        <section className="hero">
          <p className="kicker">Aco's Employment · version 2</p>
          <h1>Demand to a <em className="serif">verified</em> outcome.</h1>
          <p className="lede">V1 ended at the application. V2 carries the engagement through work, evidence and what actually happened — so the next match is better than the last.</p>
          <div className="row">
            <Link className="primary" href="/login">Enter the system</Link>
            <a className="ghost" href="#loop">See the loop</a>
          </div>
        </section>
        <section id="system" className="band">
          <div className="grid three">
            <article className="card"><p className="kicker">01</p><h2>Seeker</h2><p>Passport, prepared applications, a board that matches the engagement record. You approve. The agent does not submit for you.</p></article>
            <article className="card"><p className="kicker">02</p><h2>Employer</h2><p>Describe the outcome. The compiler returns configurations, not a keyword pile. Offers stay human.</p></article>
            <article className="card"><p className="kicker">03</p><h2>Institution</h2><p>Roster, consent, cohort map. A student who has not agreed is never shown.</p></article>
          </div>
        </section>
        <section id="loop" className="band">
          <h2>One record. Six stages.</h2>
          <div className="loop" style={{ marginTop: 14 }}>
            {["intent", "demand", "config", "engagement", "work", "outcome"].map((s) => <span key={s} className="on">{s}</span>)}
          </div>
          <p className="lede">Closing a demand closes every open engagement in the same step. Deleting a live demand is refused.</p>
        </section>
        <section id="security" className="band">
          <h2>Policy is code.</h2>
          <p className="lede">Offers, rejections and disclosure are L6. External job sites stay at “you press submit”. A kill switch stops new agent work. Session cookie is HttpOnly.</p>
          <Link className="ghost" href="/security">Security note</Link>
        </section>
      </main>
      <footer className="foot">
        <span>Aco's Employment V2 · alpha on the reference kernel</span>
        <Link href="/privacy">Privacy</Link>
        <Link href="/login">Sign in</Link>
      </footer>
    </div>
  );
}

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#18181B" />
      <path d="M4 18h5v-5h5V8h5V4" fill="none" stroke="#7C9CFF" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
