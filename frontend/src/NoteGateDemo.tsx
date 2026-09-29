import { useEffect, useRef, useState, type FormEvent } from "react";
import { errorText, isAbort, postJson } from "./api";
import { ENGINE_NAMES, useEngine, type Engine } from "./engine";
import { useI18n, type Lang } from "./i18n";
import { CostScale } from "./CostScale";
import { CheckChip, StageEmpty } from "./Stage";

type Mode = "customer_reply" | "service_note" | "sales_note";
type Example = { id: string; mode: Mode; title: Record<Lang, string>; context: Record<Lang, string>; draft: Record<Lang, string> };

const EXAMPLES: Example[] = [
  { id: "A", mode: "customer_reply", title: { pl: "Klientka przed weselem · lakoniczna", en: "Wedding-week client · curt" }, context: {
    pl: "Od: Marta Kowalczyk <m.kowalczyk@bistro-nadwislanska.example>\nTemat: RE: RE: BellaBot znowu piszczy\n\nDzień dobry, w piątek był u nas Wasz technik i coś tam poprawiał, ale dziś rano robot znowu piszczy przy stoliku nr 4 i staje. W sobotę mamy wesele na 60 osób i nie wiem, czy w ogóle wyciągać go z magazynu. Proszę o szczerą odpowiedź, bo wolałabym zamówić dodatkową obsługę.\nMarta\n\n— notatka wewnętrzna: w piątek wymieniono czujnik przeszkód, nie skalibrowano go po zmianie układu sali. Logi z dziś rano: 3 alarmy „obstacle timeout” przy stoliku 4 (obok donicy).",
    en: "From: Marta Kowalczyk <m.kowalczyk@bistro-nadwislanska.example>\nSubject: RE: RE: BellaBot beeping again\n\nHi, your technician was here on Friday and adjusted something, but this morning the robot is beeping again at table 4 and stops. We have a wedding for 60 guests on Saturday and I don't know whether to take it out of storage at all. Please be honest, because I'd rather book extra staff.\nMarta\n\n— internal note: obstacle sensor replaced Friday, not recalibrated after the room layout changed. Logs from this morning: 3 “obstacle timeout” alarms at table 4 (next to a planter).",
  }, draft: { pl: "Dzień dobry, sprawdzimy to. Proszę się nie martwić.", en: "Hello, we will look into it. Please don't worry." } },
  { id: "B", mode: "customer_reply", title: { pl: "Klientka przed weselem · konkretna", en: "Wedding-week client · specific" }, context: {
    pl: "Od: Marta Kowalczyk <m.kowalczyk@bistro-nadwislanska.example>\nTemat: RE: RE: BellaBot znowu piszczy\n\nDzień dobry, w piątek był u nas Wasz technik i coś tam poprawiał, ale dziś rano robot znowu piszczy przy stoliku nr 4 i staje. W sobotę mamy wesele na 60 osób i nie wiem, czy w ogóle wyciągać go z magazynu. Proszę o szczerą odpowiedź, bo wolałabym zamówić dodatkową obsługę.\nMarta\n\n— notatka wewnętrzna: w piątek wymieniono czujnik przeszkód, nie skalibrowano go po zmianie układu sali. Logi z dziś rano: 3 alarmy „obstacle timeout” przy stoliku 4 (obok donicy).",
    en: "From: Marta Kowalczyk <m.kowalczyk@bistro-nadwislanska.example>\nSubject: RE: RE: BellaBot beeping again\n\nHi, your technician was here on Friday and adjusted something, but this morning the robot is beeping again at table 4 and stops. We have a wedding for 60 guests on Saturday and I don't know whether to take it out of storage at all. Please be honest, because I'd rather book extra staff.\nMarta\n\n— internal note: obstacle sensor replaced Friday, not recalibrated after the room layout changed. Logs from this morning: 3 “obstacle timeout” alarms at table 4 (next to a planter).",
  }, draft: {
    pl: "Dzień dobry Pani Marto, odpowiem wprost. W piątek wymieniliśmy czujnik przeszkód, ale nie skalibrowaliśmy go po zmianie układu sali — to nasz błąd. Dzisiejsze logi potwierdzają trzy alarmy przy stoliku 4, najpewniej przez donicę stojącą zbyt blisko trasy. Technik może być u Państwa jutro do 10:00, skalibrować czujnik i zrobić przejazd testowy z pełnym obłożeniem; wieczorem napiszę, czy robot jest gotowy na sobotę. Na wszelki wypadek proszę już dziś przesunąć donicę o około metr i zostawić sobie plan B na obsługę, dopóki nie potwierdzę. Krzysztof, tel. 600 100 200",
    en: "Dear Marta, I'll be direct. On Friday we replaced the obstacle sensor but did not recalibrate it after the room layout changed — that's on us. This morning's logs confirm three alarms at table 4, most likely because a planter sits too close to the route. A technician can be with you tomorrow by 10:00 to calibrate the sensor and run a full-occupancy test drive; I'll write this evening to say whether the robot is ready for Saturday. Meanwhile please move the planter about a metre and keep a plan B for staffing until I confirm. Krzysztof, tel. 600 100 200",
  } },
  { id: "C", mode: "customer_reply", title: { pl: "Zła gościnna sytuacja · defensywna", en: "Upset restaurant · defensive" }, context: {
    pl: "Od: Ewa Zielińska <e.zielinska@podlipa.example>\nTemat: Zupa na gościu — to już drugi raz!\n\nWczoraj BellaBot wjechał w stolik 7 i wylał zupę na gościa (na szczęście niegorąca, ale sukienka do wyrzucenia). Wasz handlowiec mówił, że robot „sam omija wszystko”. Zapłaciliśmy 11 tys. za pełny pakiet. Chcę wiedzieć, co zamierzacie z tym zrobić — i to nie w stylu „zbadamy sprawę”.\n\n— logi: robot jechał 0,9 m/s, dziecko wbiegło na trasę, robot zahamował 40 cm przed nim i skręcił w stronę stolika 7. Prędkość zmieniono we wtorek z 0,6 na 0,9 m/s (konto klienta).",
    en: "From: Ewa Zielinska <e.zielinska@podlipa.example>\nSubject: Soup on a guest — second time!\n\nYesterday BellaBot bumped into table 7 and spilled soup on a guest (luckily not hot, but the dress is ruined). Your salesperson said the robot “avoids everything by itself”. We paid 11k for the full package. I want to know what you'll do about it — and not in the “we'll investigate” way.\n\n— logs: robot ran at 0.9 m/s, a child ran onto the route, the robot braked 40 cm short and swerved towards table 7. Speed was changed on Tuesday from 0.6 to 0.9 m/s (customer account).",
  }, draft: {
    pl: "Dzień dobry, robot działa zgodnie ze specyfikacją. Wyższa prędkość została ustawiona przez Państwa, więc odpowiedzialność leży po Państwa stronie. Zachęcamy do zapoznania się z instrukcją obsługi.",
    en: "Hello, the robot operates according to its specification. The higher speed was set by you, so responsibility lies with you. We encourage you to read the user manual.",
  } },
  { id: "D", mode: "service_note", title: { pl: "SMS technika · „naprawione”", en: "Technician text · “fixed”" }, context: {
    pl: "SMS od technika (Paweł), 16:42:\n„stoje pod hotelem Ostoja. CC1 na 2 pietrze dalej nie podaje wody, zbiornik pelny, recepcja marudzi. wyjalem filtr — zatkany jakims piaskiem/kamieniem, chyba z budowy obok. przeplukalem, pompa chodzi. filtra zamiennego nie mam, zamowiony, wymiana jutro. klient chce fakture od razu, dzwonil kierownik Michalski”",
    en: "Text from the technician (Pawel), 4:42 pm:\n“standing outside hotel Ostoja. CC1 on floor 2 still not dispensing water, tank full, reception is grumbling. took out the filter — clogged with sand/grit, probably from the building site next door. flushed it, pump runs. no spare filter on me, ordered, replacement tomorrow. client wants the invoice right away, manager Michalski called”",
  }, draft: { pl: "Byłem w hotelu, naprawiłem wodę.", en: "Went to the hotel, fixed the water." } },
  { id: "E", mode: "service_note", title: { pl: "SMS technika · pełna notatka", en: "Technician text · full note" }, context: {
    pl: "SMS od technika (Paweł), 16:42:\n„stoje pod hotelem Ostoja. CC1 na 2 pietrze dalej nie podaje wody, zbiornik pelny, recepcja marudzi. wyjalem filtr — zatkany jakims piaskiem/kamieniem, chyba z budowy obok. przeplukalem, pompa chodzi. filtra zamiennego nie mam, zamowiony, wymiana jutro. klient chce fakture od razu, dzwonil kierownik Michalski”",
    en: "Text from the technician (Pawel), 4:42 pm:\n“standing outside hotel Ostoja. CC1 on floor 2 still not dispensing water, tank full, reception is grumbling. took out the filter — clogged with sand/grit, probably from the building site next door. flushed it, pump runs. no spare filter on me, ordered, replacement tomorrow. client wants the invoice right away, manager Michalski called”",
  }, draft: {
    pl: "Hotel Ostoja, CC1 (piętro 2): brak podawania wody przy pełnym zbiorniku. Przyczyna: filtr wodny zatkany osadem budowlanym (remont obok). Filtr wyjęty i przepłukany, pompa działa; test mycia bez błędu. Filtra zamiennego nie było w samochodzie — zamówiony, wymiana jutro do 12:00 (Paweł). Kierownik Michalski poinformowany i prosi o fakturę tego samego dnia → przekazać do rozliczeń. Do rozważenia: przegląd filtra co tydzień, dopóki trwa budowa.",
    en: "Hotel Ostoja, CC1 (floor 2): no water dispensed with a full tank. Cause: water filter clogged with construction grit (works next door). Filter removed and flushed, pump works; wash test ran without errors. No spare filter in the van — ordered, replacement tomorrow by 12:00 (Pawel). Manager Michalski informed and asks for the invoice the same day → pass to billing. Consider a weekly filter check while the building work continues.",
  } },
  { id: "F", mode: "service_note", title: { pl: "Notatka głosowa · bez kolejnych kroków", en: "Voice memo · no next steps" }, context: {
    pl: "Transkrypcja notatki głosowej technika:\n„no więc T300 w magazynie Logis… koła w porządku, czujnik krawędzi troszkę za czuły, bo hala ma jasne posadzki. Obniżyłem czułość z ośmiu na sześć i przejechał trasę pięć razy bez zatrzymań. Kierownik zmiany mówi, że wieczorem wchodzi nowa partia w ciemnych opakowaniach i może się zacząć zachowywać inaczej. Zdjęcia mam w telefonie, nie wgrałem do systemu.”",
    en: "Transcript of the technician's voice memo:\n“so the T300 at the Logis warehouse… wheels fine, edge sensor a bit too sensitive because the hall has light floors. I lowered sensitivity from eight to six and it ran the route five times with no stops. Shift manager says a new batch in dark packaging arrives tonight and it might behave differently. I have photos on my phone, haven't uploaded them.”",
  }, draft: {
    pl: "T300 Logis: czujnik krawędzi był zbyt czuły na jasnych posadzkach. Obniżyłem czułość z 8 na 6, pięć przejazdów trasy bez zatrzymań.",
    en: "T300 Logis: edge sensor was too sensitive on light floors. Lowered sensitivity from 8 to 6, five route runs without stops.",
  } },
  { id: "G", mode: "sales_note", title: { pl: "Mail od dyrektora hoteli · „zainteresowany”", en: "Hotel-group email · “interested”" }, context: {
    pl: "Od: Jan Wrona <j.wrona@gorskidwor.example>\nTemat: Roboty do room service?\n\nPo targach w Kielcach zostałem z Waszą wizytówką. Mamy 3 hotele po ok. 80 pokoi, room service kuleje w nocy — 2 osoby na zmianie. Ile kosztowałby test w jednym hotelu? Winda jest jedna, stara (Schindler, 2004) — czy to problem? Budżet na innowacje mam do końca października, potem wraca do pani prezes. Może być rozmowa we wtorek po 14.",
    en: "From: Jan Wrona <j.wrona@gorskidwor.example>\nSubject: Robots for room service?\n\nAfter the Kielce trade fair I'm left with your business card. We have 3 hotels of about 80 rooms each, and night room service is struggling — 2 people per shift. How much would a trial in one hotel cost? There is a single old lift (Schindler, 2004) — is that a problem? My innovation budget runs until the end of October, then it goes back to the CEO. A call on Tuesday after 2 pm would work.",
  }, draft: { pl: "Klient zainteresowany, wyślę ofertę.", en: "Customer interested, will send an offer." } },
  { id: "H", mode: "sales_note", title: { pl: "Mail od dyrektora hoteli · konkretna", en: "Hotel-group email · specific" }, context: {
    pl: "Od: Jan Wrona <j.wrona@gorskidwor.example>\nTemat: Roboty do room service?\n\nPo targach w Kielcach zostałem z Waszą wizytówką. Mamy 3 hotele po ok. 80 pokoi, room service kuleje w nocy — 2 osoby na zmianie. Ile kosztowałby test w jednym hotelu? Winda jest jedna, stara (Schindler, 2004) — czy to problem? Budżet na innowacje mam do końca października, potem wraca do pani prezes. Może być rozmowa we wtorek po 14.",
    en: "From: Jan Wrona <j.wrona@gorskidwor.example>\nSubject: Robots for room service?\n\nAfter the Kielce trade fair I'm left with your business card. We have 3 hotels of about 80 rooms each, and night room service is struggling — 2 people per shift. How much would a trial in one hotel cost? There is a single old lift (Schindler, 2004) — is that a problem? My innovation budget runs until the end of October, then it goes back to the CEO. A call on Tuesday after 2 pm would work.",
  }, draft: {
    pl: "Górski Dwór (Jan Wrona): 3 hotele po ok. 80 pokoi, room service nocą obsługują 2 osoby. Chce test w jednym hotelu; pytał o koszt i o to, czy stara winda Schindler (2004) jest problemem. Budżet do końca października. Rozmowa: wtorek po 14:00. Zrobię: (1) do środy — konsultacja z inżynierem o windzie; (2) do piątku — oferta pilotażowa 1 robot / 3 miesiące; (3) poniedziałek — agenda rozmowy.",
    en: "Jan Wrona, Gorski Dwor (3 hotels, ~80 rooms each): asks about a room-service pilot at one hotel because the night shift is only 2 people. Main risk: a single 2004 Schindler lift. Innovation budget is valid until the end of October, so the offer must go out by Friday. Agreed: call on Tuesday after 14:00. Next steps: (1) by Wednesday I ask the deployment engineer whether integration with that lift is possible; (2) by Friday I send pricing for a pilot: 1 robot for 3 months, with lift variants; (3) on Monday I send the agenda for Tuesday's call.",
  } },
];

