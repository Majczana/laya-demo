import { useEffect, useRef, useState, type FormEvent } from "react";
import { errorText, isAbort, postJson } from "./api";
import { ENGINE_NAMES, useEngine, type Engine } from "./engine";
import { useI18n, type Lang } from "./i18n";
import { CostScale } from "./CostScale";
import { Dial, ScoreTrack, StageEmpty } from "./Stage";

const repairGlyph = <svg viewBox="0 0 48 48"><path d="M30 8a9 9 0 0 0-8 12L9 33a4 4 0 0 0 6 6l13-13a9 9 0 0 0 12-8l-6 3-4-4z" /></svg>;

type Criterion = { id: string; name: string; question: string; levels: [string, string, string] };
type Source = { description: string; technician_note: string; history: string };

const DEFAULTS: Record<Lang, Criterion[]> = {
  pl: [
    { id: "complexity", name: "Złożoność naprawy", question: "Jak złożona jest opisana naprawa robota na podstawie wszystkich trzech pól?", levels: ["Prosta, lokalna czynność lub wymiana bez demontażu", "Kilka kroków diagnostycznych lub wymiana modułu", "Wiele podsystemów, trudna diagnoza lub rozległy demontaż"] },
    { id: "repair_risk", name: "Ryzyko naprawy", question: "Jak duże jest ryzyko techniczne lub bezpieczeństwa przy opisanej naprawie?", levels: ["Niskie ryzyko i łatwy powrót do stanu wyjściowego", "Umiarkowane ryzyko wymagające kontroli i testów", "Wysokie ryzyko uszkodzenia, porażenia lub zagrożenia dla ludzi"] },
    { id: "effort", name: "Pracochłonność", question: "Jak dużo czasu i pracy może wymagać opisana naprawa, według dostępnych informacji?", levels: ["Krótka czynność, około godziny lub mniej", "Kilka godzin pracy lub potrzebna wizyta", "Dłuższa praca, wiele etapów lub zależność od części"] },
    { id: "bad_practice", name: "Ryzyko złych praktyk", question: "Czy opisany plan naprawy zawiera niebezpieczne skróty lub pominięcie właściwych procedur?", levels: ["Nie wskazuje złych praktyk; plan przewiduje kontrolę", "Niejasne kroki lub brak części ważnych testów", "Pomija zabezpieczenia, testy lub zaleca niebezpieczne obejście"] },
    { id: "impact", name: "Wpływ na pracę", question: "Jak mocno problem i naprawa wpływają na bieżącą pracę robota?", levels: ["Niewielki wpływ; robot może pracować", "Ograniczona funkcjonalność lub dostępne obejście", "Robot musi pozostać wyłączony lub nie wykonuje zadania"] },
  ],
  en: [
    { id: "complexity", name: "Repair complexity", question: "How complex is the robot repair described across all three fields?", levels: ["Simple local task or replacement without disassembly", "Several diagnostic steps or module replacement", "Multiple subsystems, difficult diagnosis or extensive disassembly"] },
    { id: "repair_risk", name: "Repair risk", question: "How high is the technical or safety risk of the described repair?", levels: ["Low risk and easy rollback", "Moderate risk requiring checks and tests", "High risk of damage, electric shock or harm to people"] },
    { id: "effort", name: "Work estimate", question: "How much time and effort might the repair require based on available information?", levels: ["Short task, about an hour or less", "Several hours or an on-site visit", "Longer multi-stage work or parts dependency"] },
    { id: "bad_practice", name: "Unsafe practice risk", question: "Does the described repair plan use unsafe shortcuts or skip proper procedures?", levels: ["No unsafe practice indicated; checks are planned", "Steps are unclear or some important tests are missing", "Safety measures or tests are skipped, or an unsafe workaround is advised"] },
    { id: "impact", name: "Operational impact", question: "How much do the fault and repair affect the robot's current work?", levels: ["Minor impact; robot can work", "Limited function or a workaround is available", "Robot must remain off or cannot perform its task"] },
  ],
};

