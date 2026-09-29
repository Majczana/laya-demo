import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { errorText, isAbort, postJson } from "./api";
import { ENGINE_NAMES, useEngine, type Engine } from "./engine";
import { useI18n } from "./i18n";
import { CostScale } from "./CostScale";
import { EXAMPLES, type Robot } from "./partsExamples";

type Part = { id: string; name: string; score: number };
type Located = {
  engine: Engine; model: string; elapsed_ms: number; robot: Robot; parts: Part[]; likely: string[]; threshold: number;
  cost: { usd: number | null; source: "local_api" | "provider" | "unreported" };
  model_request: unknown; model_response: { usage?: { input_tokens?: number; output_tokens?: number }; [key: string]: unknown };
};

/** Drawn shapes. A part can be made of several (two wheels, four trays); `ring` draws an outline instead of a fill. */
type Shape = ({ kind: "rect"; x: number; y: number; w: number; h: number; r?: number } | { kind: "circle"; cx: number; cy: number; r: number } | { kind: "path"; d: string }) & { ring?: boolean };
type Deco = Shape & { cls: "white" | "dark" | "green" | "red" | "line" | "eye" | "glow" };
type PartDef = { shapes: Shape[]; inside?: boolean; dark?: boolean };
type Schema = { h: number; deco: Deco[]; after: Deco[]; parts: Record<string, PartDef> };

const rect = (x: number, y: number, w: number, h: number, r = 0, ring = false): Shape => ({ kind: "rect", x, y, w, h, r, ring });
const circle = (cx: number, cy: number, r: number, ring = false): Shape => ({ kind: "circle", cx, cy, r, ring });
const path = (d: string): Shape => ({ kind: "path", d });

/** Simplified front drawings after the PUDU BellaBot and CC1: the same places carry the same parts. */
const SCHEMAS: Record<Robot, Schema> = {
  delivery: {
    h: 480,
    deco: [
      // Dark back panel behind the trays, then the white base, pillar and the hook-shaped canopy.
      { ...rect(178, 112, 80, 282, 32), cls: "dark" },
      { ...path("M 96 78 C 120 36 236 26 272 92 C 274 100 262 104 254 96 C 226 62 168 66 130 104 Z"), cls: "white" },
      { ...path("M 112 60 C 150 30 236 28 270 88"), cls: "line" },
      { ...rect(26, 400, 248, 54, 27), cls: "white" },
      { ...rect(58, 132, 98, 272, 34), cls: "white" },
      { ...path("M 60 74 L 68 44 L 92 68 Z"), cls: "dark" },
      { ...path("M 120 68 L 144 44 L 154 76 Z"), cls: "dark" },
      { ...path("M 156 186 L 264 186 M 156 252 L 264 252 M 156 318 L 264 318 M 156 384 L 264 384"), cls: "glow" },
    ],
    after: [
      { ...circle(82, 104, 10, true), cls: "eye" },
      { ...circle(130, 104, 10, true), cls: "eye" },
    ],
    parts: {
      screen: { dark: true, shapes: [rect(50, 62, 112, 82, 22)] },
      camera: { dark: true, shapes: [rect(84, 152, 46, 11, 5.5)] },
      tray: { shapes: [rect(156, 176, 110, 11, 5.5), rect(156, 242, 110, 11, 5.5), rect(156, 308, 110, 11, 5.5), rect(156, 374, 110, 11, 5.5)] },
      lidar: { dark: true, shapes: [rect(150, 414, 90, 17, 8.5)] },
      bumper: { shapes: [rect(26, 400, 248, 54, 27, true)] },
      battery: { inside: true, shapes: [rect(44, 414, 84, 26, 6)] },
      charger: { shapes: [rect(126, 448, 48, 8, 3)] },
      wheel: { dark: true, shapes: [circle(94, 464, 13), circle(212, 464, 13)] },
    },
  },
  cleaning: {
    h: 340,
    deco: [
      { ...path("M 70 100 L 230 100 Q 242 100 243 112 L 246 246 Q 246 262 232 262 L 68 262 Q 54 262 54 246 L 57 112 Q 58 100 70 100 Z"), cls: "white" },
      { ...path("M 226 108 Q 246 112 248 130 L 250 236 Q 250 252 238 254 L 214 168 Q 212 118 226 108 Z"), cls: "green" },
      { ...rect(54, 82, 192, 26, 10), cls: "dark" },
      { ...circle(150, 80, 6), cls: "red" },
      { ...rect(32, 272, 236, 34, 16), cls: "white" },
      { ...path("M 48 306 L 30 324 M 58 308 L 44 330 M 68 309 L 62 332"), cls: "line" },
      { ...rect(262, 300, 28, 12, 4), cls: "dark" },
    ],
    after: [
      { ...rect(108, 128, 20, 30, 10, true), cls: "eye" },
      { ...rect(172, 128, 20, 30, 10, true), cls: "eye" },
    ],
    parts: {
      screen: { dark: true, shapes: [rect(84, 116, 132, 54, 12)] },
      camera: { dark: true, shapes: [circle(94, 180, 6), circle(206, 180, 6), rect(136, 176, 28, 64, 14)] },
      bumper: { shapes: [rect(72, 238, 30, 14, 7), rect(198, 238, 30, 14, 7), rect(118, 287, 64, 10, 5)] },
      lidar: { dark: true, shapes: [rect(138, 262, 24, 14, 5)] },
      filter: { inside: true, shapes: [rect(74, 194, 44, 38, 8)] },
      pump: { inside: true, shapes: [rect(182, 194, 40, 36, 8)] },
      battery: { inside: true, shapes: [rect(60, 281, 56, 19, 5)] },
      charger: { shapes: [rect(198, 298, 42, 8, 3)] },
      wheel: { dark: true, shapes: [circle(82, 318, 12), circle(218, 318, 12)] },
    },
  },
};