type GateResponse = {
  engine: Engine; model: string; elapsed_ms: number; gate: "ready" | "revise" | "rewrite" | "review";
  quality: { selected: string; scores: Record<string, number>; confidence: number; labels: Record<string, string> };
  checks: Record<string, number>;
  cost: { usd: number | null; source: "local_api" | "provider" | "unreported" };
  model_request: unknown; model_response: { usage?: { input_tokens?: number; output_tokens?: number }; [key: string]: unknown };
};

const COPY = {
  pl: {
    heading: "Bramka jakości odpowiedzi", intro: "Wklej wiadomość klienta lub surową notatkę i swój szkic. Model oceni kompletność, a jawna reguła zdecyduje: gotowe, popraw, przepisz albo sprawdź ręcznie.",
    examples: "Przykłady z życia", mode: "Rodzaj tekstu", modes: { customer_reply: "Odpowiedź klientowi", service_note: "Notatka serwisowa", sales_note: "Notatka handlowa" },
    contextLabel: { customer_reply: "Wiadomość od klienta i notatki", service_note: "Surowe informacje od technika", sales_note: "Wiadomość od klienta" },
    draftLabel: { customer_reply: "Twoja odpowiedź", service_note: "Twoja notatka serwisowa", sales_note: "Twoja notatka po rozmowie" },
    contextPlaceholder: "Wklej wiadomość, SMS lub transkrypcję…", draftPlaceholder: "Napisz odpowiedź lub notatkę…",
    run: "Sprawdź wybranym modelem", compare: "Porównaj oba modele", working: "Sprawdzam…", result: "Decyzja bramki", empty: "Wybierz przykład albo wklej własny tekst — tu pojawi się decyzja bramki.", busy: "Model czyta wiadomość i porównuje ją ze szkicem…",
    gates: { ready: "Gotowe do wysłania", revise: "Dopisz szczegóły", rewrite: "Napisz ponownie", review: "Sprawdź ręcznie" },
    gateHint: { ready: "Zawiera fakty, działania, wynik i kolejny krok.", revise: "Główna myśl jest dobra, ale czegoś brakuje.", rewrite: "Za mało konkretów lub nieodpowiedni ton.", review: "Model nie jest wystarczająco pewny — zdecyduj sam." },
    zones: ["Przepisz", "Sprawdź", "Gotowe"],
    quality: "Ocena modelu", confidence: "pewność", checks: "Co jest w szkicu", checkNames: { context: "Fakty z wiadomości", action: "Konkretne działania lub ustalenia", result: "Wynik lub aktualny stan", next_step: "Kolejny krok", language: "Jasny, odpowiedni język" },
    improve: "Elementy do dopisania", note: "Progi są demonstracyjne: „gotowe” wymaga ≥65% dla oceny „gotowe”, pewności ≥50% i każdego testu ≥50%. Niejednoznaczne przypadki trafiają do kontroli ręcznej. To nie jest zwalidowana miara jakości.",
    details: "Koszt i surowy JSON", json: "Wysłane i odebrane JSON", http: "POST do backendu", sent: "Sent · żądanie do modelu", received: "Received · surowa odpowiedź", error: "Ocena nie powiodła się.",
  },
  en: {
    heading: "Reply quality gate", intro: "Paste a customer message or raw notes and your draft. The model checks completeness, then an explicit rule decides: ready, revise, rewrite or manual review.",
    examples: "Real-life examples", mode: "Text type", modes: { customer_reply: "Customer reply", service_note: "Service note", sales_note: "Sales note" },
    contextLabel: { customer_reply: "Customer message and notes", service_note: "Raw input from the technician", sales_note: "Customer message" },
    draftLabel: { customer_reply: "Your reply", service_note: "Your service note", sales_note: "Your follow-up note" },
    contextPlaceholder: "Paste the message, text or transcript…", draftPlaceholder: "Write the reply or note…",
    run: "Check with selected model", compare: "Compare both models", working: "Checking…", result: "Gate decision", empty: "Pick an example or paste your own text — the gate decision appears here.", busy: "The model reads the message and compares it with the draft…",
    gates: { ready: "Ready to send", revise: "Add details", rewrite: "Rewrite", review: "Review manually" },
    gateHint: { ready: "Has facts, actions, an outcome and a next step.", revise: "The main point is fine, but something is missing.", rewrite: "Too few specifics or an unsuitable tone.", review: "The model is not certain enough — decide yourself." },
    zones: ["Rewrite", "Review", "Ready"],
    quality: "Model assessment", confidence: "confidence", checks: "What the draft contains", checkNames: { context: "Facts from the message", action: "Concrete actions or agreements", result: "Outcome or current status", next_step: "Next step", language: "Clear, suitable language" },
    improve: "Details to add", note: "Demo thresholds: “ready” needs ≥65% for ‘ready’, ≥50% confidence and every check ≥50%. Ambiguous cases go to manual review. These scores are not a validated quality measure.",
    details: "Cost and raw JSON", json: "Sent and received JSON", http: "POST to backend", sent: "Sent · model request", received: "Received · raw response", error: "Review failed.",
  },
};

