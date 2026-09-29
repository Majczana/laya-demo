import { useEffect, useRef, useState, type FormEvent } from "react";
import { errorText, isAbort, postJson } from "./api";
import { ENGINE_NAMES, useEngine, type Engine } from "./engine";
import { useI18n, type Lang } from "./i18n";
import { CostScale } from "./CostScale";
import { StageEmpty } from "./Stage";

const PRIORITIES = ["P1", "P2", "P3", "P4"];
const ticketGlyph = <svg viewBox="0 0 48 48"><path d="M8 14h32v8a3 3 0 0 0 0 6v8H8v-8a3 3 0 0 0 0-6z" /><path d="M20 18v12M26 18v12" strokeDasharray="2 3" /></svg>;

const EXAMPLES: { id: string; title: Record<Lang, string>; ticket: Record<Lang, string> }[] = [
  { id: "A", title: { pl: "Awaria i bezpieczeństwo", en: "Fault and safety" }, ticket: {
    pl: "Dzień dobry, nasz BellaBot nr BB-204 w restauracji przy ul. Lipowej nagle skręca w stronę gości i nie zatrzymuje się przed krzesłami. Wyłączyliśmy go. Prosimy o pilny przyjazd technika i informację, czy może być uszkodzony czujnik przeszkód.",
    en: "Hello, our BellaBot BB-204 at the Lipowa restaurant suddenly turns toward guests and does not stop before chairs. We powered it down. Please send a technician urgently and advise whether an obstacle sensor might be faulty.",
  } },
  { id: "B", title: { pl: "Robot nie ładuje", en: "Robot will not charge" }, ticket: {
    pl: "Nasz robot z trzema otwartymi tacami do rozwożenia dań od wczoraj nie ładuje się w stacji i nie może rozpocząć dostaw. Kabel wygląda dobrze. Prosimy o naprawę i kontakt w sprawie wizyty.",
    en: "Our restaurant robot with three open food trays has not charged at its dock since yesterday and cannot start deliveries. The cable looks fine. Please arrange a repair and contact us about a visit.",
  } },
  { id: "C", title: { pl: "Mapa i łączność", en: "Map and connection" }, ticket: {
    pl: "Robot z ekranem reklamowym w holu hotelowym po zmianie układu mebli gubi trasę do recepcji. Urządzenie działa, ale musimy je ręcznie prowadzić. Czy możecie pomóc zdalnie z mapą i konfiguracją?",
    en: "The robot with an advertising screen in our hotel lobby loses the route to reception after a furniture change. It still runs, but we must guide it manually. Could you help remotely with the map and configuration?",
  } },
  { id: "D", title: { pl: "Umowa i gwarancja", en: "Contract and warranty" }, ticket: {
    pl: "Mamy BellaBot Pro, numer BB-310. Proszę wyjaśnić, czy nasza umowa serwisowa obejmuje wymianę akumulatora i przesłać kopię faktury za ostatni miesiąc. Robot działa normalnie.",
    en: "We have BellaBot Pro BB-310. Please clarify whether our service contract covers a battery replacement and send a copy of last month's invoice. The robot is operating normally.",
  } },
  { id: "E", title: { pl: "Informacja bez awarii", en: "Information only" }, ticket: {
    pl: "Dzień dobry, proszę o kopię faktury za szkolenie zespołu oraz adres e-mail działu rozliczeń. Nie zgłaszamy żadnego urządzenia ani awarii.",
    en: "Hello, please send a copy of the invoice for staff training and the billing department's email address. This is not about any device or fault.",
  } },
  { id: "F", title: { pl: "Robot czyszczący", en: "Cleaning robot" }, ticket: {
    pl: "PUDU CC1, numer CC1-061, przestał podawać wodę podczas mycia podłogi. Zbiornik jest pełny, ale pod robotem pozostaje sucha posadzka. Prosimy o diagnostykę układu podawania wody; pozostałe tryby działają.",
    en: "PUDU CC1, serial CC1-061, has stopped dispensing water while scrubbing the floor. The tank is full but the floor remains dry. Please diagnose the water delivery system; other modes still work.",
  } },
  { id: "G", title: { pl: "Mycie bez nazwy modelu", en: "Floor washing, no model" }, ticket: {
    pl: "Wasz robot podczas mycia posadzki przestał podawać wodę. Zbiornik jest pełny, a szczotki się obracają, ale podłoga pozostaje sucha. Nie mamy teraz pod ręką tabliczki znamionowej. Prosimy o diagnostykę.",
    en: "Your robot stopped dispensing water while scrubbing the floor. The tank is full and the brushes rotate, but the floor stays dry. We cannot access the model plate right now. Please diagnose it.",
  } },
  { id: "H", title: { pl: "Mały CVTE C3", en: "Small CVTE C3" }, ticket: {
    pl: "CVTE C3 w wąskim korytarzu odkurza, ale po przełączeniu na mycie pozostawia suchą podłogę. Prosimy o sprawdzenie układu wody.",
    en: "The CVTE C3 in our narrow corridor vacuums normally, but the floor stays dry in washing mode. Please check the water system.",
  } },
];

