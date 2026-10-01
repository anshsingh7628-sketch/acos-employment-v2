"use client";

import { useEffect, useMemo, useState } from "react";

const NAV = {
  seeker: [
    ["home", "Home"],
    ["ready", "Ready for you"],
    ["board", "Engagements"],
    ["passport", "Passport"],
    ["timeline", "Timeline"],
    ["automation", "Automation"],
  ],
  employer: [
    ["home", "Needs a decision"],
    ["demand", "Demand"],
    ["configs", "Configurations"],
    ["pipeline", "Pipeline"],
    ["work", "Work"],
    ["outcome", "Outcome"],
  ],
  institution: [
    ["home", "Season"],
    ["cohort", "Cohort map"],
    ["drives", "Drives"],
    ["students", "Students"],
    ["outcomes", "Report"],
    ["consent", "Consent"],
  ],
};

const SEED_READY = [
  {
    id: "app-kesar",
    company: "Kesar Foods",
    role: "Outbound intern · 90 days",
    why: "Writing evidence is verified. CRM is thin — mentor covers it.",
    note: "I set up a 40-account outbound list for a campus fest sponsor and wrote the first three sequences. Happy to do the same for your D2C retailers.",
    resume: "Priya · outbound v3",
    band: "₹15,000 / month",
    state: "prepared",
  },
  {
    id: "app-north",
    company: "Northstar D2C",
    role: "CRM associate",
    why: "HubSpot credential is verified. City matches Bengaluru.",
    note: "I have kept a 200-row retailer sheet clean through a placement drive. I can own the CRM hygiene for the first quarter.",
    resume: "Priya · ops v2",
    band: "₹18,000 / month",
    state: "prepared",
  },
  {
    id: "app-follow",
    company: "Kesar Foods",
    role: "Follow-up · day 6",
    why: "No reply yet. Draft is ready. You send it.",
    note: "Checking in on the outbound intern note from Monday. I can start 1 Nov and share a week-1 account list.",
    resume: "same thread",
    band: "message",
    state: "prepared",
  },
];

