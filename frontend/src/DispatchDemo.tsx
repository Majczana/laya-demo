import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { errorText, isAbort, postJson } from "./api";
import { ENGINE_NAMES, useEngine, type Engine } from "./engine";
import { useI18n } from "./i18n";
import { fly } from "./flight";
import { PRIORITIES, SLA_MS, abortTriage, arrive, beginTriage, completeTriage, createSim, summarize, tick, type Dept, type Sim, type SimTicket, type TechKind } from "./queueSim";
import type { Priority } from "./queueTickets";

type TriageResponse = {
  priority: string; elapsed_ms: number; priority_review_required: boolean;
  groups: { department: { selected: string | null } };
};

const DEPTS: Dept[] = ["field_service", "remote_support", "customer_service", "contracts", "triage"];
/** Mean time between arriving tickets for the 1–10 slider, in milliseconds. */
const ARRIVAL_STEPS = [7000, 5000, 3600, 2600, 1800, 1200, 800, 550, 380, 250];
const DEFAULT_RATE = 3;
const MAX_FRAME_MS = 100;
const BURST = 12;
const KEY_RATE = "laya-demo:dispatch-rate";

const COPY = {
  pl: {
    heading: "Dyspozytornia zgłoszeń", intro: "Zgłoszenia spływają na własnym zegarze, a model przydziela każdemu priorytet i zespół, jedno po drugim. Wolny model nie nadąża, a błędna decyzja kosztuje: P1 wpadnięty do złej kolejki przekracza czas reakcji, a zgłoszenie u złego zespołu wraca.",
    start: "Start", pause: "Pauza", reset: "Od nowa", burst: `+${BURST} zgłoszeń naraz`, rate: "Napływ", rateNote: (seconds: string) => `średnio co ${seconds} s`,
    inbox: "Skrzynka", inboxEmpty: "Pusto", more: (n: number) => `+${n} więcej`, station: "Model", stationIdle: "Czekam na zgłoszenie", stationBusy: (model: string) => `${model} analizuje…`,
    lanes: "Kolejki priorytetów", techs: "Zespół",
    laneNames: { P1: "Bezpieczeństwo", P2: "Praca zablokowana", P3: "Jest obejście", P4: "Pytanie / informacja" } as Record<Priority, string>,
    depts: { field_service: "Serwis terenowy", remote_support: "Wsparcie zdalne", customer_service: "Obsługa klienta", contracts: "Umowy i rozliczenia", triage: "Ręczna weryfikacja" } as Record<Dept, string>,
    kinds: { field: "Serwisant terenowy", remote: "Wsparcie zdalne", office: "Biuro" } as Record<TechKind, string>,
    idle: "wolny", working: "obsługuje", rework: "zgłoszenie u złego zespołu — przekazuję", done: "zrobione",
    kInbox: "W skrzynce", kInboxNote: (wait: string) => `czekanie na model śr. ${wait}`, kModel: "Czas modelu", kAccuracy: "Trafność modelu", kAccNote: (team: number) => `zespół ${team}%`,
    kP1: "P1 → technik", kP1Note: (breaches: number) => `przekroczone czasy: ${breaches}`, kDone: "Zrobione", kDoneNote: (n: number) => `wróciło do przekierowania: ${n}`,
    sla: "Czas reakcji (demo): P1 ≤ 8 s · P2 ≤ 20 s · P3 ≤ 45 s, liczony od przybycia zgłoszenia do technika.",
    log: "Ostatnie decyzje modelu", expected: "oczekiwano", got: "model", ms: "czas", wait: "w skrzynce", logEmpty: "Uruchom kolejkę, aby zobaczyć decyzje.",
    trend: "Kolejki w czasie", trendInbox: "skrzynka (czeka na model)", trendLanes: "kolejki (czekają na technika)",
    note: "Priorytet i zespół zwraca to samo zapytanie co w demie zgłoszeń. „Oczekiwano” to nasza ocena dla przykładowych zgłoszeń; czasy obsługi i reakcji to symulacja.",
    errorPaused: "Kolejka wstrzymana; wznów, żeby zapytać ponownie.", s: "s", errors: "Nie udało się sklasyfikować zgłoszenia.", tag: "wróciło",
  },
  en: {
    heading: "Ticket dispatch desk", intro: "Tickets arrive on their own clock and the model gives each a priority and a team, one at a time. A slow model falls behind and a wrong call has a price: a P1 filed in the wrong lane misses its response time, and a ticket sent to the wrong team comes back.",
    start: "Start", pause: "Pause", reset: "Start over", burst: `+${BURST} tickets at once`, rate: "Arrivals", rateNote: (seconds: string) => `about every ${seconds} s`,
    inbox: "Inbox", inboxEmpty: "Empty", more: (n: number) => `+${n} more`, station: "Model", stationIdle: "Waiting for a ticket", stationBusy: (model: string) => `${model} is analysing…`,
    lanes: "Priority lanes", techs: "Team",
    laneNames: { P1: "Safety", P2: "Work blocked", P3: "Workaround exists", P4: "Question / information" } as Record<Priority, string>,
    depts: { field_service: "Field service", remote_support: "Remote support", customer_service: "Customer service", contracts: "Contracts and billing", triage: "Manual review" } as Record<Dept, string>,
    kinds: { field: "Field technician", remote: "Remote support", office: "Office" } as Record<TechKind, string>,
    idle: "free", working: "working on", rework: "ticket is with the wrong team — handing it over", done: "done",
    kInbox: "In the inbox", kInboxNote: (wait: string) => `avg wait for the model ${wait}`, kModel: "Model time", kAccuracy: "Model accuracy", kAccNote: (team: number) => `team ${team}%`,
    kP1: "P1 → technician", kP1Note: (breaches: number) => `response times missed: ${breaches}`, kDone: "Done", kDoneNote: (n: number) => `sent back for rerouting: ${n}`,
    sla: "Response time (demo): P1 ≤ 8 s · P2 ≤ 20 s · P3 ≤ 45 s, from the ticket's arrival to a technician taking it.",
    log: "Latest model decisions", expected: "expected", got: "model", ms: "time", wait: "in inbox", logEmpty: "Start the queue to see decisions.",
    trend: "Queues over time", trendInbox: "inbox (waiting for the model)", trendLanes: "lanes (waiting for a technician)",
    note: "Priority and team come from the same request as in the tickets demo. “Expected” is our judgement for the sample tickets; handling and response times are a simulation.",
    errorPaused: "The queue is paused; resume to ask again.", s: "s", errors: "The ticket could not be classified.", tag: "returned",
  },
};