type Group = { selected: string | null; scores: Record<string, number>; labels: Record<string, string> };
type RobotIdentity = { selected: string | null; suggested: string | null; status: "explicit" | "inferred" | "unclear" | "none"; confidence: number; presence_score: number; family: string | null; scores: Record<string, number>; labels: Record<string, string> };
type Triage = {
  engine: Engine;
  model: string;
  elapsed_ms: number;
  priority: string;
  priority_review_required: boolean;
  part_gate: { score: number; checked: boolean; threshold: number };
  robot_identity: RobotIdentity;
  groups: Record<"intent" | "category" | "urgency" | "department" | "part", Group>;
  cost: { usd: number | null; source: "local_api" | "provider" | "unreported" };
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  model_request: unknown;
  model_response: unknown;
};

const COPY = {
  pl: {
    heading: "Klasyfikacja zgłoszeń PUDU", intro: "Jedno zgłoszenie, wiele decyzji. Wybierz przypadek lub wpisz własny ticket klienta.",
    examples: "Przykładowe zgłoszenia", own: "Własne zgłoszenie", input: "Treść zgłoszenia klienta", placeholder: "Model robota, numer seryjny, objawy, wpływ na pracę i prośba klienta…",
    run: "Klasyfikuj wybranym modelem", compare: "Porównaj oba modele", working: "Klasyfikuję…", result: "Wyniki klasyfikacji", empty: "Wybierz przykład lub wpisz zgłoszenie, następnie uruchom klasyfikację.",
    priority: "Priorytet", priorityRule: "P1 bezpieczeństwo · P2 praca zablokowana · P3 obejście istnieje · P4 pytanie lub informacja", reviewPriority: "Wstępny wybór · sprawdź ręcznie (wynik poniżej 65%)", noPart: "Brak wyraźnej sugestii części (próg 50%)", skippedPart: "Nie sprawdzano części — zgłoszenie nie wskazuje dostatecznie na usterkę podzespołu.", partGate: "Ocena potrzeby sprawdzenia części", robot: "Model robota / urządzenia", noneRobot: "Nie dotyczy żadnego robota · 0%", unclearRobot: "Niejasny model — potwierdź z klientem", explicitRobot: "Nazwa podana wprost w zgłoszeniu", inferredRobot: "Model wywnioskowany z opisu", suggestedRobot: "Najbardziej prawdopodobny",
    groups: { intent: "Intencja klienta", category: "Kategoria sprawy", urgency: "Pilność", department: "Dział docelowy", part: "Możliwa część" },
    score: "Wyniki modelu", note: "Intencja, kategoria, pilność i dział to rozkłady wyboru. Identyfikacja modelu z opisu może być niepewna; 100% przy jawnej nazwie wynika z odczytania tekstu. Części są oceniane w drugim kroku tylko wtedy, gdy model wskazuje objawy usterki podzespołu (próg 50%). Procenty nie mierzą prawdopodobieństwa poprawnej diagnozy. Część wymaga potwierdzenia przez serwis.",
    json: "Dane i odpowiedź modelu", http: "Żądanie HTTP", sent: "JSON przekazany modelowi", received: "Surowa odpowiedź modelu", error: "Klasyfikacja nie powiodła się.",
    demo: "Kategorie i części to przykładowy schemat triage, nie oficjalny katalog PUDU ani diagnoza serwisowa.",
  },
  en: {
    heading: "PUDU ticket triage", intro: "One ticket, multiple decisions. Choose a case or write your own customer ticket.",
    examples: "Example tickets", own: "Your own ticket", input: "Customer ticket", placeholder: "Robot model, serial number, symptoms, operational impact and customer request…",
    run: "Classify with selected model", compare: "Compare both models", working: "Classifying…", result: "Classification results", empty: "Choose an example or enter a ticket, then run classification.",
    priority: "Priority", priorityRule: "P1 safety · P2 work blocked · P3 workaround exists · P4 question or information", reviewPriority: "Provisional choice · review manually (score below 65%)", noPart: "No clear part suggestion (50% threshold)", skippedPart: "Parts not checked — the ticket does not sufficiently indicate a component fault.", partGate: "Need to check parts", robot: "Robot / device model", noneRobot: "No robot involved · 0%", unclearRobot: "Unclear model — confirm with customer", explicitRobot: "Model explicitly named in ticket", inferredRobot: "Model inferred from description", suggestedRobot: "Most likely",
    groups: { intent: "Customer intent", category: "Issue category", urgency: "Urgency", department: "Destination team", part: "Possible part" },
    score: "Model scores", note: "Intent, category, urgency and team are choice distributions. Model identification from context may be uncertain; 100% for an explicit name comes from reading the text. Parts are scored in a second step only when the model indicates component-fault symptoms (50% threshold). Percentages are not probabilities of a correct diagnosis. Service must confirm any part.",
    json: "Model data and answer", http: "HTTP request", sent: "JSON passed to model", received: "Raw model response", error: "Classification failed.",
    demo: "Categories and parts form an example triage schema, not an official PUDU parts catalog or service diagnosis.",
  },
};