const EXAMPLES: { id: string; title: Record<Lang, string>; source: Record<Lang, Source> }[] = [
  { id: "A", title: { pl: "Prosta wymiana", en: "Simple replacement" }, source: {
    pl: { description: "BellaBot: uszkodzona zewnętrzna osłona tacy, robot działa normalnie. Klient prosi o wymianę przy najbliższym przeglądzie.", technician_note: "Osłona jest dostępna; wymiana bez otwierania obudowy. Po montażu sprawdzić mocowanie i czujnik tacy.", history: "Brak podobnych usterek." },
    en: { description: "BellaBot: outer tray cover damaged, robot works normally. Customer requests replacement at the next inspection.", technician_note: "Cover is available; replacement without opening the chassis. Check fit and tray sensor afterward.", history: "No similar faults." },
  } },
  { id: "B", title: { pl: "Ładowanie", en: "Charging fault" }, source: {
    pl: { description: "PuduBot 2 nie ładuje się na stacji, dostawy wstrzymane.", technician_note: "Sprawdzić styki, zasilacz i logi ładowania. Nie wymieniać akumulatora przed pomiarem napięcia i testem stacji.", history: "Dwa krótkie zaniki ładowania w ostatnim tygodniu." },
    en: { description: "PuduBot 2 does not charge at its dock; deliveries are paused.", technician_note: "Check contacts, power supply and charging logs. Do not replace battery before voltage measurement and dock test.", history: "Two brief charging interruptions last week." },
  } },
  { id: "C", title: { pl: "Nawigacja i bezpieczeństwo", en: "Navigation and safety" }, source: {
    pl: { description: "BellaBot zbliża się do ludzi bez zatrzymania. Robot został wyłączony.", technician_note: "Podejrzenie czujnika przeszkód lub kalibracji. Plan: izolacja zasilania, diagnostyka czujników, test w zamkniętej strefie przed powrotem do pracy.", history: "Po niedawnej zmianie układu sali pojawiały się sporadyczne alarmy nawigacji." },
    en: { description: "BellaBot approaches people without stopping. The robot has been powered down.", technician_note: "Suspect obstacle sensor or calibration. Plan: isolate power, diagnose sensors, test in a closed area before returning to service.", history: "Intermittent navigation alerts followed a recent room layout change." },
  } },
  { id: "D", title: { pl: "Zły skrót naprawczy", en: "Unsafe shortcut" }, source: {
    pl: { description: "PUDU CC1 nie podaje wody, zbiornik jest pełny.", technician_note: "Ktoś proponuje ominąć czujnik poziomu i uruchomić pompę bez sprawdzenia szczelności, żeby szybko wznowić sprzątanie.", history: "Poprzednio zgłaszano wyciek przy stacji uzupełniania wody." },
    en: { description: "PUDU CC1 does not dispense water despite a full tank.", technician_note: "Someone proposes bypassing the level sensor and starting the pump without a leak check to resume cleaning quickly.", history: "A leak at the water refill station was reported previously." },
  } },
];

type ScoreResult = { name: string; score: number; levels: string[]; probabilities: Record<string, number>; confidence: number | null };
type Response = {
  engine: Engine; model: string; elapsed_ms: number; results: ScoreResult[];
  cost: { usd: number | null; source: "local_api" | "provider" | "unreported" };
  model_request: unknown; model_response: { usage?: { input_tokens?: number; output_tokens?: number }; [key: string]: unknown };
};

const COPY = {
  pl: {
    heading: "Ocena zadania serwisowego", intro: "Model ocenia każde kryterium w skali 0–2 na podstawie opisu klienta, notatki technika i historii. Dodaj własne kryterium bez zmiany kodu.",
    examples: "Przykłady", sources: ["Opis klienta", "Notatka technika / plan naprawy", "Historia serwisowa"], own: "Własny opis", criteria: "Kryteria oceny", add: "Dodaj kryterium", remove: "Usuń", name: "Nazwa kryterium", question: "Pytanie do modelu", levels: ["Poziom 0", "Poziom 1", "Poziom 2"],
    namePlaceholder: "np. Dostępność części", questionPlaceholder: "np. Jak trudne będzie zdobycie potrzebnych części?", levelPlaceholders: ["Część na miejscu", "Część do zamówienia", "Nieznana lub trudno dostępna część"],
    run: "Oceń wybranym modelem", compare: "Porównaj oba modele", working: "Oceniam…", result: "Wyniki 0–2", empty: "Wybierz przykład lub wpisz opis, a potem uruchom ocenę.",
    mean: "średni wynik", scale: "Wyższy wynik = większa złożoność, ryzyko lub wpływ. Paski poniżej pokazują rozkład poziomów 0 · 1 · 2 (zielony, żółty, czerwony).", levelsSummary: "Opisy poziomów",
    confidence: "Pewność rozkładu", note: "Wynik to średnia ważona poziomów 0, 1 i 2. Procenty pokazują rozkład poziomów, nie prawdopodobieństwo poprawnej diagnozy. Czas i ryzyko wymagają weryfikacji serwisowej.",
    json: "Wysłane i odebrane JSON", http: "POST do backendu", sent: "Sent · żądanie do modelu", received: "Received · surowa odpowiedź modelu", error: "Ocena nie powiodła się.",
  },
  en: {
    heading: "Service repair scoring", intro: "The model scores each criterion from 0 to 2 using the customer description, technician note and service history. Add a criterion without changing code.",
    examples: "Examples", sources: ["Customer description", "Technician note / repair plan", "Service history"], own: "Your own description", criteria: "Scoring criteria", add: "Add criterion", remove: "Remove", name: "Criterion name", question: "Question for the model", levels: ["Level 0", "Level 1", "Level 2"],
    namePlaceholder: "e.g. Parts availability", questionPlaceholder: "e.g. How hard will it be to obtain the needed parts?", levelPlaceholders: ["Part on site", "Part must be ordered", "Unknown or hard-to-find part"],
    run: "Score with selected model", compare: "Compare both models", working: "Scoring…", result: "Scores 0–2", empty: "Choose an example or enter a description, then run scoring.",
    mean: "mean score", scale: "A higher score means more complexity, risk or impact. The bars below show the level distribution 0 · 1 · 2 (green, amber, red).", levelsSummary: "Level descriptions",
    confidence: "Distribution confidence", note: "The score is a probability-weighted average of levels 0, 1 and 2. Percentages show the level distribution, not the probability of a correct diagnosis. Time and risk need service review.",
    json: "Sent and received JSON", http: "POST to backend", sent: "Sent · model request", received: "Received · raw model response", error: "Scoring failed.",
  },
};