const PASSPORT = [
  ["B2B outreach writing", "strong", "Work artifact · verified"],
  ["Market research", "some", "Claim + one practice note"],
  ["CRM admin", "thin", "No proof yet — mentor can cover"],
  ["Data cleaning", "some", "Assessment · verified"],
];

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#18181B" />
      <path d="M4 18h5v-5h5V8h5V4" fill="none" stroke="#7C9CFF" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export default function Console() {
  const [role, setRole] = useState("seeker");
  const [screen, setScreen] = useState("home");
  const [ready, setReady] = useState(SEED_READY);
  const [engagements, setEngagements] = useState([]);
  const [toast, setToast] = useState(null);
  const [undo, setUndo] = useState(null);
  const [demandText, setDemandText] = useState(
    "We need someone to set up outbound sales to 80 D2C retailers in 90 days, roughly ₹60,000 a month, starting 1 November. Remote is fine if they are in Bengaluru most weeks."
  );
  const [published, setPublished] = useState(false);
  const [compile, setCompile] = useState(null);
  const [compileError, setCompileError] = useState("");
  const [chosen, setChosen] = useState(null);
  const [offersSent, setOffersSent] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [notes, setNotes] = useState([]);
  const [cmd, setCmd] = useState(false);
  const [query, setQuery] = useState("");
  const [bell, setBell] = useState(false);
  const [consentSent, setConsentSent] = useState(false);
  const [shown, setShown] = useState({ ananya: false, rohan: false, fatima: true, kiran: false });
  const [trace, setTrace] = useState(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmd(true);
      }
      if (e.key === "Escape") setCmd(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!published) return;
    let cancel = false;
    fetch("/api/compile")
      .then((r) => r.json())
      .then((data) => {
        if (!cancel) setCompile(data);
      })
      .catch((err) => {
        if (!cancel) setCompileError(String(err.message || err));
      });
    return () => {
      cancel = true;
    };
  }, [published]);

  function switchRole(next) {
    setRole(next);
    setScreen("home");
  }

  function log(text) {
    setNotes((n) => [{ id: Date.now(), text, at: "just now" }, ...n].slice(0, 12));
  }

  function approve(item) {
    setReady((list) => list.filter((x) => x.id !== item.id));
    setEngagements((list) => [{ ...item, state: "submitted", column: "Submitted" }, ...list]);
    setUndo(item);
    setToast(`Submitted to ${item.company}. Undo for 30:00.`);
    log(`You approved ${item.role} at ${item.company}. Agent cannot submit without you.`);
    setTimeout(() => setToast(null), 5000);
  }

  function doUndo() {
    if (!undo) return;
    setEngagements((list) => list.filter((x) => x.id !== undo.id));
    setReady((list) => [undo, ...list]);
    setToast("Submission undone.");
    log("Undo: submission withdrawn inside the window.");
    setUndo(null);
  }

  function skip(item) {
    setReady((list) => list.filter((x) => x.id !== item.id));
    log(`Skipped ${item.company}. It will not be retried this week.`);
  }

  async function askPolicy(action) {
    const res = await fetch("/api/policy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    setPolicy(data);
    return data;
  }

  async function sendOffers() {
    const data = await askPolicy("offer.send");
    if (data.decision?.result === "allow") {
      setToast("Policy unexpectedly allowed an agent to send. Blocked anyway.");
      return;
    }
    setOffersSent(true);
    setToast("Offers sent by you. Agent stayed at prepare.");
    log("L6 offer.send — human only. Both cohort offers went out.");
    setScreen("pipeline");
  }

  function confirmOutcome() {
    setOutcome({
      state: "verified",
      summary: "Outbound motion stood up. 64 accounts contacted, 9 meetings, CRM live.",
    });
    log("Outcome confirmed. North star moves: one verified engagement.");
    setToast("Verified outcome recorded.");
  }

  const consented = Object.values(shown).filter(Boolean).length;
  const northStar = outcome ? 1 : 0;
  const commands = NAV[role].filter(([, label]) => label.toLowerCase().includes(query.toLowerCase()));

  const configs = compile?.run?.feasible || compile?.run?.results || compile?.run?.configurations || [];
  const configList = Array.isArray(configs) ? configs : [];

  const title = useMemo(() => {
    if (role === "seeker" && screen === "home") return <>Ready for <em className="serif">you</em></>;
    if (role === "employer" && screen === "home") return <>Needs a <em className="serif">decision</em></>;
    if (role === "institution" && screen === "home") return <>Season at a <em className="serif">glance</em></>;
    const hit = NAV[role].find(([id]) => id === screen);
    return hit ? hit[1] : "Aco";
  }, [role, screen]);

  return (
    <>
      <header className="top">
        <div className="brand">
          <Mark />
          <div>
            Aco
            <small>Employment · V2</small>
          </div>
        </div>
        <div className="roles" role="tablist" aria-label="Role">
          {[
            ["seeker", "Seeker"],
            ["employer", "Employer"],
            ["institution", "Institution"],
          ].map(([id, label]) => (
            <button key={id} aria-pressed={role === id} onClick={() => switchRole(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <button className="iconbtn" onClick={() => setCmd(true)} aria-label="Command bar">
          ⌘K
        </button>
        <button className="iconbtn" onClick={() => setBell((v) => !v)} aria-label="Notifications">
          Bell {notes.length > 0 && <span className="badge">{notes.length}</span>}
        </button>
      </header>

      <div className="shell">
        <nav className="nav" aria-label="Sections">
          {NAV[role].map(([id, label]) => (
            <button key={id} aria-current={screen === id ? "page" : undefined} onClick={() => setScreen(id)}>
              {label}
            </button>
          ))}
        </nav>
        <main className="canvas">
          <div className="kicker">
            {role === "seeker" && "Priya · Bengaluru · autopilot on"}
            {role === "employer" && "Meera · Kesar Foods"}
            {role === "institution" && "Dr. Kavita · RVCE placement"}
          </div>
          <h1>{title}</h1>

          {role === "seeker" && screen === "home" && (
            <>
              <p className="lede">The work is already done. You keep the commitments — approve, edit, or skip.</p>
              <div className="grid three">
                <div className="card"><p>Prepared</p><div className="stat">{ready.length}</div></div>
                <div className="card"><p>In motion</p><div className="stat">{engagements.length}</div></div>
                <div className="card"><p>Verified outcomes</p><div className="stat">{northStar}<span>north star</span></div></div>
              </div>
              <div style={{ height: 14 }} />
              <ReadyList ready={ready} onApprove={approve} onSkip={skip} onWhy={setTrace} />
            </>
          )}

          {role === "seeker" && screen === "ready" && (
            <ReadyList ready={ready} onApprove={approve} onSkip={skip} onWhy={setTrace} />
          )}

          {role === "seeker" && screen === "board" && (
            <div className="board">
              {["Submitted", "Interview", "Offer", "Active"].map((col) => (
                <div className="col" key={col}>
                  <h3>{col}</h3>
                  {engagements.filter((e) => (e.column || "Submitted") === col).map((e) => (
                    <div className="mini" key={e.id}>
                      <strong>{e.company}</strong>
                      <div className="mono" style={{ color: "var(--subtle)", fontSize: 12 }}>{e.role}</div>
                    </div>
                  ))}
                  {col === "Submitted" && engagements.length === 0 && <p style={{ color: "var(--subtle)" }}>Nothing submitted yet.</p>}
                </div>
              ))}
            </div>
          )}

          {role === "seeker" && screen === "passport" && (
            <div className="grid">
              {PASSPORT.map(([name, level, detail]) => (
                <div className="card" key={name}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h2>{name}</h2>
                    <span className={`chip ${level}`}>{level}</span>
                  </div>
                  <p>{detail}</p>
                </div>
              ))}
              <p className="lede">Unknown is grey, never red. A missing proof is not a failure.</p>
            </div>
          )}

          {role === "seeker" && screen === "timeline" && <Timeline notes={notes} />}
          {role === "seeker" && screen === "automation" && <Automation />}

          {role === "employer" && screen === "home" && (
            <>
              <p className="lede">One demand. Configurations come from the compiler, not a keyword search.</p>
              <div className="grid three">
                <div className="card"><p>Demand</p><div className="stat">{published ? "Live" : "Draft"}</div></div>
                <div className="card"><p>Chosen</p><div className="stat">{chosen ? "Yes" : "—"}</div></div>
                <div className="card"><p>Outcome</p><div className="stat">{outcome ? "Verified" : "Open"}</div></div>
              </div>
              <div style={{ height: 14 }} />
              <button className="primary" onClick={() => setScreen(published ? "configs" : "demand")}>
                {published ? "Review configurations" : "Describe the demand"}
              </button>
            </>
          )}

          {role === "employer" && screen === "demand" && (
            <div className="grid">
              <label className="kicker" htmlFor="demand">Tell us what you need done, by when, for roughly how much.</label>
              <textarea id="demand" rows={5} value={demandText} onChange={(e) => setDemandText(e.target.value)} />
              <div className="agent-box">
                <span className="chip agent">Agent draft</span>
                <p>Work atoms: account list, three sequences, CRM stages, week-12 review. Budget held at ₹60,000. Start 1 Nov.</p>
              </div>
              <div className="row">
                <button className="primary" onClick={() => { setPublished(true); log("Demand published by Meera. Compiler running."); setScreen("configs"); }}>
                  Publish
                </button>
                <span className="chip lock">Publish is yours · L3</span>
              </div>
            </div>
          )}

          {role === "employer" && screen === "configs" && (
            <Configs
              published={published}
              compile={compile}
              error={compileError}
              configList={configList}
              chosen={chosen}
              onChoose={(c) => { setChosen(c); log(`Chose ${c.label || c.type || "configuration"}.`); setScreen("pipeline"); }}
            />
          )}

          {role === "employer" && screen === "pipeline" && (
            <div className="grid">
              <div className="card">
                <h2>{chosen ? (chosen.label || chosen.type) : "No configuration chosen"}</h2>
                <p>{offersSent ? "Offers sent. Waiting on accept." : "Offers are L6. The agent prepared them. You send."}</p>
                {policy && (
                  <p className="mono" style={{ marginTop: 8 }}>
                    policy {policy.action}: {policy.decision?.result} · {policy.decision?.reason}
                  </p>
                )}
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="primary" disabled={!chosen || offersSent} onClick={sendOffers}>Send offers</button>
                  <span className="chip lock">Human only</span>
                </div>
              </div>
            </div>
          )}

          {role === "employer" && screen === "work" && (
            <div className="grid">
              {["Account list of 80", "Sequence one live", "CRM stages", "Mentor attestation"].map((item, i) => (
                <div className="card" key={item}>
                  <h2>{item}</h2>
                  <p>{offersSent ? (i < 2 ? "Deliverable in" : "Waiting") : "Starts after both accept."}</p>
                </div>
              ))}
            </div>
          )}

          {role === "employer" && screen === "outcome" && (
            <div className="card">
              <span className="chip agent">Drafted from success criteria</span>
              <h2 style={{ marginTop: 8 }}>Record the outcome</h2>
              <p>64 accounts contacted, 9 meetings booked, CRM stages in use. Confidence: probable until you confirm.</p>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="primary" onClick={confirmOutcome} disabled={!!outcome}>Confirm outcome</button>
                {outcome && <span className="chip strong">Verified</span>}
              </div>
            </div>
          )}

          {role === "institution" && screen === "home" && (
            <>
              <p className="lede">142 on the roster. Only consented students can be shown. Red flags never sit on a person.</p>
              <div className="grid three">
                <div className="card"><p>Roster</p><div className="stat">142</div></div>
                <div className="card"><p>Consented</p><div className="stat">{38 + (consentSent ? consented : 0) - 1}</div></div>
                <div className="card"><p>Live demand</p><div className="stat">{published ? 1 : 0}</div></div>
              </div>
            </>
          )}

          {role === "institution" && screen === "cohort" && (
            <div className="card">
              <h2>Capabilities × evidence</h2>
              <p>Columns are strong / some / none. Individuals are not marked red.</p>
              <div className="grid three" style={{ marginTop: 12 }}>
                <div><span className="chip strong">Writing · 11 strong</span></div>
                <div><span className="chip some">Research · 24 some</span></div>
                <div><span className="chip">CRM · 61 none</span></div>
              </div>
            </div>
          )}

          {role === "institution" && screen === "drives" && (
            <div className="card">
              <h2>Kesar Foods · cohort-only drive</h2>
              <p>Prepared applications land in consented students' Ready queues. External boards stay at "you press submit".</p>
            </div>
          )}

          {role === "institution" && screen === "students" && (
            <div className="grid">
              {Object.entries(shown).map(([id, on]) => (
                <div className="card" key={id}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h2 style={{ textTransform: "capitalize" }}>{id}</h2>
                    <span className={`chip ${on ? "strong" : ""}`}>{on ? "Can be shown" : "Not consented"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {role === "institution" && screen === "outcomes" && (
            <div className="card">
              <h2>Placement report</h2>
              <p>{outcome ? "1 verified engagement this season — Kesar Foods outbound." : "No verified engagement yet. Placed-count stays in the V1 vocabulary until an outcome is confirmed."}</p>
            </div>
          )}

          {role === "institution" && screen === "consent" && (
            <div className="grid">
              <div className="card">
                <h2>Plain-language request</h2>
                <p>Hindi + English. Students choose who may see them. Revocation is one tap and takes effect before the next match.</p>
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="primary" onClick={() => { setConsentSent(true); setShown({ ananya: true, rohan: true, fatima: true, kiran: false }); log("Consent requests sent. Kiran stayed hidden."); }}>
                    Send consent request
                  </button>
                  {consentSent && <span className="chip strong">Sent</span>}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          {undo && <button className="ghost" onClick={doUndo}>Undo</button>}
        </div>
      )}

      {cmd && (
        <div className="overlay" onClick={() => setCmd(false)}>
          <div className="modal cmd" onClick={(e) => e.stopPropagation()}>
            <input autoFocus placeholder="Jump to…" value={query} onChange={(e) => setQuery(e.target.value)} />
            {commands.map(([id, label]) => (
              <button key={id} onClick={() => { setScreen(id); setCmd(false); }}>{label}</button>
            ))}
          </div>
        </div>
      )}

      {bell && (
        <div className="trace card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Notifications</strong>
            <button className="ghost" onClick={() => setBell(false)}>Close</button>
          </div>
          {notes.length === 0 && <p>Quiet. Agents will not ping you for work they already did.</p>}
          {notes.map((n) => <p key={n.id}>{n.text}</p>)}
        </div>
      )}

      {trace && (
        <div className="trace card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Why this</strong>
            <button className="ghost" onClick={() => setTrace(null)}>Close</button>
          </div>
          <p>{trace.why}</p>
          <p className="mono">{trace.note}</p>
        </div>
      )}
    </>
  );
}

function ReadyList({ ready, onApprove, onSkip, onWhy }) {
  if (ready.length === 0) return <p className="lede">Queue clear. Autopilot will prepare the next batch overnight.</p>;
  return (
    <div className="grid">
      {ready.map((item) => (
        <article className="card" key={item.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>{item.role}</h2>
            <span className="chip agent">Prepared</span>
          </div>
          <p>{item.company} · {item.band}</p>
          <p style={{ marginTop: 8 }}>{item.note}</p>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={() => onApprove(item)}>Approve</button>
            <button className="ghost" onClick={() => onWhy(item)}>Why</button>
            <button className="danger" onClick={() => onSkip(item)}>Skip</button>
          </div>
        </article>
      ))}
    </div>
  );
}

function Timeline({ notes }) {
  const base = [
    { id: "b1", text: "Passport claim added: B2B outreach writing." },
    { id: "b2", text: "Three applications prepared overnight." },
  ];
  return (
    <div className="grid">
      {[...notes, ...base].map((n) => (
        <div className="card" key={n.id}><p>{n.text}</p></div>
      ))}
    </div>
  );
}

function Automation() {
  return (
    <div className="grid">
      <div className="card"><h2>Prepare applications</h2><p>On. You still approve each submit. Undo window: 30 minutes.</p></div>
      <div className="card"><h2>External job sites</h2><p>Capped. Agent drafts. You press submit. Their terms stay intact.</p></div>
      <div className="card"><h2>Offers, rejects, disclosure</h2><p>Locked. A model never sends these.</p></div>
    </div>
  );
}

function Configs({ published, compile, error, configList, chosen, onChoose }) {
  if (!published) return <p className="lede">Publish the demand first. The compiler will not invent a role.</p>;
  if (error) return <p>Compiler unavailable: {error}</p>;
  if (!compile) return <p className="lede">Compiler running on the Kesar Foods proof loop…</p>;
  const rows = configList.length ? configList : compile.run?.pareto || [];
  const list = Array.isArray(rows) && rows.length ? rows : fallback(compile);
  return (
    <div className="grid">
      <p className="lede">
        Live kernel {compile.compilerVersion}. Inputs hash {String(compile.run?.inputsHash || "").slice(0, 12)}.
        Kiran is excluded — no consent.
      </p>
      {list.map((c, i) => (
        <article className="card" key={c.id || c.type || i}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>{c.label || titleFor(c)}</h2>
          {chosen && (chosen.id || chosen.type) === (c.id || c.type) && <span className="chip strong">Chosen</span>}
        </div>
        <p>{describe(c)}</p>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={() => onChoose(c)}>Choose</button>
            <span className="chip lock">You choose · agent recommends</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function titleFor(c) {
  const names = { intern_cohort: "Intern + mentor", with_mentor: "Owner + mentor", single: "Single owner", split: "Split", contractor: "Contractor" };
  return names[c.type] || c.type || "Configuration";
}

function describe(c) {
  if (c.summary) return c.summary;
  const people = (c.members || []).map((m) => m.name).join(", ");
  const cost = c.monthlyCostInr ? `₹${Number(c.monthlyCostInr).toLocaleString("en-IN")}/mo` : "";
  const risk = (c.risks || [])[0];
  return [people, cost, c.startDate && `start ${c.startDate}`, risk].filter(Boolean).join(" · ") || "Feasible configuration from the reference kernel.";
}

function fallback(compile) {
  const excluded = compile.run?.excluded?.length ?? 0;
  return [
    { id: "intern", type: "intern_cohort", label: "Intern + mentor", summary: `Cohort pair with Meenakshi supervising. ${excluded} people excluded by hard rules.` },
    { id: "single", type: "single", label: "Single owner", summary: "One person covering every must-have. Shown only if the kernel marks it feasible." },
  ];
}