const GROUPS = ["intent", "category", "urgency", "department", "part"] as const;

export function TicketDemo() {
  const { lang, t } = useI18n();
  const c = COPY[lang];
  const { backend, engine } = useEngine();
  const [ticket, setTicket] = useState("");
  const [exampleId, setExampleId] = useState<string | null>(null);
  const [results, setResults] = useState<Partial<Record<Engine, Triage | { error: unknown }>>>({});
  const [pending, setPending] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const jevReady = backend.state === "ready" && backend.health.engines.jev.available;
  useEffect(() => () => requestRef.current?.abort(), []);

  function changeTicket(value: string, id: string | null) {
    requestRef.current?.abort();
    setPending(false);
    setTicket(value);
    setExampleId(id);
    setResults({});
  }

  async function run(models: Engine[]) {
    if (!ticket.trim() || pending) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true);
    setResults({});
    const settled = await Promise.allSettled(models.map((model) => postJson<Triage>("/tickets/triage", { ticket, lang, engine: model }, controller.signal)));
    if (controller.signal.aborted) return;
    const next: Partial<Record<Engine, Triage | { error: unknown }>> = {};
    settled.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") next[models[index]] = outcome.value;
      else if (!isAbort(outcome.reason)) next[models[index]] = { error: outcome.reason };
    });
    setResults(next);
    setPending(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void run([engine]); }
  const shown = (["laya", "jev"] as Engine[]).filter((model) => results[model]);
  return <main className="ticket-page">
    <div className="injection-heading"><p className="eyebrow">04 / MULTI-DECISION</p><h1>{c.heading}</h1><p className="muted">{c.intro}</p></div>
    <div className="injection-grid">
      <section className="injection-panel">
        <h2>{c.examples}</h2>
        <div className="ticket-examples">{EXAMPLES.map((example) => <button key={example.id} type="button" className={exampleId === example.id ? "active" : ""} onClick={() => changeTicket(example.ticket[lang], example.id)}><strong>{example.id}</strong><span>{example.title[lang]}</span></button>)}</div>
        <form className="injection-form" onSubmit={submit}>
          <label htmlFor="ticket-input">{exampleId ? `${exampleId} · ${c.input}` : c.own}</label>
          <textarea id="ticket-input" value={ticket} maxLength={6000} placeholder={c.placeholder} onChange={(event) => changeTicket(event.target.value, null)} />
          <span className="injection-limit">{ticket.length}/6000</span>
          <div className="injection-actions"><button className="injection-primary" type="submit" disabled={pending || !ticket.trim() || backend.state !== "ready"}>{pending ? c.working : c.run}</button><button type="button" disabled={pending || !ticket.trim() || !jevReady} onClick={() => void run(["laya", "jev"])}>{c.compare}</button></div>
        </form>
      </section>
      <section className={`injection-panel ticket-results ${pending ? "is-busy" : ""}`} aria-live="polite">
        <h2>{c.result}</h2>
        {shown.length === 0 && <StageEmpty busy={pending} idle={c.empty} working={c.working} glyph={ticketGlyph} />}
        <div className={shown.length > 1 ? "stage-cols" : undefined}>
          {shown.map((model) => {
            const item = results[model]!;
            if ("error" in item) return <article className="injection-result" key={model}><h3>{ENGINE_NAMES[model]}</h3><p className="error">{errorText(item.error, t, c.error)}</p></article>;
            const identity = item.robot_identity;
            const robotName = identity.selected ? identity.labels[identity.selected] : identity.suggested ? `${c.suggestedRobot}: ${identity.labels[identity.suggested]}` : null;
            return <article className="ticket-result" key={model}>
              <div className="stage-head"><h3>{ENGINE_NAMES[model]}</h3><span>{Math.round(item.elapsed_ms)} ms</span></div>
              <div className="triage-top">
                <div className="triage-urgency"><small className="muted">{c.priority}</small><strong>{item.groups.urgency.labels[item.groups.urgency.selected ?? ""]}</strong></div>
                <div className="priority-scale" role="img" aria-label={`${c.priority}: ${item.priority}`}>{PRIORITIES.map((level) => <span key={level} className={level === item.priority ? `on p${level.slice(1)}` : ""}>{level}</span>)}</div>
                {item.priority_review_required && <p className="ticket-review small">{c.reviewPriority}</p>}
                <p className="small muted">{c.priorityRule}</p>
              </div>
              <div className="triage-robot">
                <small className="muted">{c.robot}</small>
                {identity.status === "none" ? <p className="small muted">{c.noneRobot}</p> : <>
                  {robotName && <div className="decision-pick"><strong>{robotName}</strong><span>{Math.round(identity.confidence * 100)}%</span></div>}
                  <p className="small muted">{identity.status === "explicit" ? c.explicitRobot : identity.status === "inferred" ? c.inferredRobot : c.unclearRobot}</p>
                  <details className="stage-more" open><summary>{c.score}</summary><div className="ticket-options">{Object.entries(identity.scores).sort((a, b) => b[1] - a[1]).map(([key, score]) => <div className={key === identity.selected ? "ticket-option selected" : "ticket-option"} key={key}><span>{identity.labels[key] ?? (lang === "pl" ? "nie da się ustalić modelu" : "model unknown")}</span><strong>{Math.round(score * 100)}%</strong><div className="ticket-bar"><span style={{ width: `${score * 100}%` }} /></div></div>)}</div></details>
                </>}
              </div>
              <div className="decision-grid">
                {GROUPS.filter((groupKey) => groupKey !== "urgency").map((groupKey) => {
                  const group = item.groups[groupKey];
                  const ranked = Object.entries(group.scores).sort((a, b) => b[1] - a[1]);
                  const [topKey, topScore] = ranked[0] ?? ["", 0];
                  const skipped = groupKey === "part" && !item.part_gate.checked;
                  const winner = group.selected ?? (groupKey === "part" ? null : topKey);
                  return <div className="decision-card" key={groupKey}>
                    <h4>{c.groups[groupKey]}</h4>
                    {groupKey === "part" && <small className="muted">{c.partGate}: {Math.round(item.part_gate.score * 100)}%</small>}
                    {skipped ? <p className="small muted">{c.skippedPart}</p> : <>
                      {winner === null ? <p className="small muted">{c.noPart}</p> : <>
                        <div className="decision-pick"><strong>{group.labels[winner]}</strong><span>{Math.round((group.scores[winner] ?? topScore) * 100)}%</span></div>
                        <div className="ticket-bar"><span style={{ width: `${(group.scores[winner] ?? topScore) * 100}%` }} /></div>
                      </>}
                      <details open><summary>{c.score}</summary><div className="ticket-options">{ranked.map(([key, score]) => <div className={key === group.selected ? "ticket-option selected" : "ticket-option"} key={key}><span>{group.labels[key]}</span><strong>{Math.round(score * 100)}%</strong><div className="ticket-bar"><span style={{ width: `${score * 100}%` }} /></div></div>)}</div></details>
                    </>}
                  </div>;
                })}
              </div>
              <p className="small muted ticket-note">{c.note}</p>
              <details className="stage-more"><summary>{c.json}</summary>
                <CostScale engine={model} cost={item.cost} usage={item.usage ?? undefined} lang={lang} />
                <div className="ticket-json">
                  <details><summary>{c.http}</summary><pre>{JSON.stringify({ method: "POST", path: "/api/tickets/triage", body: { ticket, lang, engine: model } }, null, 2)}</pre></details>
                  <details><summary>{c.sent}</summary><pre>{JSON.stringify(item.model_request, null, 2)}</pre></details>
                  <details><summary>{c.received}</summary><pre>{JSON.stringify(item.model_response, null, 2)}</pre></details>
                </div>
              </details>
            </article>;
          })}
        </div>
      </section>
    </div>
    <p className="small muted ticket-disclaimer">{c.demo}</p>
  </main>;
}