const COPY = {
  pl: {
    heading: "Diagnoza na schemacie robota", intro: "Opisz usterkę własnymi słowami. Model niezależnie ocenia każdy podzespół, więc na rysunku może zaświecić się kilka miejsc naraz.",
    examples: "Przykłady", robot: "Rodzaj robota", robots: { delivery: "Kelnerski", cleaning: "Sprzątający" }, symptom: "Opis usterki", placeholder: "Co robi robot, kiedy zaczęło się problem, co już sprawdzono…",
    run: "Wskaż podzespoły", compare: "Porównaj oba modele", working: "Szukam…", result: "Schemat", empty: "Wybierz przykład albo opisz usterkę — podzespoły podświetlą się według oceny modelu.", busy: "Model ocenia każdy podzespół…",
    ranking: "Wszystkie podzespoły, z których model wybierał", likely: "prawdopodobne", possible: "słaby sygnał", noneLikely: "Żaden podzespół nie przekroczył progu — model nie jest pewny; najsilniejsze sygnały są zaznaczone.",
    rule: (percent: number) => `„Prawdopodobne” od ${percent}%. To ocena modelu dla każdego podzespołu osobno, nie diagnoza serwisowa.`,
    note: "Pytania do modelu są po angielsku, bo w naszych próbach LAYA odpowiadała wtedy wyraźnie trafniej.",
    details: "Koszt i surowy JSON", json: "Wysłane i odebrane JSON", http: "POST do backendu", sent: "Sent · żądanie do modelu", received: "Received · surowa odpowiedź", error: "Ocena nie powiodła się.",
  },
  en: {
    heading: "Fault diagnosis on a robot schematic", intro: "Describe the fault in your own words. The model rates every part independently, so several places can light up at once.",
    examples: "Examples", robot: "Robot type", robots: { delivery: "Serving", cleaning: "Cleaning" }, symptom: "Fault description", placeholder: "What the robot does, when it started, what was already checked…",
    run: "Point at the parts", compare: "Compare both models", working: "Searching…", result: "Schematic", empty: "Pick an example or describe a fault — parts light up according to the model's rating.", busy: "The model is rating every part…",
    ranking: "All parts the model chose from", likely: "likely", possible: "weak signal", noneLikely: "No part passed the threshold — the model is unsure; the strongest signals are marked.",
    rule: (percent: number) => `“Likely” from ${percent}%. This is the model's rating for each part separately, not a service diagnosis.`,
    note: "The questions sent to the model are in English because LAYA answered them clearly better in our trials.",
    details: "Cost and raw JSON", json: "Sent and received JSON", http: "POST to backend", sent: "Sent · model request", received: "Received · raw response", error: "The rating failed.",
  },
};

const percent = (value: number) => Math.round(value * 100);

function ShapeEl({ shape, className, style }: { shape: Shape; className?: string; style?: CSSProperties }) {
  const cls = `${className ?? ""}${shape.ring ? " ring" : ""}`.trim() || undefined;
  if (shape.kind === "rect") return <rect className={cls} style={style} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.r ?? 0} />;
  if (shape.kind === "circle") return <circle className={cls} style={style} cx={shape.cx} cy={shape.cy} r={shape.r} />;
  return <path className={cls} style={style} d={shape.d} />;
}

