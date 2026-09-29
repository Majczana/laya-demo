import { useEffect, useMemo, useRef, useState } from "react";
import { errorText, getJson, isAbort, postFile, postJson } from "./api";
import { CostScale } from "./CostScale";
import { useEngine } from "./engine";
import { useI18n, type Lang } from "./i18n";

type SortEngine = "jev" | "openai";
type Catalog = { models: Record<string, { name: string; family: string }>; categories: Record<string, Record<Lang, string>>; tags: Record<string, Record<Lang, string>> };
type Proposal = { model_id: string | null; model_status: string; model_confidence: number; model_scores: Record<string, number>; family: string | null; category: string; category_scores: Record<string, number>; tags: string[] };
type SortResult = { status: "auto" | "confirm"; engine: SortEngine; model: string; elapsed_ms: number; proposal: Proposal; usage?: { input_tokens?: number; output_tokens?: number } | null; cost: { usd: number | null; source: "provider" | "unreported" }; model_request: unknown; model_response: unknown };
type Expected = { model: string; category: string } | null;
type Sample = { id: string; filename: string; title: Record<Lang, string>; content: Record<Lang, string>; expected: Expected };
type Outcome = "hit" | "miss" | "review" | "human" | "n/a";
type Run = { id: string; sample: Sample; content: string; result: SortResult; modelId: string; category: string; outcome: Outcome; totalMs: number; startedAt: number; finishedAt: number; body: unknown };
type Phase = "idle" | "loading" | "scan" | "decided" | "filing";

const BOARD = [
  { id: "cc1", name: "CC1", type: { pl: "sprzątający", en: "cleaning" } },
  { id: "mt1", name: "MT1", type: { pl: "zamiatający", en: "sweeping" } },
  { id: "t600", name: "T600", type: { pl: "transportowy", en: "transport" } },
  { id: "bellabot", name: "BellaBot", type: { pl: "kelnerski", en: "serving" } },
];
const SLOTS = ["training", "manual", "mapping", "rest"] as const;
type Slot = (typeof SLOTS)[number];
const SLOT_CATEGORY: Record<Slot, string> = { training: "training", manual: "manual", mapping: "mapping", rest: "other" };
const slotOf = (category: string): Slot => (category === "training" || category === "manual" || category === "mapping" ? category : "rest");
const isBoard = (modelId: string) => BOARD.some((model) => model.id === modelId);
const folderOf = (modelId: string, category: string) => (isBoard(modelId) ? `${modelId}|${slotOf(category)}` : "misc");