const seconds = (ms: number | null, digits = 1) => (ms === null ? "—" : `${(ms / 1000).toFixed(digits)} s`);

function isPriority(value: string): value is Priority { return (PRIORITIES as string[]).includes(value); }
function asDept(value: string | null): Dept { return DEPTS.includes(value as Dept) ? (value as Dept) : "triage"; }

export function DispatchDemo() {
  const { lang, t } = useI18n();
  const c = COPY[lang];
  const { backend, engine } = useEngine();
  const [rate, setRate] = useState(() => {
    try { const value = Number(window.localStorage.getItem(KEY_RATE)); return Number.isInteger(value) && value >= 1 && value <= 10 ? value : DEFAULT_RATE; } catch { return DEFAULT_RATE; }
  });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sim, setSim] = useState<Sim>(() => createSim({ arrivalMs: ARRIVAL_STEPS[rate - 1] }));
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [flash, setFlash] = useState<{ key: number; text: string } | null>(null);
  const simRef = useRef(sim);
  const runningRef = useRef(false);
  const readyRef = useRef(false);
  const engineRef = useRef<Engine>(engine);
  const langRef = useRef(lang);
  const inFlightRef = useRef(false);
  const generationRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const runEngineRef = useRef<Engine>(engine);
  simRef.current = sim;
  runningRef.current = running;
  readyRef.current = backend.state === "ready";
  engineRef.current = engine;
  langRef.current = lang;

  const reset = useCallback(() => {
    generationRef.current++;
    requestRef.current?.abort();
    requestRef.current = null;
    inFlightRef.current = false;
    setError(null);
    setFlash(null);
    setRunning(false);
    runEngineRef.current = engineRef.current;
    const next = createSim({ arrivalMs: ARRIVAL_STEPS[rate - 1] });
    simRef.current = next;
    setSim(next);
  }, [rate]);

  /** Take the oldest ticket and ask the model. One request at a time; the clock keeps running meanwhile. */
  const drive = useCallback(async () => {
    if (inFlightRef.current) return;
    const current = simRef.current;
    if (current.inbox.length === 0 || current.triaging) return;
    const first = stageRef.current?.querySelector<HTMLElement>("[data-inbox-first]")?.getBoundingClientRect();
    const started = beginTriage(current);
    if (!started) return;
    inFlightRef.current = true;
    const generation = generationRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    const label = started.ticket.id;
    const station = stageRef.current?.querySelector<HTMLElement>("[data-station]")?.getBoundingClientRect();
    if (first && station) void fly(first, station, label, 420);
    try {
      const data = await postJson<TriageResponse>("/tickets/triage", { ticket: started.ticket.text[langRef.current], lang: langRef.current, engine: engineRef.current }, controller.signal);
      if (generation !== generationRef.current) return;
      const priority = isPriority(data.priority) ? data.priority : "P4";
      const department = asDept(data.groups.department.selected);
      const from = stageRef.current?.querySelector<HTMLElement>("[data-station]")?.getBoundingClientRect();
      completeTriage(current, started.key, { priority, department, modelMs: data.elapsed_ms, review: data.priority_review_required });
      setFlash({ key: started.key, text: `${label} → ${priority}` });
      window.setTimeout(() => setFlash((value) => (value?.key === started.key ? null : value)), 1200);
      window.requestAnimationFrame(() => {
        const to = stageRef.current?.querySelector<HTMLElement>(`[data-lane="${priority}"]`)?.getBoundingClientRect();
        if (from && to) void fly(from, to, label, 550);
      });
    } catch (reason) {
      if (generation === generationRef.current && !isAbort(reason)) {
        abortTriage(current, started.key);
        setError(reason);
        setRunning(false);
      }
    } finally {
      if (generation === generationRef.current) {
        requestRef.current = null;
        inFlightRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let drawn = -1;
    let drawnSim: Sim | null = null;
    let lastPaint = 0;
    const loop = (now: number) => {
      const current = simRef.current;
      const dt = Math.min(now - last, MAX_FRAME_MS);
      last = now;
      if (runningRef.current && readyRef.current) {
        tick(current, dt);
        void drive();
      }
      // Redraw when something moved, and a few times a second for timers and progress bars.
      if (current !== drawnSim || current.version !== drawn || now - lastPaint > 200) {
        drawnSim = current;
        drawn = current.version;
        lastPaint = now;
        redraw();
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [drive]);

  useEffect(() => {
    try { window.localStorage.setItem(KEY_RATE, String(rate)); } catch { /* the setting still works */ }
    sim.settings.arrivalMs = ARRIVAL_STEPS[rate - 1];
  }, [rate, sim]);

  // One run is played by one model: switching it starts over.
  useEffect(() => {
    if (runEngineRef.current !== engine) reset();
  }, [engine, reset]);

  useEffect(() => () => {
    generationRef.current++;
    requestRef.current?.abort();
  }, []);

  const summary = summarize(sim);
  const clock = sim.clock;
  const modelName = ENGINE_NAMES[runEngineRef.current];
  const triagingFor = sim.triaging ? clock - (sim.triaging.triageStartedAt ?? clock) : 0;
  const ok = (a: unknown, b: unknown) => (a === b ? "✓" : "✕");
  const tileTone = (value: number | null) => (value === null ? "" : value >= 0.8 ? "good" : value >= 0.5 ? "warn" : "bad");
  const priorityAccuracy = summary.triaged ? summary.priorityHits / summary.triaged : null;
  const teamAccuracy = summary.triaged ? summary.departmentHits / summary.triaged : null;
  const overdue = (ticket: SimTicket) => {
    const limit = SLA_MS[ticket.ticket.priority];
    return limit !== null && ticket.assignedAt === null && clock - ticket.arrivedAt > limit;
  };
  const history = sim.history;
  const chartMax = Math.max(4, ...history.map((point) => Math.max(point.inbox, point.waiting)));
  const points = (pick: (point: (typeof history)[number]) => number) => history.map((point, index) => `${(index / Math.max(1, history.length - 1)) * 300},${58 - (pick(point) / chartMax) * 54}`).join(" ");

  return <main className="ticket-page dispatch-page">
    <div className="injection-heading"><p className="eyebrow">11 / DISPATCH</p><h1>{c.heading}</h1><p className="muted">{c.intro}</p></div>

    <section className="dz-kpis dq-kpis" aria-label="KPI">
      <div className="dz-kpi"><small>{c.kInbox}</small><b className={summary.inbox > 6 ? "bad" : ""}>{summary.inbox}</b><em>{c.kInboxNote(seconds(summary.avgInboxWaitMs))}</em>
        <div className="dz-spark">{history.slice(-24).map((point, index) => <i key={index} className={point.inbox > 6 ? "miss" : ""} style={{ height: `${Math.max(8, (point.inbox / chartMax) * 100)}%` }} />)}</div></div>
      <div className="dz-kpi"><small>{c.kModel}</small><b>{summary.avgModelMs === null ? "—" : `${Math.round(summary.avgModelMs)} ms`}</b><em>{modelName}</em></div>
      <div className="dz-kpi"><small>{c.kAccuracy}</small><b className={tileTone(priorityAccuracy)}>{priorityAccuracy === null ? "—" : `${Math.round(priorityAccuracy * 100)}%`}</b><em>{c.kAccNote(teamAccuracy === null ? 0 : Math.round(teamAccuracy * 100))}</em></div>
      <div className="dz-kpi"><small>{c.kP1}</small><b>{seconds(summary.p1AssignMs)}</b><em className={summary.breaches ? "bad" : ""}>{c.kP1Note(summary.breaches)}</em></div>
      <div className="dz-kpi"><small>{c.kDone}</small><b>{summary.done}</b><em>{c.kDoneNote(summary.reroutes)}</em></div>
    </section>

    <div className="dz-controls">
      <button type="button" className="injection-primary" disabled={backend.state !== "ready"} onClick={() => { setError(null); setRunning((value) => !value); }}>{running ? `⏸ ${c.pause}` : `▶ ${c.start}`}</button>
      <button type="button" className="dz-btn" disabled={backend.state !== "ready"} onClick={() => { arrive(sim, BURST); redraw(); }}>{c.burst}</button>
      <button type="button" className="dz-btn" onClick={reset}>↺ {c.reset}</button>
      <label className="dq-rate"><span>{c.rate} <b className="num">{rate}/10</b> · {c.rateNote((ARRIVAL_STEPS[rate - 1] / 1000).toFixed(1))}</span>
        <input type="range" min="1" max="10" step="1" value={rate} onChange={(event) => setRate(Number(event.target.value))} /></label>
      {error !== null && <span className="error">{errorText(error, t, c.errors)} {c.errorPaused}</span>}
    </div>

    <div className="dq-stage" ref={stageRef}>
      <section className="dq-col dq-inbox">
        <h2>{c.inbox} · {summary.inbox}</h2>
        <div className="dq-cards">
          {sim.inbox.length === 0 && <p className="muted small">{c.inboxEmpty}</p>}
          {sim.inbox.slice(0, 6).map((ticket, index) => <div key={ticket.key} className="dq-card" {...(index === 0 ? { "data-inbox-first": "" } : {})}>
            <strong>{ticket.ticket.id}</strong><span>{ticket.ticket.text[lang]}</span><em className="num">{seconds(clock - ticket.arrivedAt, 0)}</em>
          </div>)}
          {sim.inbox.length > 6 && <p className="dq-more">{c.more(sim.inbox.length - 6)}</p>}
        </div>
      </section>

      <section className="dq-col dq-station-col">
        <h2>{c.station}</h2>
        <div className={`dq-station ${sim.triaging ? "busy" : ""}`} data-station>
          <i className="tl" /><i className="tr" /><i className="bl" /><i className="br" />
          {sim.triaging ? <div className="dq-current"><strong>{sim.triaging.ticket.id}</strong><p>{sim.triaging.ticket.text[lang]}</p><span className="dz-beam" /></div> : <p className="muted small dq-idle">{c.stationIdle}</p>}
          {flash && <div className="dz-stamp auto dq-flash">{flash.text}</div>}
        </div>
        <div className="dz-clock"><b className={sim.triaging ? "live" : ""}>{sim.triaging ? `${Math.round(triagingFor)} ms` : "—"}</b><small>{sim.triaging ? c.stationBusy(modelName) : c.stationIdle}</small></div>
      </section>

      <section className="dq-col dq-lanes">
        <h2>{c.lanes}</h2>
        {PRIORITIES.map((priority) => <div key={priority} className={`dq-lane p${priority.slice(1)}`} data-lane={priority}>
          <header><b>{priority}</b><span>{c.laneNames[priority]}</span><em className="num">{sim.lanes[priority].length}</em></header>
          <div className="dq-chips">{sim.lanes[priority].map((ticket) => <span key={ticket.key} className={`dq-chip ${ticket.ticket.priority === ticket.priority ? "hit" : "miss"}${overdue(ticket) ? " late" : ""}`} title={`${ticket.ticket.id} · ${ticket.ticket.text[lang]}`}>
            {ticket.ticket.id}<small>{c.depts[ticket.route ?? "triage"].split(" ")[0]}</small>{ticket.reroutes > 0 && <i>{c.tag}</i>}</span>)}</div>
        </div>)}
        <p className="small muted">{c.sla}</p>
      </section>

      <section className="dq-col dq-techs">
        <h2>{c.techs}</h2>
        {sim.techs.map((tech) => <div key={tech.id} className={`dq-tech ${tech.ticket ? "on" : ""}${tech.rework ? " rework" : ""}`}>
          <header><strong>{c.kinds[tech.kind]}</strong><span className="num">{tech.done} {c.done}</span></header>
          {tech.ticket ? <><p className="small">{tech.rework ? c.rework : `${c.working} ${tech.ticket.ticket.id}`}</p><span className="dq-progress"><span style={{ width: `${(1 - tech.left / Math.max(1, tech.total)) * 100}%` }} /></span></> : <p className="small muted">{c.idle}</p>}
        </div>)}
      </section>
    </div>

    <div className="dq-bottom">
      <section className="injection-panel"><h2>{c.log}</h2>
        {sim.log.length === 0 ? <p className="muted small">{c.logEmpty}</p> : <ol className="dq-log">{sim.log.slice(0, 10).map((ticket) => <li key={ticket.key} className={ticket.priority === ticket.ticket.priority && ticket.department === ticket.ticket.department ? "hit" : "miss"}>
          <strong>{ticket.ticket.id}</strong><span className="dq-log-text">{ticket.ticket.text[lang]}</span>
          <span><small>{c.expected}</small>{ticket.ticket.priority} · {c.depts[ticket.ticket.department]}</span>
          <span><small>{c.got}</small>{ticket.priority} {ok(ticket.priority, ticket.ticket.priority)} · {c.depts[ticket.department ?? "triage"]} {ok(ticket.department, ticket.ticket.department)}</span>
          <span className="num"><small>{c.ms}</small>{Math.round(ticket.modelMs ?? 0)} ms<small>{c.wait} {seconds(ticket.triageStartedAt! - ticket.arrivedAt)}</small></span>
        </li>)}</ol>}
        <p className="small muted">{c.note}</p>
      </section>
      <section className="injection-panel"><h2>{c.trend}</h2>
        <svg className="dq-chart" viewBox="0 0 300 62" preserveAspectRatio="none" role="img" aria-label={c.trend}>
          <polyline className="inbox" points={points((point) => point.inbox)} /><polyline className="lanes" points={points((point) => point.waiting)} />
        </svg>
        <p className="small"><span className="dq-key inbox" /> {c.trendInbox} · <span className="dq-key lanes" /> {c.trendLanes}</p>
      </section>
    </div>
  </main>;
}