function center(shape: Shape): [number, number] {
  if (shape.kind === "rect") return [shape.x + shape.w / 2, shape.y + shape.h / 2];
  if (shape.kind === "circle") return [shape.cx, shape.cy];
  return [150, 150];
}

/** Line drawing of a robot. With scores each part glows in proportion to its rating; the top three are numbered. */
function RobotSchema({ robot, parts, busy, focus, onFocus }: { robot: Robot; parts: Part[] | null; busy: boolean; focus: string | null; onFocus: (id: string | null) => void }) {
  const schema = SCHEMAS[robot];
  const rankOf = new Map((parts ?? []).map((part, index) => [part.id, index]));
  const scoreOf = new Map((parts ?? []).map((part) => [part.id, part.score]));
  // Brightness is relative to the strongest signal, but a weak signal is never boosted above score / 0.6.
  const strongest = Math.max(0.6, ...(parts ?? []).map((part) => part.score));
  return (
    <svg className={`schema ${busy ? "is-busy" : ""}`} viewBox={`0 0 300 ${schema.h}`} style={{ "--h": `${schema.h}px` } as CSSProperties} role="img" aria-label={robot}>
      <g className="sch-body">
        {schema.deco.map((shape, index) => <ShapeEl key={index} shape={shape} className={shape.cls} />)}
      </g>
      {Object.entries(schema.parts).map(([id, part]) => {
        const score = scoreOf.get(id) ?? 0;
        const name = parts?.find((item) => item.id === id)?.name ?? id;
        return (
          <g key={id} className={`sch-part${part.inside ? " inside" : ""}${part.dark ? " dark" : ""}${focus === id ? " focus" : ""}`} onMouseEnter={() => onFocus(id)} onMouseLeave={() => onFocus(null)}>
            <title>{parts ? `${name} · ${percent(score)}%` : name}</title>
            {part.shapes.map((shape, index) => <ShapeEl key={index} shape={shape} className="sch-base" />)}
          </g>
        );
      })}
      <g className="sch-body sch-after">{schema.after.map((shape, index) => <ShapeEl key={index} shape={shape} className={shape.cls} />)}</g>
      {parts && Object.entries(schema.parts).map(([id, part]) => {
        const score = scoreOf.get(id) ?? 0;
        const rank = rankOf.get(id) ?? 99;
        const [cx, cy] = center(part.shapes[0]);
        return (
          <g key={`heat-${id}`} className="sch-glow">
            {part.shapes.map((shape, index) => <ShapeEl key={index} shape={shape} className="sch-heat" style={{ "--o": Math.max(0, Math.min(1, (score - 0.1) / (strongest - 0.1))), "--rank": Math.min(rank, 9) } as CSSProperties} />)}
            {score >= 0.5 && <circle className="sch-pulse" cx={cx} cy={cy} r={14} style={{ "--rank": Math.min(rank, 9) } as CSSProperties} />}
            {rank < 3 && score >= 0.15 && <g className="sch-badge" style={{ "--rank": rank } as CSSProperties}><circle cx={cx} cy={cy} r={9} /><text x={cx} y={cy + 3.5}>{rank + 1}</text></g>}
          </g>
        );
      })}
      {busy && <rect className="sch-scan" x="0" y="0" width="300" height="26" />}
    </svg>
  );
}