const SAMPLES: Sample[] = [
  { id: "A", filename: "CC1-mapa-stacji.txt", expected: { model: "cc1", category: "mapping" }, title: { pl: "CC1 · mapa stacji", en: "CC1 · station map" }, content: {
    pl: "PUDU CC1 — procedura mapowania stacji ładowania. Przed wyznaczeniem mapy ustaw stację przy ścianie, sprawdź zasilanie i oznacz punkt dokowania. W aplikacji otwórz Mapowanie, przejedź robotem po obszarze i zapisz mapę. Po zapisaniu wykonaj próbny powrót do stacji.",
    en: "PUDU CC1 — charging station mapping procedure. Place the station against a wall, check power and mark the docking point. Open Mapping in the app, drive the robot around the area and save the map. Test a return to the station.",
  } },
  { id: "B", filename: "mycie-posadzki.txt", expected: { model: "general", category: "troubleshooting" }, title: { pl: "Mycie · bez modelu", en: "Scrubbing · no model" }, content: {
    pl: "Instrukcja dla robota myjącego posadzkę: sprawdź zbiornik czystej wody, szczotki i odpływ. Jeśli po przejeździe podłoga jest sucha, uruchom diagnostykę pompy. Dokument nie zawiera nazwy ani numeru modelu.",
    en: "Floor washing robot instructions: check the clean-water tank, brushes and drain. If the floor stays dry after a pass, run pump diagnostics. The document contains no model name or number.",
  } },
  { id: "C", filename: "MT1-zamiatanie-hali.md", expected: { model: "mt1", category: "manual" }, title: { pl: "MT1 · praca na hali", en: "MT1 · warehouse sweep" }, content: {
    pl: "# MT1 — instrukcja obsługi. Przed uruchomieniem zamiatania hali sprawdź szczotki, pojemnik na odpady i trasę przejazdu. Robot zbiera suche śmieci na dużych powierzchniach wewnętrznych.",
    en: "# MT1 — user manual. Before sweeping a large indoor hall, check the brushes, waste bin and route. The robot collects dry debris across large indoor areas.",
  } },
  { id: "D", filename: "T300-wdrozenie-magazyn.txt", expected: { model: "t300", category: "training" }, title: { pl: "T300 · wdrożenie", en: "T300 · deployment" }, content: {
    pl: "PUDU T300: szkolenie operatora transportu materiałów. Omów ograniczenie ładunku do 300 kg, trasę między regałami, zatrzymanie awaryjne i test pustego przejazdu przed pierwszym transportem.",
    en: "PUDU T300: material transport operator training. Cover the 300 kg load limit, route between racks, emergency stop and an empty test run before the first delivery.",
  } },
  { id: "E", filename: "szkolenie-ogolne.txt", expected: { model: "general", category: "training" }, title: { pl: "Szkolenie ogólne", en: "General training" }, content: {
    pl: "Plan szkolenia PM-ów: tworzenie instrukcji, nazewnictwo plików, wersjonowanie dokumentacji i przekazywanie zmian do zespołu serwisowego. Materiał dotyczy procesu dokumentacyjnego, nie konkretnego robota.",
    en: "PM training plan: writing instructions, file naming, document versioning and sending changes to the service team. This covers the documentation process rather than a specific robot.",
  } },
  { id: "F", filename: "BellaBot-szkolenie-tace.txt", expected: { model: "bellabot", category: "training" }, title: { pl: "BellaBot · szkolenie", en: "BellaBot · training" }, content: {
    pl: "BellaBot: materiały dla kelnerów. Pokaż, jak układać dania na tacach, wybierać stolik docelowy, reagować na przeszkodę i czyścić tace po zmianie.",
    en: "BellaBot: staff training. Show how to place dishes on trays, select a destination table, respond to an obstacle and clean the trays after a shift.",
  } },
  { id: "G", filename: "T600-instrukcja-obslugi.txt", expected: { model: "t600", category: "manual" }, title: { pl: "T600 · instrukcja", en: "T600 · manual" }, content: {
    pl: "PUDU T600 — instrukcja obsługi. Dopuszczalny ładunek to 600 kg. Przed jazdą sprawdź trasę, równomierne rozłożenie towaru i przycisk zatrzymania awaryjnego. Ekran pokazuje aktualny cel transportu.",
    en: "PUDU T600 — user manual. The load limit is 600 kg. Before driving, check the route, even load distribution and the emergency stop button. The screen shows the current transport destination.",
  } },
];