const QUALITY_ORDER = ["insufficient", "revise", "ready"];
const CHECK_ORDER = ["context", "action", "result", "next_step", "language"] as const;
const GATE_ICON = { ready: "✓", revise: "✎", rewrite: "↻", review: "?" } as const;
const MODES: Mode[] = ["customer_reply", "service_note", "sales_note"];
const mailGlyph = <svg viewBox="0 0 48 48"><rect x="6" y="11" width="36" height="26" rx="4" /><path d="M8 14l16 12 16-12" /></svg>;

export function NoteGateDemo() {
  const { lang, t } = useI18n();
  const c = COPY[lang];
  const { backend, engine } = useEngine();
  const [mode, setMode] = useState<Mode>("customer_reply");
  const [context, setContext] = useState("");
  const [draft, setDraft] = useState("");
  const [exampleId, setExampleId] = useState<string | null>(null);
  const [results, setResults] = useState<Partial<Record<Engine, GateResponse | { error: unknown }>>>({});
  const [pending, setPending] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const jevReady = backend.state === "ready" && backend.health.engines.jev.available;
  useEffect(() => () => requestRef.current?.abort(), []);

  function invalidate() { requestRef.current?.abort(); setPending(false); setResults({}); setExampleId(null); }
  function choose(example: Example) { invalidate(); setMode(example.mode); setContext(example.context[lang]); setDraft(example.draft[lang]); setExampleId(example.id); }
  async function run(models: Engine[]) {
    if (!context.trim() || !draft.trim() || pending) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true);
    setResults({});
    const settled = await Promise.allSettled(models.map((model) => postJson<GateResponse>("/notes/gate", { context, draft, mode, lang, engine: model }, controller.signal)));
    if (controller.signal.aborted) return;
    const next: Partial<Record<Engine, GateResponse | { error: unknown }>> = {};
    settled.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") next[models[index]] = outcome.value;
      else if (!isAbort(outcome.reason)) next[models[index]] = { error: outcome.reason };
    });
    setResults(next);
    setPending(false);
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void run([engine]); }
  const shown = (["laya", "jev"] as Engine[]).filter((model) => results[model]);
  const filtered = EXAMPLES.filter((example) => example.mode === mode);

  return <main className="ticket-page note-page">
    <div className="injection-heading"><p className="eyebrow">06 / CONFIDENCE GATE</p><h1>{c.heading}</h1><p className="muted">{c.intro}</p></div>
    <div className="injection-grid">
      <section className="injection-panel"><h2>{c.examples}</h2>
        <div className="mode-tabs" role="group" aria-label={c.mode}>{MODES.map((key) => <button type="button" key={key} aria-pressed={mode === key} onClick={() => { if (key !== mode) { invalidate(); setMode(key); } }}>{c.modes[key]}</button>)}</div>
        <div className="ticket-examples" style={{ marginTop: "0.6rem" }}>{filtered.map((example) => <button type="button" key={example.id} className={exampleId === example.id ? "active" : ""} onClick={() => choose(example)}><strong>{example.id}</strong><span>{example.title[lang]}</span></button>)}</div>
        <form className="injection-form" onSubmit={submit}>
          <div className="mail-pane incoming"><label htmlFor="note-context">{c.contextLabel[mode]}<small>{context.length}/4000</small></label><textarea id="note-context" maxLength={4000} placeholder={c.contextPlaceholder} value={context} onChange={(event) => { invalidate(); setContext(event.target.value); }} /></div>
          <div className="mail-pane outgoing"><label htmlFor="note-draft">{c.draftLabel[mode]}<small>{draft.length}/4000</small></label><textarea id="note-draft" maxLength={4000} placeholder={c.draftPlaceholder} value={draft} onChange={(event) => { invalidate(); setDraft(event.target.value); }} /></div>
          <div className="injection-actions"><button className="injection-primary" type="submit" disabled={pending || !context.trim() || !draft.trim() || backend.state !== "ready"}>{pending ? c.working : c.run}</button><button type="button" disabled={pending || !context.trim() || !draft.trim() || !jevReady} onClick={() => void run(["laya", "jev"])}>{c.compare}</button></div>
        </form>
      </section>
      <section className={`injection-panel note-results ${pending ? "is-busy" : ""}`} aria-live="polite"><h2>{c.result}</h2>
        {shown.length === 0 && <StageEmpty busy={pending} idle={c.empty} working={c.busy} glyph={mailGlyph} />}
        <div className={shown.length > 1 ? "stage-cols" : undefined}>
          {shown.map((model) => {
            const item = results[model]!;
            if ("error" in item) return <article className="injection-result" key={model}><h3>{ENGINE_NAMES[model]}</h3><p className="error">{errorText(item.error, t, c.error)}</p></article>;
            const missing = CHECK_ORDER.filter((key) => item.checks[key] < 0.5);
            return <article className="ticket-result" key={model}>
              <div className="stage-head"><h3>{ENGINE_NAMES[model]}</h3><span>{Math.round(item.elapsed_ms)} ms</span></div>
              <div className={`gate-stamp ${item.gate}`}><span aria-hidden="true">{GATE_ICON[item.gate]}</span><div><strong>{c.gates[item.gate]}</strong><small>{c.gateHint[item.gate]}</small></div></div>
              <div className="note-gate-track"><span className="zone rewrite" /><span className="zone review" /><span className="zone ready" /><i style={{ left: `${item.quality.scores.ready * 100}%` }} /></div>
              <div className="gate-legend">{c.zones.map((zone) => <span key={zone}>{zone}</span>)}</div>
              <div className="ticket-group"><h4>{c.checks}</h4><div className="check-grid">{CHECK_ORDER.map((key) => <CheckChip key={key} label={c.checkNames[key]} score={item.checks[key]} />)}</div></div>
              {missing.length > 0 && <div className="note-missing"><strong>{c.improve}</strong><ul>{missing.map((key) => <li key={key}>{c.checkNames[key]}</li>)}</ul></div>}
              <details className="stage-more" open><summary>{c.quality} · {Math.round(item.quality.confidence * 100)}% {c.confidence}</summary>
                <div className="ticket-options">{QUALITY_ORDER.map((key) => <div className={`ticket-option ${key === item.quality.selected ? "selected" : ""}`} key={key}><span>{item.quality.labels[key]}</span><strong>{Math.round(item.quality.scores[key] * 100)}%</strong><div className="ticket-bar"><span style={{ width: `${item.quality.scores[key] * 100}%` }} /></div></div>)}</div>
                <p className="small muted ticket-note">{c.note}</p>
              </details>
              <details className="stage-more"><summary>{c.details}</summary>
                <CostScale engine={model} cost={item.cost} usage={item.model_response.usage} lang={lang} />
                <div className="ticket-json"><h4>{c.json}</h4><details><summary>{c.http}</summary><pre>{JSON.stringify({ method: "POST", path: "/api/notes/gate", body: { context, draft, mode, lang, engine: model } }, null, 2)}</pre></details><details><summary>{c.sent}</summary><pre>{JSON.stringify(item.model_request, null, 2)}</pre></details><details><summary>{c.received}</summary><pre>{JSON.stringify(item.model_response, null, 2)}</pre></details></div>
              </details>
            </article>;
          })}
        </div>
      </section>
    </div>
  </main>;
}