export function PartsDemo() {
  const { lang, t } = useI18n();
  const c = COPY[lang];
  const { backend, engine } = useEngine();
  const [robot, setRobot] = useState<Robot>("delivery");
  const [symptom, setSymptom] = useState("");
  const [exampleId, setExampleId] = useState<string | null>(null);
  const [results, setResults] = useState<Partial<Record<Engine, Located | { error: unknown }>>>({});
  const [pending, setPending] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const jevReady = backend.state === "ready" && backend.health.engines.jev.available;
  useEffect(() => () => requestRef.current?.abort(), []);

  function invalidate() { requestRef.current?.abort(); setPending(false); setResults({}); setExampleId(null); }
  function choose(id: string) {
    const example = EXAMPLES.find((item) => item.id === id)!;
    invalidate(); setRobot(example.robot); setSymptom(example.symptom[lang]); setExampleId(id);
  }
  async function run(models: Engine[]) {
    if (symptom.trim().length < 3 || pending) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true);
    setResults({});
    const settled = await Promise.allSettled(models.map((model) => postJson<Located>("/parts/locate", { symptom, robot, lang, engine: model }, controller.signal)));
    if (controller.signal.aborted) return;
    const next: Partial<Record<Engine, Located | { error: unknown }>> = {};
    settled.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") next[models[index]] = outcome.value;
      else if (!isAbort(outcome.reason)) next[models[index]] = { error: outcome.reason };
    });
    setResults(next);
    setPending(false);
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void run([engine]); }
  const shown = (["laya", "jev"] as Engine[]).filter((model) => results[model]);
  const robots: Robot[] = ["delivery", "cleaning"];

  return <main className="ticket-page parts-page">
    <div className="injection-heading"><p className="eyebrow">10 / SCHEMATIC</p><h1>{c.heading}</h1><p className="muted">{c.intro}</p></div>
    <div className="injection-grid">
      <section className="injection-panel"><h2>{c.examples}</h2>
        <div className="mode-tabs two" role="group" aria-label={c.robot}>{robots.map((key) => <button type="button" key={key} aria-pressed={robot === key} onClick={() => { if (key !== robot) { invalidate(); setRobot(key); } }}>{c.robots[key]}</button>)}</div>
        <div className="ticket-examples" style={{ marginTop: "0.6rem" }}>{EXAMPLES.filter((example) => example.robot === robot).map((example) => <button type="button" key={example.id} className={exampleId === example.id ? "active" : ""} onClick={() => choose(example.id)}><strong>{example.id}</strong><span>{example.title[lang]}</span></button>)}</div>
        <form className="injection-form" onSubmit={submit}>
          <div className="mail-pane incoming"><label htmlFor="parts-symptom">{c.symptom}<small>{symptom.length}/1500</small></label><textarea id="parts-symptom" maxLength={1500} placeholder={c.placeholder} value={symptom} onChange={(event) => { invalidate(); setSymptom(event.target.value); }} /></div>
          <div className="injection-actions"><button className="injection-primary" type="submit" disabled={pending || symptom.trim().length < 3 || backend.state !== "ready"}>{pending ? c.working : c.run}</button><button type="button" disabled={pending || symptom.trim().length < 3 || !jevReady} onClick={() => void run(["laya", "jev"])}>{c.compare}</button></div>
        </form>
      </section>
      <section className={`injection-panel parts-results ${pending ? "is-busy" : ""}`} aria-live="polite"><h2>{c.result}</h2>
        {shown.length === 0 && <div className="parts-idle"><RobotSchema robot={robot} parts={null} busy={pending} focus={null} onFocus={() => {}} /><p className="muted">{pending ? c.busy : c.empty}</p></div>}
        <div className={shown.length > 1 ? "stage-cols" : undefined}>
          {shown.map((model) => {
            const item = results[model]!;
            if ("error" in item) return <article className="injection-result" key={model}><h3>{ENGINE_NAMES[model]}</h3><p className="error">{errorText(item.error, t, c.error)}</p></article>;
            return <article className="ticket-result" key={model}>
              <div className="stage-head"><h3>{ENGINE_NAMES[model]}</h3><span>{Math.round(item.elapsed_ms)} ms</span></div>
              <div className="parts-stage">
                <RobotSchema robot={item.robot} parts={item.parts} busy={false} focus={focus} onFocus={setFocus} />
                <div className="parts-list"><h4>{c.ranking}</h4>
                  <ol className="ticket-options">{item.parts.map((part, index) => <li key={part.id} className={`ticket-option${index < 3 && part.score >= 0.15 ? " selected" : ""}${focus === part.id ? " focus" : ""}`} onMouseEnter={() => setFocus(part.id)} onMouseLeave={() => setFocus(null)}>
                    <span>{index < 3 && part.score >= 0.15 && <b className="rank-dot">{index + 1}</b>}{part.name}{part.score >= item.threshold && <em className="likely-tag">{c.likely}</em>}</span><strong>{percent(part.score)}%</strong><div className="ticket-bar"><span style={{ width: `${part.score * 100}%` }} /></div>
                  </li>)}</ol>
                </div>
              </div>
              {item.likely.length === 0 && <p className="small muted">{c.noneLikely}</p>}
              <p className="small muted ticket-note">{c.rule(percent(item.threshold))} {c.note}</p>
              <details className="stage-more"><summary>{c.details}</summary>
                <CostScale engine={model} cost={item.cost} usage={item.model_response.usage} lang={lang} />
                <div className="ticket-json"><h4>{c.json}</h4><details><summary>{c.http}</summary><pre>{JSON.stringify({ method: "POST", path: "/api/parts/locate", body: { symptom, robot, lang, engine: model } }, null, 2)}</pre></details><details><summary>{c.sent}</summary><pre>{JSON.stringify(item.model_request, null, 2)}</pre></details><details><summary>{c.received}</summary><pre>{JSON.stringify(item.model_response, null, 2)}</pre></details></div>
              </details>
            </article>;
          })}
        </div>
      </section>
    </div>
  </main>;
}