const COPY = {
  pl: { eyebrow: "08 / LINIA SORTOWNICZA", heading: "Sortownia dokumentów", intro: "Stos dokumentów jedzie przez skaner do modelu, a potem ląduje w folderze robota. Zegar, wskaźniki i trafność liczą się na żywo.",
    runAll: "Sortuj cały stos", runNext: "Następny", stop: "Zatrzymaj", upload: "Wgraj plik na stos", reset: "Zacznij od nowa", engine: "Model",
    stack: "Stos", stackEmpty: "Stos pusty", scanner: "Skaner", scanEmpty: "Czekam na dokument", root: "Biblioteka dokumentów", misc: "Wspólne i inne modele", review: "Do decyzji człowieka", reviewEmpty: "Nic nie czeka",
    slots: { training: "Szkolenie", manual: "Instrukcja obsługi", mapping: "Mapowanie i konfiguracja", rest: "Reszta" } as Record<Slot, string>,
    phase: { loading: "Wjazd na skaner", scan: "Model analizuje…", decided: "Decyzja", filing: "Do folderu" },
    robot: "Robot", category: "Kategoria", timeModel: "czas modelu", auto: "AUTO", human: "DO DECYZJI", general: "Wspólne", unknown: "Nieustalony",
    kDone: "Posortowane", kModel: "Śr. czas modelu", kTotal: "Śr. czas z siecią", kRate: "Przepustowość", kAuto: "Auto bez człowieka", kHit: "Trafność (znane wzorce)", kCost: "Koszt", per1000: "za 1000 dok.", perMin: "dok./min", of: "z", hits: "trafień",
    log: "Dziennik linii", logEmpty: "Uruchom stos, aby zobaczyć wyniki, czas i trafność.", expected: "oczekiwano", got: "model", hit: "trafienie", miss: "pudło", pending: "czeka na człowieka", resolved: "zdecydował człowiek", noTruth: "brak wzorca",
    legendModel: "czas modelu", legendNet: "reszta drogi",
    inspector: "Podgląd dokumentu", inspectorEmpty: "Kliknij wiersz dziennika lub kropkę w folderze.", tags: "Tagi", scores: "Wyniki modelu", json: "Wysłane i odebrane JSON", sent: "Sent · żądanie do modelu", received: "Received · odpowiedź", request: "POST do backendu",
    popTitle: "Gdzie to położyć?", popModel: "Robot", popSlot: "Folder", otherModels: "Inny model…", suggests: "Model sugeruje", family: "Pasujące modele", confirm: "Wyślij do folderu", cancel: "Zamknij",
    errors: "Nie udało się przetworzyć dokumentu.", openaiInfo: "OpenAI Responses API", note: "Wzorzec to nasza ocena dla przykładowych plików. Pliki wgrane przez Ciebie nie mają wzorca i nie wchodzą do trafności.", docs: "dok.", extracting: "Czytam plik…",
  },
  en: { eyebrow: "08 / SORTING LINE", heading: "Document sorting line", intro: "A stack of documents rolls through the scanner to the model, then lands in a robot folder. Timer, gauges and accuracy update live.",
    runAll: "Sort the whole stack", runNext: "Next", stop: "Stop", upload: "Add file to stack", reset: "Start over", engine: "Model",
    stack: "Stack", stackEmpty: "Stack empty", scanner: "Scanner", scanEmpty: "Waiting for a document", root: "Document library", misc: "Shared and other models", review: "Needs a human", reviewEmpty: "Nothing waiting",
    slots: { training: "Training", manual: "User manual", mapping: "Mapping and setup", rest: "Other" } as Record<Slot, string>,
    phase: { loading: "Entering scanner", scan: "Model analyzing…", decided: "Decision", filing: "To folder" },
    robot: "Robot", category: "Category", timeModel: "model time", auto: "AUTO", human: "NEEDS HUMAN", general: "Shared", unknown: "Unknown",
    kDone: "Sorted", kModel: "Avg model time", kTotal: "Avg with network", kRate: "Throughput", kAuto: "Auto, no human", kHit: "Accuracy (known answers)", kCost: "Cost", per1000: "per 1,000 docs", perMin: "docs/min", of: "of", hits: "hits",
    log: "Line log", logEmpty: "Run the stack to see results, timing and accuracy.", expected: "expected", got: "model", hit: "hit", miss: "miss", pending: "waiting for a human", resolved: "human decided", noTruth: "no reference",
    legendModel: "model time", legendNet: "rest of the trip",
    inspector: "Document preview", inspectorEmpty: "Click a log row or a dot in a folder.", tags: "Tags", scores: "Model scores", json: "Sent and received JSON", sent: "Sent · model request", received: "Received · response", request: "POST to backend",
    popTitle: "Where should it go?", popModel: "Robot", popSlot: "Folder", otherModels: "Other model…", suggests: "Model suggests", family: "Matching models", confirm: "Send to folder", cancel: "Close",
    errors: "The document could not be processed.", openaiInfo: "OpenAI Responses API", note: "The reference is our judgement for the sample files. Files you upload have no reference and do not count toward accuracy.", docs: "docs", extracting: "Reading file…",
  },
};

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

function fly(from: DOMRect, to: DOMRect, label: string, duration: number): Promise<void> {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  return new Promise((resolve) => {
    const sheet = document.createElement("div");
    sheet.className = "dz-flyer"; sheet.textContent = label;
    Object.assign(sheet.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
    document.body.appendChild(sheet);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const scale = Math.max(0.1, Math.min(1, to.width / from.width, to.height / from.height));
    const animation = sheet.animate([
      { transform: "translate(0, 0) rotate(0deg) scale(1)", opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) rotate(-6deg) scale(${(1 + scale) / 1.7})`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(${scale})`, opacity: 0.7 },
    ], { duration, easing: "cubic-bezier(0.55, 0, 0.25, 1)", fill: "forwards" });
    let finished = false;
    const finish = () => { if (finished) return; finished = true; sheet.remove(); resolve(); };
    animation.onfinish = finish; animation.oncancel = finish;
  });
}

function Ring({ value, label, tone }: { value: number; label: string; tone: string }) {
  const circumference = 2 * Math.PI * 26;
  return <div className={`dz-ring ${tone}`}>
    <svg viewBox="0 0 64 64" aria-hidden="true"><circle className="bg" cx="32" cy="32" r="26" /><circle className="fg" cx="32" cy="32" r="26" transform="rotate(-90 32 32)" style={{ strokeDasharray: `${circumference * Math.min(1, Math.max(0, value))} ${circumference}` }} /></svg>
    <b>{Math.round(value * 100)}%</b><small>{label}</small>
  </div>;
}

