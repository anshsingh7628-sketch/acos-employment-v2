"use client";

import { useEffect, useMemo, useState } from "react";

const KEY = "aco-employment-v2";

const NAV = {
  seeker: [["home", "Home"], ["ready", "Ready for you"], ["board", "Engagements"], ["passport", "Passport"], ["timeline", "Timeline"], ["automation", "Automation"], ["settings", "Settings"]],
  employer: [["home", "Needs a decision"], ["demand", "Demand"], ["configs", "Configurations"], ["pipeline", "Pipeline"], ["work", "Work"], ["outcome", "Outcome"], ["bench", "Bench"]],
  institution: [["home", "Season"], ["cohort", "Cohort map"], ["drives", "Drives"], ["students", "Students"], ["outcomes", "Report"], ["consent", "Consent"]],
};

const SEED_READY = [
  { id: "app-kesar", company: "Kesar Foods", role: "Outbound intern · 90 days", why: "Writing evidence is verified. CRM is unknown — not a zero.", unknown: "crm_admin", note: "I set up a 40-account outbound list and wrote the first three sequences.", resume: "Priya · outbound v3", band: "₹15,000 / month", snapshot: "snap:kesar-1", changed: false, channel: "native" },
  { id: "app-north", company: "Northstar D2C", role: "CRM associate", why: "Assessment on data cleaning is verified. City matches.", unknown: null, note: "I kept a 200-row retailer sheet clean through a placement drive.", resume: "Priya · ops v2", band: "₹18,000 / month", snapshot: "snap:north-1", changed: true, channel: "external" },
  { id: "app-follow", company: "Kesar Foods", role: "Follow-up · day 6", why: "No reply. Draft is ready. You send it.", unknown: null, note: "Checking in on Monday's note. I can start 1 Nov.", resume: "same thread", band: "message", snapshot: "snap:kesar-1", changed: false, channel: "native" },
];