const EMPTY: Source = { description: "", technician_note: "", history: "" };

export function RepairScoreDemo() {
  const { lang, t } = useI18n();
  const c = COPY[lang];
  const { backend, engine } = useEngine();
  const [source, setSource] = useState<Source>(EMPTY);
  const [selectedExample, setSelectedExample] = useState<string | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>(() => DEFAULTS[lang]);
  const [draft, setDraft] = useState({ name: "", question: "", levels: ["", "", ""] as [string, string, string] });
  const [results, setResults] = useState<Partial<Record<Engine, Response | { error: unknown }>>>({});
  const [pending, setPending] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const jevReady = backend.state === "ready" && backend.health.engines.jev.available;
  useEffect(() => () => requestRef.current?.abort(), []);

  function invalidate() { requestRef.current?.abort(); setPending(false); setResults({}); }
  function setExample(id: string, value: Source) { invalidate(); setSelectedExample(id); setSource(value); }
  function editSource(key: keyof Source, value: string) { invalidate(); setSelectedExample(null); setSource((current) => ({ ...current, [key]: value })); }
  function addCriterion() {
    if (criteria.length >= 8 || !draft.name.trim() || draft.question.trim().length < 5 || draft.levels.some((level) => !level.trim())) return;
    invalidate();
    setCriteria((current) => [...current, { id: `custom_${Date.now()}`, name: draft.name.trim(), question: draft.question.trim(), levels: draft.levels.map((level) => level.trim()) as [string, string, string] }]);
    setDraft({ name: "", question: "", levels: ["", "", ""] });
  }

  async function run(models: Engine[]) {
    if (!source.description.trim() || criteria.length === 0 || pending) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true);
    setResults({});
    const body = { ...source, criteria: criteria.map(({ name, question, levels }) => ({ name, question, levels })) };
    const settled = await Promise.allSettled(models.map((model) => postJson<Response>("/repairs/score", { ...body, engine: model }, controller.signal)));
    if (controller.signal.aborted) return;
    const next: Partial<Record<Engine, Response | { error: unknown }>> = {};
    settled.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") next[models[index]] = outcome.value;
      else if (!isAbort(outcome.reason)) next[models[index]] = { error: outcome.reason };
    });
    setResults(next);
    setPending(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void run([engine]); }
  const shown = (["laya", "jev"] as Engine[]).filter((model) => results[model]);

  return <main className="ticket-page repair-page">
    <div className="injection-heading"><p className="eyebrow">05 / SCORE</p><h1>{c.heading}</h1><p className="muted">{c.intro}</p></div>
    <div className="injection-grid">
      <section className="injection-panel">
        <h2>{c.examples}</h2>
        <div className="ticket-examples">{EXAMPLES.map((example) => <button type="button" key={example.id} className={selectedExample === example.id ? "active" : ""} onClick={() => setExample(example.id, example.source[lang])}><strong>{example.id}</strong><span>{example.title[lang]}</span></button>)}</div>
        <form className="injection-form" onSubmit={submit}>
          {(["description", "technician_note", "history"] as const).map((key, index) => <div className="repair-source" key={key}><label htmlFor={`repair-${key}`}>{c.sources[index]}</label><textarea id={`repair-${key}`} value={source[key]} maxLength={4000} onChange={(event) => editSource(key, event.target.value)} /></div>)}
          <div className="repair-criteria"><h2>{c.criteria} <span className="small muted">{criteria.length}/8</span></h2>
            <div className="repair-criterion-list">{criteria.map((criterion) => <div key={criterion.id}><span><strong>{criterion.name}</strong><small>{criterion.question}</small></span><button type="button" onClick={() => { invalidate(); setCriteria((current) => current.filter((item) => item.id !== criterion.id)); }}>{c.remove}</button></div>)}</div>
            {criteria.length < 8 && <div className="repair-add"><input aria-label={c.name} value={draft.name} maxLength={60} placeholder={c.namePlaceholder} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /><input aria-label={c.question} value={draft.question} maxLength={300} placeholder={c.questionPlaceholder} onChange={(event) => setDraft((current) => ({ ...current, question: event.target.value }))} />
              <div className="repair-level-inputs">{draft.levels.map((level, index) => <input key={index} aria-label={c.levels[index]} value={level} maxLength={120} placeholder={`${c.levels[index]} · ${c.levelPlaceholders[index]}`} onChange={(event) => setDraft((current) => ({ ...current, levels: current.levels.map((item, i) => i === index ? event.target.value : item) as [string, string, string] }))} />)}</div>
              <button type="button" onClick={addCriterion} disabled={!draft.name.trim() || draft.question.trim().length < 5 || draft.levels.some((level) => !level.trim())}>+ {c.add}</button>
            </div>}
          </div>
          <div className="injection-actions"><button className="injection-primary" type="submit" disabled={pending || !source.description.trim() || criteria.length === 0 || backend.state !== "ready"}>{pending ? c.working : c.run}</button><button type="button" disabled={pending || !source.description.trim() || criteria.length === 0 || !jevReady} onClick={() => void run(["laya", "jev"])}>{c.compare}</button></div>
        </form>
      </section>
      <section className={`injection-panel repair-results ${pending ? "is-busy" : ""}`} aria-live="polite"><h2>{c.result}</h2>
        {shown.length === 0 && <StageEmpty busy={pending} idle={c.empty} working={c.working} glyph={repairGlyph} />}
        <div className={shown.length > 1 ? "stage-cols" : undefined}>
          {shown.map((model) => {
            const item = results[model]!;
            if ("error" in item) return <article className="injection-result" key={model}><h3>{ENGINE_NAMES[model]}</h3><p className="error">{errorText(item.error, t, c.error)}</p></article>;
            const mean = item.results.length ? item.results.reduce((sum, result) => sum + result.score, 0) / item.results.length : 0;
            return <article className="ticket-result" key={model}>
              <div className="stage-head"><h3>{ENGINE_NAMES[model]}</h3><span>{Math.round(item.elapsed_ms)} ms</span></div>
              <div className="repair-overview"><Dial value={mean / 2} tone={mean < 0.7 ? "good" : mean < 1.3 ? "warn" : "bad"} caption={c.mean} label={c.mean} /><p className="small muted">{c.scale}</p></div>
              <div className="repair-rows">{item.results.map((result, index) => {
                const levelProbability = (levelIndex: number) => result.probabilities[String(levelIndex)] ?? 0;
                return <div className="repair-score" key={index}>
                  <div className="repair-score-head"><h4>{result.name}</h4><strong>{result.score.toFixed(2)} / 2</strong></div>
                  <ScoreTrack score={result.score} max={2} tone={result.score < 0.7 ? "good" : result.score < 1.3 ? "warn" : "bad"} />
                  <div className="prob-stack" role="img" aria-label={result.levels.map((_, levelIndex) => `${levelIndex}: ${Math.round(levelProbability(levelIndex) * 100)}%`).join(", ")}>{result.levels.map((_, levelIndex) => <i key={levelIndex} style={{ width: `${levelProbability(levelIndex) * 100}%` }} />)}</div>
                  <details open><summary>{c.levelsSummary}{result.confidence !== null ? ` · ${c.confidence}: ${Math.round(result.confidence * 100)}%` : ""}</summary>
                    {result.levels.map((level, levelIndex) => <div className="ticket-option" key={levelIndex}><span>{levelIndex} · {level}</span><strong>{Math.round(levelProbability(levelIndex) * 100)}%</strong><div className="ticket-bar"><span style={{ width: `${levelProbability(levelIndex) * 100}%` }} /></div></div>)}
                  </details>
                </div>;
              })}</div>
              <p className="small muted ticket-note">{c.note}</p>
              <details className="stage-more"><summary>{c.json}</summary>
                <CostScale engine={model} cost={item.cost} usage={item.model_response.usage} lang={lang} />
                <div className="ticket-json"><details><summary>{c.http}</summary><pre>{JSON.stringify({ method: "POST", path: "/api/repairs/score", body: { ...source, criteria: criteria.map(({ name, question, levels }) => ({ name, question, levels })), engine: model } }, null, 2)}</pre></details><details><summary>{c.sent}</summary><pre>{JSON.stringify(item.model_request, null, 2)}</pre></details><details><summary>{c.received}</summary><pre>{JSON.stringify(item.model_response, null, 2)}</pre></details></div>
              </details>
            </article>;
          })}
        </div>
      </section>
    </div>
  </main>;
}