export function DocumentSorterDemo() {
  const { lang, t } = useI18n(); const c = COPY[lang]; const { backend } = useEngine();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [status, setStatus] = useState<{ jev: boolean; openai: boolean }>({ jev: false, openai: false });
  const [engine, setEngine] = useState<SortEngine>("jev");
  const [stack, setStack] = useState<Sample[]>(SAMPLES);
  const [runs, setRuns] = useState<Run[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [scanDoc, setScanDoc] = useState<Sample | null>(null); const [scanText, setScanText] = useState("");
  const [decision, setDecision] = useState<Run | null>(null); const [liveMs, setLiveMs] = useState(0);
  const [running, setRunning] = useState(false); const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string | null>(null); const [resolving, setResolving] = useState<string | null>(null);
  const [popModel, setPopModel] = useState(""); const [popSlot, setPopSlot] = useState<Slot>("manual");
  const [pulse, setPulse] = useState("");
  const stackRef = useRef<HTMLDivElement>(null); const trayRef = useRef<HTMLDivElement>(null); const stageRef = useRef<HTMLElement>(null);
  const runningRef = useRef(false); const aliveRef = useRef(true); const controllerRef = useRef<AbortController | null>(null);
  const busy = running || phase !== "idle" || extracting;

  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; controllerRef.current?.abort(); }; }, []);
  useEffect(() => {
    if (backend.state !== "ready") return;
    const controller = new AbortController();
    void Promise.all([getJson<Catalog>("/documents/catalog", controller.signal), getJson<{ jev: boolean; openai: boolean }>("/documents/status", controller.signal)])
      .then(([nextCatalog, nextStatus]) => { setCatalog(nextCatalog); setStatus(nextStatus); if (!nextStatus.jev && nextStatus.openai) setEngine("openai"); })
      .catch(() => {});
    return () => controller.abort();
  }, [backend.state]);
  useEffect(() => {
    if (phase !== "scan") return;
    const start = performance.now();
    const timer = window.setInterval(() => setLiveMs(performance.now() - start), 40);
    return () => window.clearInterval(timer);
  }, [phase]);

  const modelName = (id: string) => id === "general" ? c.general : catalog?.models[id]?.name ?? BOARD.find((model) => model.id === id)?.name ?? id.toUpperCase();
  const categoryName = (id: string) => catalog?.categories[id]?.[lang] ?? id;
  const tagName = (id: string) => catalog?.tags[id]?.[lang] ?? id;
  const folderName = (modelId: string, category: string) => isBoard(modelId) ? `${modelName(modelId)} · ${c.slots[slotOf(category)]}` : c.misc;

  const filed = runs.filter((run) => run.outcome !== "review");
  const waiting = runs.filter((run) => run.outcome === "review");
  const stats = useMemo(() => {
    const n = runs.length;
    const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const scored = runs.filter((run) => run.outcome === "hit" || run.outcome === "miss");
    const costs = runs.map((run) => run.result.cost.usd).filter((usd): usd is number => usd !== null);
    const wall = n ? Math.max(...runs.map((run) => run.finishedAt)) - Math.min(...runs.map((run) => run.startedAt)) : 0;
    return { n, model: mean(runs.map((run) => run.result.elapsed_ms)), total: mean(runs.map((run) => run.totalMs)), perMin: wall > 0 ? n / (wall / 60000) : 0,
      auto: n ? runs.filter((run) => run.result.status === "auto").length / n : 0, scored: scored.length, hits: scored.filter((run) => run.outcome === "hit").length,
      cost: costs.reduce((a, b) => a + b, 0), perDoc: mean(costs), maxMs: Math.max(1, ...runs.map((run) => run.totalMs)) };
  }, [runs]);

  const cell = (key: string) => stageRef.current?.querySelector<HTMLElement>(`[data-folder="${key}"]`);
  function judge(sample: Sample, modelId: string, category: string): Outcome {
    if (!sample.expected) return "n/a";
    return sample.expected.model === modelId && slotOf(sample.expected.category) === slotOf(category) ? "hit" : "miss";
  }
  function land(key: string) { setPulse(key); window.setTimeout(() => setPulse((value) => (value === key ? "" : value)), 1500); }

  async function processSample(item: Sample): Promise<boolean> {
    const from = stackRef.current?.querySelector<HTMLElement>(".dz-sheet.top")?.getBoundingClientRect();
    const tray = trayRef.current?.getBoundingClientRect();
    const text = item.content[lang];
    setError(null); setDecision(null); setLiveMs(0); setScanText(text);
    setStack((previous) => previous.filter((sample) => sample.id !== item.id)); setScanDoc(item); setPhase("loading");
    if (from && tray) await fly(from, tray, item.filename, 520);
    if (!aliveRef.current) return false;
    const controller = new AbortController(); controllerRef.current = controller;
    const body = { filename: item.filename, content: text, lang, engine };
    const startedAt = performance.now(); setPhase("scan");
    let result: SortResult;
    try { result = await postJson<SortResult>("/documents/classify", body, controller.signal); }
    catch (reason) {
      if (!isAbort(reason) && aliveRef.current) { setError(reason); setStack((previous) => [item, ...previous]); setScanDoc(null); setPhase("idle"); }
      return false;
    }
    const finishedAt = performance.now(); const totalMs = finishedAt - startedAt;
    const modelId = result.proposal.model_id ?? "general"; const category = result.proposal.category;
    const run: Run = { id: crypto.randomUUID(), sample: item, content: text, result, modelId, category, totalMs, startedAt, finishedAt, body,
      outcome: result.status === "auto" ? judge(item, modelId, category) : "review" };
    setLiveMs(totalMs); setDecision(run); setPhase("decided"); await sleep(1100);
    if (!aliveRef.current) return false;
    const key = result.status === "auto" ? folderOf(modelId, category) : "review";
    const target = cell(key); const fromTray = trayRef.current?.getBoundingClientRect();
    setPhase("filing");
    if (target && fromTray) await fly(fromTray, target.getBoundingClientRect(), item.filename, 800);
    if (!aliveRef.current) return false;
    setRuns((previous) => [...previous, run]); setScanDoc(null); setDecision(null); setPhase("idle"); land(key);
    if (result.status === "auto") setSelected(run.id);
    return true;
  }
  async function runStack(all: boolean) {
    if (busy || !status[engine]) return;
    const queue = all ? [...stack] : stack.slice(0, 1);
    runningRef.current = true; setRunning(true);
    for (const item of queue) { if (!runningRef.current) break; if (!(await processSample(item))) break; }
    runningRef.current = false; if (aliveRef.current) setRunning(false);
  }
  async function upload(file: File) {
    setExtracting(true); setError(null);
    const controller = new AbortController(); controllerRef.current = controller;
    try {
      const extracted = await postFile<{ filename: string; text: string }>("/documents/extract", file, controller.signal);
      if (!controller.signal.aborted) setStack((previous) => [{ id: `U${Date.now() % 1000}`, filename: extracted.filename, expected: null, title: { pl: extracted.filename, en: extracted.filename }, content: { pl: extracted.text, en: extracted.text } }, ...previous]);
    } catch (reason) { if (!isAbort(reason)) setError(reason); }
    finally { if (!controller.signal.aborted) setExtracting(false); }
  }
  function openResolver(run: Run) {
    setResolving(run.id); setSelected(run.id);
    setPopModel(run.result.proposal.model_status === "unclear" ? "" : run.modelId);
    setPopSlot(slotOf(run.category));
  }
  async function resolve(run: Run) {
    if (!popModel) return;
    const category = popSlot === "rest" && slotOf(run.category) === "rest" ? run.category : SLOT_CATEGORY[popSlot];
    const key = folderOf(popModel, category);
    const from = stageRef.current?.querySelector<HTMLElement>(`[data-review="${run.id}"]`)?.getBoundingClientRect(); const target = cell(key);
    setResolving(null);
    if (from && target) await fly(from, target.getBoundingClientRect(), run.sample.filename, 800);
    if (!aliveRef.current) return;
    setRuns((previous) => previous.map((item) => item.id === run.id ? { ...item, modelId: popModel, category, outcome: "human" } : item)); land(key);
  }
  function reset() { runningRef.current = false; controllerRef.current?.abort(); setRunning(false); setPhase("idle"); setScanDoc(null); setDecision(null); setRuns([]); setStack(SAMPLES); setSelected(null); setResolving(null); setError(null); }

  const selectedRun = runs.find((run) => run.id === selected);
  const resolvingRun = runs.find((run) => run.id === resolving);
  const otherModels = Object.entries(catalog?.models ?? {}).filter(([key]) => !isBoard(key));
  const scoreRows = (scores: Record<string, number>, name: (key: string) => string) => Object.entries(scores).filter(([, score]) => score >= 0.005).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([key, score]) => <div className="ticket-option" key={key}><span>{name(key)}</span><strong>{Math.round(score * 100)}%</strong><div className="ticket-bar"><span style={{ width: `${score * 100}%` }} /></div></div>);
  const dots = (key: string) => filed.filter((run) => folderOf(run.modelId, run.category) === key).map((run) => <button type="button" key={run.id} className={`dz-dot ${run.outcome} ${selected === run.id ? "on" : ""}`} title={`${run.sample.filename} · ${outcomeText(run.outcome)}`} aria-label={run.sample.filename} onClick={(event) => { event.stopPropagation(); setSelected(run.id); }} />);
  function outcomeText(outcome: Outcome) { return outcome === "hit" ? c.hit : outcome === "miss" ? c.miss : outcome === "review" ? c.pending : outcome === "human" ? c.resolved : c.noTruth; }
  const folder = (key: string, label: string) => {
    const count = filed.filter((run) => folderOf(run.modelId, run.category) === key).length;
    return <div key={key} data-folder={key} className={`dz-bin ${pulse === key ? "pulse" : ""} ${count ? "filled" : ""}`} style={{ "--fill": Math.min(1, count / 3) } as React.CSSProperties}>
      <span className="dz-bin-name">{label}</span><span className="dz-dots">{dots(key)}</span><b>{count}</b>
    </div>;
  };
  const decisionRun = decision;

  return <main className="ticket-page dz-page">
    <div className="injection-heading"><p className="eyebrow">{c.eyebrow}</p><h1>{c.heading}</h1><p className="muted">{c.intro}</p></div>

    <section className="dz-kpis" aria-label="KPI">
      <div className="dz-kpi"><small>{c.kDone}</small><b>{stats.n}<span> {c.of} {stats.n + stack.length + (scanDoc ? 1 : 0)}</span></b><div className="dz-spark">{runs.map((run) => <i key={run.id} className={run.outcome} style={{ height: `${Math.max(12, (run.totalMs / stats.maxMs) * 100)}%` }} title={fmtMs(run.totalMs)} />)}</div></div>
      <div className="dz-kpi"><small>{c.kModel}</small><b>{stats.n ? fmtMs(stats.model) : "—"}</b><em>{c.kTotal}: {stats.n ? fmtMs(stats.total) : "—"}</em></div>
      <div className="dz-kpi"><small>{c.kRate}</small><b>{stats.n > 1 ? stats.perMin.toFixed(1) : "—"}<span> {c.perMin}</span></b><em>{c.kAuto}: {stats.n ? Math.round(stats.auto * 100) : "—"}%</em></div>
      <div className="dz-kpi"><small>{c.kHit}</small><b className={stats.scored ? "" : "dim"}>{stats.scored ? `${Math.round(stats.hits / stats.scored * 100)}%` : "—"}</b><em>{stats.hits} {c.of} {stats.scored} {c.hits}</em></div>
      <div className="dz-kpi"><small>{c.kCost}</small><b>{stats.n ? `$${stats.cost.toFixed(4)}` : "—"}</b><em>{stats.perDoc ? `≈ $${(stats.perDoc * 1000).toFixed(2)} ${c.per1000}` : "—"}</em></div>
    </section>

    <div className="dz-controls">
      <button type="button" className="injection-primary" disabled={busy || stack.length === 0 || !status[engine]} onClick={() => void runStack(true)}>▶ {c.runAll} ({stack.length})</button>
      <button type="button" className="dz-btn" disabled={busy || stack.length === 0 || !status[engine]} onClick={() => void runStack(false)}>{c.runNext}</button>
      {running && <button type="button" className="dz-btn" onClick={() => { runningRef.current = false; }}>■ {c.stop}</button>}
      <label className={`dz-btn dz-file ${busy ? "disabled" : ""}`}><input type="file" accept=".txt,.md,.csv,.docx,.pdf" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />{extracting ? c.extracting : `↑ ${c.upload}`}</label>
      <button type="button" className="dz-btn" disabled={running || phase !== "idle"} onClick={reset}>↺ {c.reset}</button>
      {status.openai && <select aria-label={c.engine} value={engine} disabled={busy} onChange={(event) => setEngine(event.target.value as SortEngine)}><option value="jev">Jev</option><option value="openai">OpenAI</option></select>}
      {error !== null && <span className="error">{errorText(error, t, c.errors)}</span>}
    </div>

    <section className="dz-stage" ref={stageRef}>
      <div className="dz-stack-col">
        <h2>{c.stack} · {stack.length}</h2>
        <div className="dz-stack" ref={stackRef}>
          {stack.length === 0 ? <p className="muted small">{c.stackEmpty}</p> : stack.slice(0, 4).map((sample, index) => ({ sample, index })).reverse().map(({ sample, index }) => {
            const top = index === 0;
            return <div key={sample.id} className={`dz-sheet ${top ? "top" : ""}`} style={{ transform: `translate(${index * 6}px, ${index * -6}px) rotate(${index % 2 ? index * 0.9 : index * -0.9}deg)`, zIndex: 10 - index }}>
              <em>{sample.id}</em><strong>{sample.title[lang]}</strong><small>{sample.filename}</small>
            </div>;
          })}
        </div>
      </div>

      <div className="dz-belt" aria-hidden="true"><span className={phase === "loading" || phase === "filing" ? "go" : ""} /></div>

      <div className="dz-scan-col">
        <h2>{c.scanner}</h2>
        <div className={`dz-scanner ${phase}`} ref={trayRef}>
          <i className="tl" /><i className="tr" /><i className="bl" /><i className="br" />
          {scanDoc ? <div className={`dz-paper ${phase === "loading" || phase === "filing" ? "away" : ""}`}><strong>{scanDoc.filename}</strong><p>{scanText}</p>{phase === "scan" && <span className="dz-beam" />}</div> : <p className="dz-idle muted small">{c.scanEmpty}</p>}
          {decisionRun && phase === "decided" && <div className={`dz-stamp ${decisionRun.result.status}`}>{decisionRun.result.status === "auto" ? c.auto : c.human}</div>}
        </div>
        <div className="dz-clock"><b className={phase === "scan" ? "live" : ""}>{fmtMs(liveMs)}</b><small>{phase === "idle" ? c.scanEmpty : c.phase[phase]}</small></div>
        <div className="dz-gauges">
          {decisionRun && phase !== "scan" ? <>
            <Ring value={decisionRun.result.proposal.model_confidence} label={decisionRun.result.proposal.model_id ? modelName(decisionRun.result.proposal.model_id) : decisionRun.result.proposal.model_status === "general" ? c.general : c.unknown} tone={decisionRun.result.proposal.model_confidence >= 0.75 ? "ok" : "warn"} />
            <Ring value={decisionRun.result.proposal.category_scores[decisionRun.category] ?? 0} label={categoryName(decisionRun.category)} tone={(decisionRun.result.proposal.category_scores[decisionRun.category] ?? 0) >= 0.65 ? "ok" : "warn"} />
            <div className="dz-model-ms"><b>{fmtMs(decisionRun.result.elapsed_ms)}</b><small>{c.timeModel}</small></div>
          </> : <p className="muted small">{phase === "scan" ? `${c.robot} · ${c.category}…` : "—"}</p>}
        </div>
      </div>

      <div className="dz-board">
        <h2>{c.root}</h2>
        <div className="dz-cols">{BOARD.map((model) => <div className="dz-col" key={model.id}>
          <header><strong>{model.name}</strong><small>{model.type[lang]}</small></header>
          {SLOTS.map((slot) => folder(`${model.id}|${slot}`, c.slots[slot]))}
        </div>)}</div>
        <div className="dz-lower">
          {folder("misc", c.misc)}
          <div className={`dz-review ${waiting.length ? "has" : ""} ${pulse === "review" ? "pulse" : ""}`} data-folder="review">
            <span className="dz-bin-name">{c.review}</span>
            <div className="dz-review-cards">{waiting.length === 0 ? <small className="muted">{c.reviewEmpty}</small> : waiting.map((run) => <button type="button" key={run.id} data-review={run.id} className={resolving === run.id ? "on" : ""} onClick={() => openResolver(run)}>{run.sample.filename}</button>)}</div>
            <b>{waiting.length}</b>
            {resolvingRun && <div className="dz-pop" role="dialog" aria-label={c.popTitle}>
              <strong>{c.popTitle}</strong>
              <p className="small muted">{c.suggests}: {resolvingRun.result.proposal.model_id ? modelName(resolvingRun.result.proposal.model_id) : c.unknown} ({Math.round(resolvingRun.result.proposal.model_confidence * 100)}%) · {categoryName(resolvingRun.category)}</p>
              <div className="dz-pop-row"><small>{c.popModel}</small><div>{BOARD.map((model) => <button type="button" key={model.id} className={popModel === model.id ? "on" : ""} onClick={() => setPopModel(model.id)}>{model.name}</button>)}<button type="button" className={popModel === "general" ? "on" : ""} onClick={() => setPopModel("general")}>{c.general}</button>
                <select aria-label={c.otherModels} value={isBoard(popModel) || popModel === "general" ? "" : popModel} onChange={(event) => setPopModel(event.target.value)}><option value="">{c.otherModels}</option>{otherModels.map(([key, item]) => <option key={key} value={key}>{item.name}</option>)}</select></div></div>
              <div className="dz-pop-row"><small>{c.popSlot}</small><div>{SLOTS.map((slot) => <button type="button" key={slot} className={popSlot === slot ? "on" : ""} onClick={() => setPopSlot(slot)}>{c.slots[slot]}</button>)}</div></div>
              <div className="dz-pop-actions"><button type="button" className="injection-primary" disabled={!popModel} onClick={() => void resolve(resolvingRun)}>{c.confirm}</button><button type="button" className="dz-btn" onClick={() => setResolving(null)}>{c.cancel}</button></div>
            </div>}
          </div>
        </div>
      </div>
    </section>

    <div className="dz-bottom">
      <section className="injection-panel dz-log">
        <h2>{c.log}</h2>
        {runs.length === 0 ? <p className="muted small">{c.logEmpty}</p> : <>
          <div className="dz-legend"><span><i className="m" /> {c.legendModel}</span><span><i className="n" /> {c.legendNet}</span></div>
          <ol>{runs.map((run) => <li key={run.id} className={`${run.outcome} ${selected === run.id ? "on" : ""}`}>
            <button type="button" onClick={() => setSelected(run.id)}>
              <span className="dz-log-name"><strong>{run.sample.id.length === 1 ? `${run.sample.id} · ` : ""}{run.sample.filename}</strong>
                <small>{run.sample.expected ? `${c.expected}: ${modelName(run.sample.expected.model)} · ${c.slots[slotOf(run.sample.expected.category)]}` : c.noTruth}</small></span>
              <span className="dz-log-got"><small>{c.got}</small><strong>{run.result.status === "auto" || run.outcome === "human" ? folderName(run.modelId, run.category) : "?"}</strong></span>
              <span className="dz-log-time"><span className="dz-bar" style={{ width: `${(run.totalMs / stats.maxMs) * 100}%` }}><i style={{ width: `${Math.min(100, run.result.elapsed_ms / run.totalMs * 100)}%` }} /></span><small>{fmtMs(run.result.elapsed_ms)} / {fmtMs(run.totalMs)}</small></span>
              <span className={`dz-badge ${run.outcome}`}>{outcomeText(run.outcome)}</span>
            </button>
          </li>)}</ol>
        </>}
        <p className="small muted">{c.note}</p>
      </section>

      <section className="injection-panel dz-inspector">
        <h2>{c.inspector}</h2>
        {!selectedRun ? <p className="muted small">{c.inspectorEmpty}</p> : <>
          <h3>{selectedRun.sample.filename}</h3>
          <p className="small muted">{folderName(selectedRun.modelId, selectedRun.category)} · {selectedRun.result.model}</p>
          <div className="docs-tags">{selectedRun.result.proposal.tags.map((tag) => <span key={tag}>{tagName(tag)}</span>)}</div>
          <pre>{selectedRun.content}</pre>
          <details><summary>{c.scores}</summary>
            <h4>{c.robot}</h4><div className="ticket-options">{scoreRows(selectedRun.result.proposal.model_scores, (key) => modelName(key))}</div>
            <h4>{c.category}</h4><div className="ticket-options">{scoreRows(selectedRun.result.proposal.category_scores, categoryName)}</div>
          </details>
          {selectedRun.result.engine === "jev" ? <CostScale engine="jev" cost={selectedRun.result.cost} usage={selectedRun.result.usage} lang={lang} /> : <p className="small muted">{c.openaiInfo} {selectedRun.result.usage && `${selectedRun.result.usage.input_tokens ?? "—"} in / ${selectedRun.result.usage.output_tokens ?? "—"} out`}</p>}
          <details><summary>{c.json}</summary>
            <details><summary>{c.request}</summary><pre>{JSON.stringify({ method: "POST", path: "/api/documents/classify", body: selectedRun.body }, null, 2)}</pre></details>
            <details><summary>{c.sent}</summary><pre>{JSON.stringify(selectedRun.result.model_request, null, 2)}</pre></details>
            <details><summary>{c.received}</summary><pre>{JSON.stringify(selectedRun.result.model_response, null, 2)}</pre></details>
          </details>
        </>}
      </section>
    </div>
  </main>;
}