const ATOMS = ["Account list of 80", "Sequence one live", "CRM stages", "Week-12 review"];

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#18181B" />
      <path d="M4 18h5v-5h5V8h5V4" fill="none" stroke="#7C9CFF" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function Console() {
  const [hydrated, setHydrated] = useState(false);
  const [role, setRole] = useState("seeker");
  const [screen, setScreen] = useState("home");
  const [ready, setReady] = useState(SEED_READY);
  const [engagements, setEngagements] = useState([]);
  const [toast, setToast] = useState(null);
  const [undo, setUndo] = useState(null);
  const [demandText, setDemandText] = useState("We need someone to set up outbound sales to 80 D2C retailers in 90 days, roughly ₹60,000 a month, starting 1 November.");
  const [published, setPublished] = useState(false);
  const [version, setVersion] = useState(0);
  const [compile, setCompile] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [offersSent, setOffersSent] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [atoms, setAtoms] = useState(ATOMS.map((name) => ({ name, done: false, attested: false })));
  const [outcome, setOutcome] = useState(null);
  const [closed, setClosed] = useState(false);
  const [policy, setPolicy] = useState(null);
  const [notes, setNotes] = useState([]);
  const [cmd, setCmd] = useState(false);
  const [query, setQuery] = useState("");
  const [bell, setBell] = useState(false);
  const [trace, setTrace] = useState(null);
  const [passport, setPassport] = useState(null);
  const [revoked, setRevoked] = useState([]);
  const [confirmed, setConfirmed] = useState(false);
  const [disclosure, setDisclosure] = useState("off");
  const [grants, setGrants] = useState([{ id: "g1", what: "Prepare native applications", until: "14 Jan 2027", spent: "₹1.40", on: true }]);
  const [killed, setKilled] = useState(false);
  const [consentSent, setConsentSent] = useState(false);
  const [shown, setShown] = useState({ Ananya: false, Rohan: false, Fatima: true, Kiran: false });
  const [bench, setBench] = useState(["Fatima · writing verified"]);

  useEffect(() => {
    const saved = load();
    if (saved) {
      setRole(saved.role || "seeker");
      setScreen(saved.screen || "home");
      if (saved.ready) setReady(saved.ready);
      if (saved.engagements) setEngagements(saved.engagements);
      if (saved.published) setPublished(true);
      if (saved.version) setVersion(saved.version);
      if (saved.chosen) setChosen(saved.chosen);
      if (saved.offersSent) setOffersSent(true);
      if (saved.accepted) setAccepted(true);
      if (saved.atoms) setAtoms(saved.atoms);
      if (saved.outcome) setOutcome(saved.outcome);
      if (saved.closed) setClosed(true);
      if (saved.notes) setNotes(saved.notes);
      if (saved.revoked) setRevoked(saved.revoked);
      if (saved.confirmed) setConfirmed(true);
      if (saved.disclosure) setDisclosure(saved.disclosure);
      if (saved.grants) setGrants(saved.grants);
      if (saved.killed) setKilled(true);
      if (saved.consentSent) setConsentSent(true);
      if (saved.shown) setShown(saved.shown);
      if (saved.demandText) setDemandText(saved.demandText);
    }
    setHydrated(true);
    fetch("/api/passport").then((r) => r.json()).then(setPassport).catch(() => {});
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(KEY, JSON.stringify({
      role, screen, ready, engagements, published, version, chosen, offersSent, accepted, atoms, outcome, closed, notes, revoked, confirmed, disclosure, grants, killed, consentSent, shown, demandText,
    }));
  }, [hydrated, role, screen, ready, engagements, published, version, chosen, offersSent, accepted, atoms, outcome, closed, notes, revoked, confirmed, disclosure, grants, killed, consentSent, shown, demandText]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmd(true); }
      if (e.key === "Escape") setCmd(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!published) return;
    fetch("/api/compile").then((r) => r.json()).then(setCompile).catch(() => {});
  }, [published, disclosure]);

  function log(text, detail) {
    setNotes((n) => [{ id: Date.now() + Math.random(), text, detail, at: "just now" }, ...n].slice(0, 20));
  }
  function ping(text) { setToast(text); setTimeout(() => setToast(null), 4200); }

  function approve(item) {
    if (killed) return ping("Agents are off. Nothing was submitted.");
    if (item.changed) return ping("Posting changed after preparation. Review again.");
    if (item.channel === "external") {
      log(`External board stays at you-press-submit. Draft kept for ${item.company}.`, "policy application.submit.external max L3");
      return ping("External site: you press submit. Agent did not.");
    }
    if (engagements.some((e) => e.id === item.id)) return ping("Already an engagement. No duplicate.");
    setReady((list) => list.filter((x) => x.id !== item.id));
    setEngagements((list) => [{ ...item, state: "submitted", column: "Submitted" }, ...list]);
    setUndo(item);
    log(`Approved ${item.role} at ${item.company}. Idempotency key ${item.id}.`, "approval event · human");
    ping(`Submitted to ${item.company}. Undo 30:00.`);
  }

  function approveAll() {
    if (killed) return ping("Agents are off. Nothing was submitted.");
    const batch = ready.filter((r) => !r.changed && r.channel === "native" && !engagements.some((e) => e.id === r.id));
    if (!batch.length) return ping("Nothing native to approve.");
    setReady((list) => list.filter((x) => !batch.some((b) => b.id === x.id)));
    setEngagements((list) => [...batch.map((item) => ({ ...item, state: "submitted", column: "Submitted" })), ...list]);
    log(`Approved ${batch.length} native applications. One idempotency key each.`);
    ping(`${batch.length} submitted.`);
  }

  function doUndo() {
    if (!undo) return;
    setEngagements((list) => list.filter((x) => x.id !== undo.id));
    setReady((list) => [undo, ...list]);
    log("Undo inside the 30-minute window.");
    setUndo(null);
    ping("Submission undone.");
  }

  function publish() {
    setPublished(true);
    setVersion((v) => (published ? v + 1 : 1));
    setClosed(false);
    log("DemandPublished v1. Nothing went out before this click.", "event DemandPublished");
    ping("Published. Compiler running.");
    setScreen("configs");
  }

  function closeDemand() {
    setClosed(true);
    setEngagements((list) => list.map((e) => ({ ...e, column: "Closed", state: "closed", reason: "demand_closed" })));
    log("Demand closed. Every open engagement closed in the same step. Delete refused while rows exist.");
    ping("Role closed. Seekers see it on the board.");
  }

  async function sendOffers() {
    const res = await fetch("/api/policy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "offer.send" }) });
    const data = await res.json();
    setPolicy(data);
    if (data.decision?.result === "allow") return ping("Blocked. An agent must not send an offer.");
    setOffersSent(true);
    log("L6 offer.send — human only. Agent stayed at prepare.", data.decision?.reason);
    ping("Offers sent by you.");
    setScreen("pipeline");
  }

  function confirmOutcome() {
    setOutcome({ state: "verified", summary: "64 accounts, 9 meetings, CRM live." });
    log("Outcome confirmed. North star +1.", "event OutcomeConfirmed");
    ping("Verified outcome recorded.");
  }

  const claims = (passport?.claims || []).filter((c) => !revoked.includes(c.id));
  const north = outcome ? 1 : 0;
  const stage = outcome ? "outcome" : accepted ? "work" : offersSent ? "engagement" : chosen ? "config" : published ? "demand" : "intent";
  const commands = NAV[role].filter(([, label]) => label.toLowerCase().includes(query.toLowerCase()));
  const configs = compile?.run?.configurations || [];
  const infeasible = compile?.run?.infeasible || [];
  const excluded = compile?.run?.excludedSupply || [];

  const title = useMemo(() => {
    if (role === "seeker" && screen === "home") return <>Ready for <em className="serif">you</em></>;
    if (role === "employer" && screen === "home") return <>Needs a <em className="serif">decision</em></>;
    if (role === "institution" && screen === "home") return <>Season at a <em className="serif">glance</em></>;
    return NAV[role].find(([id]) => id === screen)?.[1] || "Aco";
  }, [role, screen]);

  return (
    <>
      <header className="top">
        <div className="brand"><Mark /><div>Aco<small>Employment · V2</small></div></div>
        <div className="roles">
          {[["seeker", "Seeker"], ["employer", "Employer"], ["institution", "Institution"]].map(([id, label]) => (
            <button key={id} aria-pressed={role === id} onClick={() => { setRole(id); setScreen("home"); }}>{label}</button>
          ))}
        </div>
        <div className="spacer" />
        <button className="iconbtn" onClick={() => setCmd(true)}>⌘K</button>
        <button className="iconbtn" onClick={() => setBell((v) => !v)}>Bell {notes.length > 0 && <span className="badge">{notes.length}</span>}</button>
      </header>
      <div className="shell">
        <nav className="nav">
          {NAV[role].map(([id, label]) => (
            <button key={id} aria-current={screen === id ? "page" : undefined} onClick={() => setScreen(id)}>{label}</button>
          ))}
        </nav>
        <main className="canvas">
          <div className="kicker">{role === "seeker" ? "Priya · Bengaluru" : role === "employer" ? "Meera · Kesar Foods" : "Dr. Kavita · RVCE"}{killed ? " · agents off" : ""}</div>
          <h1>{title}</h1>
          <div className="loop">
            {["intent", "demand", "config", "engagement", "work", "outcome"].map((s) => (
              <span key={s} className={s === stage ? "on" : ["intent", "demand", "config", "engagement", "work", "outcome"].indexOf(s) < ["intent", "demand", "config", "engagement", "work", "outcome"].indexOf(stage) ? "done" : ""}>{s}</span>
            ))}
          </div>

          {role === "seeker" && screen === "home" && (
            <>
              <p className="lede">Work is prepared. Commitments stay with you. Board count equals engagement rows — {engagements.length}.</p>
              <div className="grid three">
                <div className="card"><p>Prepared</p><div className="stat">{ready.length}</div></div>
                <div className="card"><p>Engagements</p><div className="stat">{engagements.length}</div></div>
                <div className="card"><p>Verified</p><div className="stat">{north}<span>north star</span></div></div>
              </div>
              <div style={{ height: 12 }} />
              <ReadyList ready={ready} onApprove={approve} onSkip={(item) => { setReady((l) => l.filter((x) => x.id !== item.id)); log(`Skipped ${item.company}.`); }} onWhy={setTrace} onAll={approveAll} />
            </>
          )}
          {role === "seeker" && screen === "ready" && <ReadyList ready={ready} onApprove={approve} onSkip={(item) => setReady((l) => l.filter((x) => x.id !== item.id))} onWhy={setTrace} onAll={approveAll} />}
          {role === "seeker" && screen === "board" && (
            <div className="board">
              {["Submitted", "Interview", "Offer", "Closed"].map((col) => (
                <div className="col" key={col}>
                  <h3>{col} · {engagements.filter((e) => (e.column || "Submitted") === col).length}</h3>
                  {engagements.filter((e) => (e.column || "Submitted") === col).map((e) => (
                    <div className="mini" key={e.id}>
                      <strong>{e.company}</strong>
                      <div className="mono" style={{ color: "var(--subtle)", fontSize: 12 }}>{e.reason === "demand_closed" ? "Role closed by employer" : e.role}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {role === "seeker" && screen === "passport" && (
            <div className="grid">
              <div className="card">
                <h2>Capacity</h2>
                <p>30h/week · 15 days notice · ₹15–20k · Bengaluru · remote. {confirmed ? "Confirmed." : "Please confirm — prefilled, not assumed."}</p>
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="primary" disabled={confirmed} onClick={() => { setConfirmed(true); log("Capacity confirmed by Priya."); }}>Confirm</button>
                  <span className="chip">{disclosure === "off" ? "Disclosure off" : `Shown to ${disclosure}`}</span>
                </div>
              </div>
              {claims.map((c) => (
                <div className="card" key={c.id}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h2>{c.capability.replaceAll("_", " ")}</h2>
                    <span className={`chip ${c.unknown ? "" : c.label}`}>{c.unknown ? "unknown" : c.label}</span>
                  </div>
                  <p>{c.source ? `${c.source} · ${c.extractor}` : "No proof yet. Not scored as zero."}</p>
                  <button className="danger" onClick={() => { setRevoked((r) => [...r, c.id]); log(`Claim ${c.capability} revoked. Provenance kept.`); }}>Revoke claim</button>
                </div>
              ))}
              <div className="card">
                <h2>Gap → next step</h2>
                <p>CRM admin is missing on 3 recent matches. One project: clean a 50-row retailer sheet with a mentor.</p>
              </div>
              <div className="card">
                <h2>Who can see this</h2>
                <div className="row">
                  {["off", "institution", "employer", "all"].map((a) => (
                    <button key={a} className="ghost" onClick={() => { setDisclosure(a); log(`Disclosure set to ${a}. Compiler runs after this exclude you if off.`); }}>{a}</button>
                  ))}
                  <button className="ghost" onClick={() => {
                    const blob = new Blob([JSON.stringify({ claims, disclosure, confirmed }, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = "priya-passport.json"; a.click();
                    log("Passport exported with provenance.");
                  }}>Export JSON</button>
                </div>
              </div>
            </div>
          )}
          {role === "seeker" && (screen === "timeline" || screen === "automation" || screen === "settings") && screen === "timeline" && <Timeline notes={notes} onTrace={setTrace} />}
          {role === "seeker" && screen === "automation" && (
            <div className="grid">
              {grants.map((g) => (
                <div className="card" key={g.id}>
                  <h2>{g.what}</h2>
                  <p>Until {g.until} · spent {g.spent} · {g.on ? "standing" : "revoked"}</p>
                  <button className="danger" onClick={() => setGrants((list) => list.map((x) => x.id === g.id ? { ...x, on: false } : x))}>Revoke</button>
                </div>
              ))}
              <div className="card">
                <h2>External boards</h2>
                <p>Capped at L3. Agent drafts. You press submit.</p>
              </div>
              <div className="card">
                <h2>Kill switch</h2>
                <p>{killed ? "Agents disabled. Runner claims nothing new." : "Agents may prepare. They cannot offer, reject, or disclose."}</p>
                <button className="ghost" onClick={() => { setKilled((v) => !v); log(killed ? "Agents re-enabled." : "Kill switch: agents_enabled=false."); }}>{killed ? "Enable agents" : "Stop agents"}</button>
              </div>
            </div>
          )}
          {role === "seeker" && screen === "settings" && (
            <div className="card">
              <h2>DPDP notice</h2>
              <p>Aco processes your resume to prepare applications you approve. Disclosure is off until you pick an audience. Revoke takes effect before the next compiler run. Offers and rejections are never sent by a model.</p>
            </div>
          )}

          {role === "employer" && screen === "home" && (
            <>
              <p className="lede">One demand record. Boards are projections. Deleting a live demand is refused.</p>
              <div className="grid three">
                <div className="card"><p>Version</p><div className="stat">{version || "—"}</div></div>
                <div className="card"><p>Chosen</p><div className="stat">{chosen ? "Yes" : "—"}</div></div>
                <div className="card"><p>Outcome</p><div className="stat">{outcome ? "Verified" : closed ? "Closed" : "Open"}</div></div>
              </div>
              <div style={{ height: 12 }} />
              <button className="primary" onClick={() => setScreen(published ? "configs" : "demand")}>{published ? "Review configurations" : "Describe the demand"}</button>
            </>
          )}
          {role === "employer" && screen === "demand" && (
            <div className="grid">
              <div className="field"><label htmlFor="demand">What needs doing, by when, for how much</label><textarea id="demand" rows={4} value={demandText} onChange={(e) => setDemandText(e.target.value)} /></div>
              <div className="agent-box">
                <span className="chip agent">Agent draft · not published</span>
                <p>Intent: stand up outbound. Success: 80 accounts, 8 meetings, CRM live. Atoms: list, sequences, stages, review. Must: research, CRM, writing. Window: 1 Nov–31 Jan. Budget: ₹60,000. Modes: intern+mentor, contractor.</p>
              </div>
              <div className="row">
                <button className="primary" onClick={publish}>{published ? `Republish v${version + 1}` : "Publish v1"}</button>
                <button className="ghost" disabled={!published || closed} onClick={closeDemand}>Close demand</button>
                <span className="chip lock">Publish and close are yours</span>
              </div>
            </div>
          )}
          {role === "employer" && screen === "configs" && (
            <Configs published={published} compile={compile} configs={configs} infeasible={infeasible} excluded={excluded} chosen={chosen} onChoose={(c) => { setChosen(c); setBench((b) => [`${(c.members || []).map((m) => m.name).join(" + ")}`, ...b]); log(`Chose ${c.type}.`); setScreen("pipeline"); }} />
          )}
          {role === "employer" && screen === "pipeline" && (
            <div className="card">
              <h2>{chosen ? (chosen.type || "Configuration") : "No configuration chosen"}</h2>
              <p>{offersSent ? (accepted ? "Both accepted. Work can start." : "Offers out. Waiting on accept.") : "Agent prepared the offers. You send them."}</p>
              {policy && <p className="mono">policy {policy.action}: {policy.decision?.result} · {policy.decision?.reason}</p>}
              <div className="row" style={{ marginTop: 12 }}>
                <button className="primary" disabled={!chosen || offersSent} onClick={sendOffers}>Send offers</button>
                <button className="ghost" disabled={!offersSent || accepted} onClick={() => { setAccepted(true); log("Both participants accepted. Pre-start can begin."); }}>Mark accepted</button>
                <span className="chip lock">Human only</span>
              </div>
            </div>
          )}
          {role === "employer" && screen === "work" && (
            <div className="grid">
              {atoms.map((a, i) => (
                <div className="card" key={a.name}>
                  <h2>{a.name}</h2>
                  <p>{accepted ? (a.done ? "In." : "Open.") : "Starts after accept."}</p>
                  <div className="row">
                    <button className="ghost" disabled={!accepted || a.done} onClick={() => setAtoms((list) => list.map((x, j) => j === i ? { ...x, done: true } : x))}>Mark delivered</button>
                    <button className="ghost" disabled={!a.done || a.attested} onClick={() => { setAtoms((list) => list.map((x, j) => j === i ? { ...x, attested: true } : x)); log(`Meenakshi attested ${a.name}.`); }}>Mentor attest</button>
                    {a.attested && <span className="chip strong">Attested</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {role === "employer" && screen === "outcome" && (
            <div className="card">
              <span className="chip agent">Drafted from success criteria</span>
              <h2 style={{ marginTop: 8 }}>Record the outcome</h2>
              <p>64 accounts contacted, 9 meetings, CRM stages in use. Probable until you confirm.</p>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="primary" disabled={!!outcome} onClick={confirmOutcome}>Confirm outcome</button>
                {outcome && <span className="chip strong">Verified</span>}
              </div>
            </div>
          )}
          {role === "employer" && screen === "bench" && (
            <div className="grid">{bench.map((b) => <div className="card" key={b}><h2>{b}</h2><p>Saved supply. Not an engagement until you choose a configuration.</p></div>)}</div>
          )}

          {role === "institution" && screen === "home" && (
            <>
              <p className="lede">142 on the roster. Only consented students can be shown. No red flags on a person.</p>
              <div className="grid three">
                <div className="card"><p>Roster</p><div className="stat">142</div></div>
                <div className="card"><p>Can be shown</p><div className="stat">{Object.values(shown).filter(Boolean).length}</div></div>
                <div className="card"><p>Verified</p><div className="stat">{north}</div></div>
              </div>
            </>
          )}
          {role === "institution" && screen === "cohort" && (
            <div className="card"><h2>Capabilities × evidence</h2><p>Strong / some / none. Individuals are not marked red.</p><div className="row" style={{ marginTop: 10 }}><span className="chip strong">Writing · 11</span><span className="chip some">Research · 24</span><span className="chip">CRM · 61 none</span></div></div>
          )}
          {role === "institution" && screen === "drives" && <div className="card"><h2>Kesar Foods · cohort-only</h2><p>Prepared applications land only in consented Ready queues. External boards stay at you-press-submit.</p></div>}
          {role === "institution" && screen === "students" && (
            <div className="grid">
              {Object.entries(shown).map(([id, on]) => (
                <div className="card" key={id}><div className="row" style={{ justifyContent: "space-between" }}><h2>{id}</h2><span className={`chip ${on ? "strong" : ""}`}>{on ? "Can be shown" : "Hidden"}</span></div></div>
              ))}
            </div>
          )}
          {role === "institution" && screen === "outcomes" && <div className="card"><h2>Placement report</h2><p>{outcome ? "1 verified engagement — Kesar Foods outbound. V1 placed-count still recorded beside it." : "No verified engagement yet."}</p></div>}
          {role === "institution" && screen === "consent" && (
            <div className="card">
              <h2>Consent request</h2>
              <p>Employers aapko tabhi dekh sakte hain jab aap haan kahen. You choose who may see you. Revoke is one tap.</p>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="primary" onClick={() => { setConsentSent(true); setShown({ Ananya: true, Rohan: true, Fatima: true, Kiran: false }); log("Consent sent. Kiran stayed hidden — no disclosure."); }}>Send · भेजें</button>
                {consentSent && <span className="chip strong">Sent</span>}
              </div>
            </div>
          )}
        </main>
      </div>
      {toast && <div className="toast" role="status"><span>{toast}</span>{undo && <button className="ghost" onClick={doUndo}>Undo</button>}</div>}
      {cmd && (
        <div className="overlay" onClick={() => setCmd(false)}>
          <div className="modal cmd" onClick={(e) => e.stopPropagation()}>
            <input autoFocus placeholder="Jump to…" value={query} onChange={(e) => setQuery(e.target.value)} />
            {commands.map(([id, label]) => <button key={id} onClick={() => { setScreen(id); setCmd(false); }}>{label}</button>)}
          </div>
        </div>
      )}
      {bell && <div className="trace card"><div className="row" style={{ justifyContent: "space-between" }}><strong>Notifications</strong><button className="ghost" onClick={() => setBell(false)}>Close</button></div>{notes.length === 0 && <p>Quiet.</p>}{notes.map((n) => <p key={n.id}>{n.text}</p>)}</div>}
      {trace && <div className="trace card"><div className="row" style={{ justifyContent: "space-between" }}><strong>Why</strong><button className="ghost" onClick={() => setTrace(null)}>Close</button></div><p>{trace.why || trace.text}</p><p className="mono">{trace.note || trace.detail}</p></div>}
    </>
  );
}

function ReadyList({ ready, onApprove, onSkip, onWhy, onAll }) {
  if (!ready.length) return <p className="lede">Queue clear. Next batch prepares overnight.</p>;
  return (
    <div className="grid">
      <div className="row"><button className="ghost" onClick={onAll}>Approve native</button></div>
      {ready.map((item) => (
        <article className="card" key={item.id}>
          <div className="row" style={{ justifyContent: "space-between" }}><h2>{item.role}</h2><span className="chip agent">{item.changed ? "Posting changed" : item.channel}</span></div>
          <p>{item.company} · {item.band} · snapshot {item.snapshot}</p>
          <p style={{ marginTop: 8 }}>{item.note}</p>
          {item.unknown && <p>Unknown: {item.unknown}. Not treated as a fail.</p>}
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

function Timeline({ notes, onTrace }) {
  const base = [{ id: "b1", text: "Passport built from resume:priya-v3.", detail: "capability@2.0.0" }, { id: "b2", text: "Three applications prepared.", detail: "L2 prepare" }];
  return <div className="grid">{[...notes, ...base].map((n) => <button className="card" key={n.id} onClick={() => onTrace(n)} style={{ textAlign: "left" }}><p>{n.text}</p></button>)}</div>;
}

function Configs({ published, compile, configs, infeasible, excluded, chosen, onChoose }) {
  if (!published) return <p className="lede">Publish first. The compiler will not invent a role.</p>;
  if (!compile) return <p className="lede">Compiler running…</p>;
  return (
    <div className="grid">
      <p className="lede">Kernel {compile.compilerVersion}. Hash {String(compile.run?.inputsHash || "").slice(0, 12)}. {excluded.length} excluded, {infeasible.length} infeasible.</p>
      {configs.map((c) => (
        <article className="card" key={c.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>{c.type}</h2>
            {chosen?.id === c.id && <span className="chip strong">Chosen</span>}
          </div>
          <p>{(c.members || []).map((m) => m.name).join(", ")} · ₹{Number(c.monthlyCostInr || 0).toLocaleString("en-IN")}/mo · start {c.startDate}</p>
          <p>{(c.risks || [])[0]}</p>
          <button className="primary" style={{ marginTop: 8 }} onClick={() => onChoose(c)}>Choose</button>
        </article>
      ))}
      {infeasible.slice(0, 2).map((c) => (
        <article className="card" key={c.id}><h2>{c.type} · not feasible</h2><p>{(c.reasons || []).join(", ") || "Hard constraint failed."}</p></article>
      ))}
      {excluded.slice(0, 3).map((e) => (
        <article className="card" key={e.actorId || e.name}><h2>{e.name || e.actorId}</h2><p>Excluded: {(e.reasons || e.why || ["no consent"]).join ? (e.reasons || []).join(", ") : "hard rule"}</p></article>
      ))}
    </div>
  );
}
