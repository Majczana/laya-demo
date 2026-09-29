import { useEffect, useRef, useState, type FormEvent } from "react";
import { errorText, isAbort, postJson } from "./api";
import { useEngine } from "./engine";
import { useI18n, type Lang } from "./i18n";
import { CostScale } from "./CostScale";
import { CheckChip, Lock, StageEmpty } from "./Stage";

type Action = "remove_robot" | "reject_project" | "cancel_visit" | "close_ticket";
type Example = { id: string; title: Record<Lang, string>; action: Action; target: Record<Lang, string>; context: Record<Lang, string>; reason: Record<Lang, string> };
type Review = {
  elapsed_ms: number; approved: boolean; gate: "approved" | "denied" | "needs_revision"; reasons: string[];
  decision: { selected: string; scores: Record<string, number>; confidence: number; labels: Record<string, string> };
  checks: Record<string, number>;
  cost: { usd: number | null; source: "provider" | "unreported" };
  model_request: unknown;
  model_response: { usage?: { input_tokens?: number; output_tokens?: number }; [key: string]: unknown };
};
type Audit = { id: string; at: string; action: Action; target: string; reason: string; gate: Review["gate"] };
const AUDIT_KEY = "laya-demo:action-audit-v1";

const EXAMPLES: Example[] = [
  { id: "A", title: { pl: "Usuń robota · słaby powód", en: "Remove robot · weak reason" }, action: "remove_robot",
    target: { pl: "CC1 nr CC1-061", en: "CC1 serial CC1-061" },
    context: { pl: "Robot jest przypisany do czynnej umowy serwisowej. Klient nadal go używa.", en: "The robot is covered by an active service agreement. The customer still uses it." },
    reason: { pl: "Bo zaśmieca listę i łatwiej go usunąć.", en: "It clutters the list and deleting it is easier." } },
  { id: "B", title: { pl: "Usuń robota · pełny powód", en: "Remove robot · full reason" }, action: "remove_robot",
    target: { pl: "CC1 nr CC1-061", en: "CC1 serial CC1-061" },
    context: { pl: "Klient potwierdził zwrot robota po zakończeniu umowy. Sprzęt został trwale wycofany, nie ma otwartych zgłoszeń, a historia serwisowa została wyeksportowana.", en: "The customer confirmed the robot's return after the contract ended. It was permanently retired, has no open tickets, and its service history was exported." },
    reason: { pl: "Usuwam wycofany numer CC1-061 z aktywnej floty po potwierdzeniu zwrotu przez klienta. Historia serwisowa została wyeksportowana; po usunięciu zaktualizuję ewidencję i poinformuję opiekuna klienta.", en: "Remove retired CC1-061 from the active fleet after the customer confirmed its return. Service history has been exported; I will update the asset register and notify the account owner." } },
  { id: "C", title: { pl: "Odwołaj wizytę · słaby powód", en: "Cancel visit · weak reason" }, action: "cancel_visit",
    target: { pl: "Wizyta W-158 jutro o 10:00", en: "Visit W-158 tomorrow at 10:00" },
    context: { pl: "PUDU CC1 nie podaje wody. Klient czeka na technika; wizyta jest potwierdzona.", en: "The PUDU CC1 does not dispense water. The customer expects a technician; the visit is confirmed." },
    reason: { pl: "Nie chce mi się jechać, spróbują sami.", en: "I do not feel like going; they can try themselves." } },
  { id: "D", title: { pl: "Odwołaj wizytę · rozwiązano", en: "Cancel visit · resolved" }, action: "cancel_visit",
    target: { pl: "Wizyta W-158 jutro o 10:00", en: "Visit W-158 tomorrow at 10:00" },
    context: { pl: "Wizyta dotyczyła błędu mapy. Po zdalnej korekcie robot wykonał trzy przejazdy bez błędu. Klient potwierdził rozwiązanie i zgodził się odwołać wizytę.", en: "The visit concerned a map error. After a remote fix the robot completed three runs without error. The customer confirmed the fix and agreed to cancel the visit." },
    reason: { pl: "Odwołuję wizytę W-158, ponieważ potwierdzono rozwiązanie zdalne i trzy poprawne przejazdy. Klient zaakceptował odwołanie; wyślę potwierdzenie i pozostawię zgłoszenie do obserwacji przez 24 godziny.", en: "Cancel W-158 because the remote fix and three successful runs were confirmed. The customer agreed; I will send confirmation and keep the case under observation for 24 hours." } },
  { id: "E", title: { pl: "Odrzuć projekt · alternatywa", en: "Reject project · better option" }, action: "reject_project",
    target: { pl: "Projekt wdrożenia w magazynie", en: "Warehouse deployment project" },
    context: { pl: "Klient prosi o przesunięcie terminu o dwa tygodnie. Zespół ma dostępny nowy termin i zakres pozostaje aktualny.", en: "The customer asks to move the date by two weeks. The team has another slot and the scope remains valid." },
    reason: { pl: "Odrzucam projekt, bo klient zmienił termin.", en: "Reject the project because the customer changed the date." } },
  { id: "F", title: { pl: "Zamknij ticket · z wynikiem", en: "Close ticket · documented" }, action: "close_ticket",
    target: { pl: "Zgłoszenie S-204 o ładowaniu", en: "Charging ticket S-204" },
    context: { pl: "Technik wymienił uszkodzoną stację, wykonał trzy pełne cykle ładowania bez błędu i klient potwierdził powrót do pracy.", en: "The technician replaced the faulty station, completed three full charging cycles without error, and the customer confirmed a return to service." },
    reason: { pl: "Zamykam S-204 po wymianie stacji i trzech poprawnych cyklach ładowania. Klient potwierdził wynik; protokół jest dołączony, a przy nawrocie problemu otworzymy nowe zgłoszenie.", en: "Close S-204 after station replacement and three successful charging cycles. The customer confirmed the result; the service report is attached and a recurrence will trigger a new ticket." } },
];

const COPY = {
  pl: {
    heading: "Bramka uzasadnienia akcji", intro: "Przed trudną zmianą użytkownik podaje powód. Jev ocenia, czy uzasadnienie jest konkretne, zgodne z faktami i czy istnieje lepsza opcja. Akcje w tym demie są symulowane.",
    examples: "Przykłady", action: "Akcja", target: "Czego dotyczy", context: "Stan sprawy", reason: "Uzasadnienie", run: "Sprawdź i wykonaj w demie", pending: "Jev sprawdza…", noJev: "Do uruchomienia potrzebny jest klucz Jev w backendzie.",
    actions: { remove_robot: "Usuń robota", reject_project: "Odrzuć projekt", cancel_visit: "Odwołaj wizytę", close_ticket: "Zamknij zgłoszenie" },
    output: "Decyzja Jev", empty: "Wybierz przykład lub wpisz własne uzasadnienie.", approved: "Zaakceptowano · wykonano w demie", denied: "Odrzucono · akcja zablokowana", needs_revision: "Wstrzymano · uzupełnij uzasadnienie",
    auditSaved: "Próba została zapisana w lokalnym dzienniku dema.", checks: "Kontrole uzasadnienia", distribution: "Wynik modelu", reasons: "Co poprawić", history: "Dziennik prób", historyEmpty: "Po pierwszej próbie pojawi się tu zapis decyzji.",
    checkNames: { specific: "Konkretny powód", grounded: "Zgodność z faktami", proportionate: "Proporcjonalność", next_step: "Skutek lub kolejny krok", better_alternative: "Lepsza alternatywa istnieje" },
    why: { specific: "Podaj konkretny, sprawdzalny powód.", grounded: "Odnieś powód do faktów sprawy.", proportionate: "Wyjaśnij, dlaczego ta akcja jest właściwa.", next_step: "Opisz skutek i kolejny krok.", better_alternative: "Rozważ mniej radykalne rozwiązanie.", uncertain: "Model nie uzyskał wystarczającej pewności; sprawdź uzasadnienie ręcznie." },
    json: "Wysłane i odebrane JSON", http: "POST do backendu", sent: "Sent · żądanie do Jev", received: "Received · surowa odpowiedź", error: "Nie udało się sprawdzić powodu.", storage: "Dziennik jest zapisany tylko w tej przeglądarce. Demo nie usuwa robotów ani nie zmienia zgłoszeń.",
  },
  en: {
    heading: "Action justification gate", intro: "Before a consequential change, the user explains why. Jev checks whether the reason is specific, grounded and whether a better option exists. Actions in this demo are simulated.",
    examples: "Examples", action: "Action", target: "Target", context: "Case context", reason: "Justification", run: "Review and run in demo", pending: "Jev is reviewing…", noJev: "A Jev API key is needed in the backend.",
    actions: { remove_robot: "Remove robot", reject_project: "Reject project", cancel_visit: "Cancel visit", close_ticket: "Close ticket" },
    output: "Jev decision", empty: "Choose an example or enter your own justification.", approved: "Approved · run in demo", denied: "Denied · action blocked", needs_revision: "Held · improve the justification",
    auditSaved: "The attempt was saved in the local demo log.", checks: "Justification checks", distribution: "Model choice", reasons: "What to improve", history: "Attempt log", historyEmpty: "The first attempt will appear here.",
    checkNames: { specific: "Specific reason", grounded: "Grounded in facts", proportionate: "Proportionate action", next_step: "Effect or next step", better_alternative: "Better alternative exists" },
    why: { specific: "Give a specific, verifiable reason.", grounded: "Tie the reason to case facts.", proportionate: "Explain why this action is appropriate.", next_step: "Describe the effect and next step.", better_alternative: "Consider a less drastic option.", uncertain: "The model was not sufficiently certain; review the justification manually." },
    json: "Sent and received JSON", http: "POST to backend", sent: "Sent · Jev request", received: "Received · raw response", error: "The reason could not be reviewed.", storage: "The log is saved only in this browser. The demo does not delete robots or change tickets.",
  },
};

function readAudit(): Audit[] {
  try { const value = JSON.parse(localStorage.getItem(AUDIT_KEY) ?? "[]"); return Array.isArray(value) ? value.slice(0, 20) : []; }
  catch { return []; }
}

export function ActionGateDemo() {
  const { lang, t } = useI18n();
  const c = COPY[lang];
  const { backend } = useEngine();
  const [action, setAction] = useState<Action>("remove_robot");
  const [target, setTarget] = useState("");
  const [context, setContext] = useState("");
  const [reason, setReason] = useState("");
  const [exampleId, setExampleId] = useState<string | null>(null);
  const [result, setResult] = useState<Review | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [audit, setAudit] = useState<Audit[]>(readAudit);
  const requestRef = useRef<AbortController | null>(null);
  const ready = backend.state === "ready" && backend.health.engines.jev.available;
  useEffect(() => () => requestRef.current?.abort(), []);

  function change() { requestRef.current?.abort(); setPending(false); setResult(null); setFailure(null); setExampleId(null); }
  function pick(example: Example) {
    change(); setExampleId(example.id); setAction(example.action); setTarget(example.target[lang]); setContext(example.context[lang]); setReason(example.reason[lang]);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || pending || !target.trim() || !context.trim() || !reason.trim()) return;
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    setPending(true); setResult(null); setFailure(null);
    try {
      const reviewed = await postJson<Review>("/actions/review", { action, target, context, reason, lang }, controller.signal);
      if (controller.signal.aborted) return;
      setResult(reviewed);
      const entry: Audit = { id: crypto.randomUUID(), at: new Date().toISOString(), action, target, reason, gate: reviewed.gate };
      setAudit((previous) => {
        const next = [entry, ...previous].slice(0, 20);
        try { localStorage.setItem(AUDIT_KEY, JSON.stringify(next)); } catch { /* storage can be unavailable */ }
        return next;
      });
    } catch (error) { if (!isAbort(error)) setFailure(error); }
    finally { if (!controller.signal.aborted) setPending(false); }
  }

  return <main className="ticket-page action-page">
    <div className="injection-heading"><p className="eyebrow">07 / ACTION GATE</p><h1>{c.heading}</h1><p className="muted">{c.intro}</p></div>
    <div className="injection-grid">
      <section className="injection-panel">
        <h2>{c.examples}</h2>
        <div className="ticket-examples">{EXAMPLES.map((example) => <button key={example.id} type="button" className={exampleId === example.id ? "active" : ""} onClick={() => pick(example)}><strong>{example.id}</strong><span>{example.title[lang]}</span></button>)}</div>
        <form className="injection-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="action-type">{c.action}</label><select id="action-type" value={action} onChange={(event) => { change(); setAction(event.target.value as Action); }}>{Object.entries(c.actions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <label htmlFor="action-target">{c.target}</label><input id="action-target" maxLength={160} value={target} onChange={(event) => { change(); setTarget(event.target.value); }} />
          <label htmlFor="action-context">{c.context}</label><textarea id="action-context" maxLength={3000} value={context} onChange={(event) => { change(); setContext(event.target.value); }} />
          <label htmlFor="action-reason">{c.reason}</label><textarea id="action-reason" maxLength={3000} value={reason} onChange={(event) => { change(); setReason(event.target.value); }} />
          <div className="injection-actions"><button className="injection-primary" type="submit" disabled={!ready || pending || !target.trim() || !context.trim() || !reason.trim()}>{pending ? c.pending : c.run}</button></div>
          {!ready && <p className="small muted">{c.noJev}</p>}
        </form>
      </section>
      <section className={`injection-panel ticket-results ${pending ? "is-busy" : ""}`} aria-live="polite">
        <h2>{c.output}</h2>
        {!result && !failure && <StageEmpty busy={pending} idle={c.empty} working={c.pending} glyph={<Lock state={pending ? "half" : "closed"} />} />}
        {failure !== null && <p className="error">{errorText(failure, t, c.error)}</p>}
        {result && <article className="ticket-result">
          <div className="stage-head"><h3>Jev</h3><span>{Math.round(result.elapsed_ms)} ms</span></div>
          <div className={`gate-hero ${result.gate}`}><Lock state={result.gate === "approved" ? "open" : result.gate === "denied" ? "closed" : "half"} /><div><strong>{c[result.gate]}</strong><small>{c.auditSaved}</small></div></div>
          <div className="ticket-group"><h4>{c.checks}</h4><div className="check-grid">{Object.entries(result.checks).map(([key, score]) => <CheckChip key={key} label={c.checkNames[key as keyof typeof c.checkNames]} score={score} invert={key === "better_alternative"} />)}</div></div>
          {result.reasons.length > 0 && <div className="note-missing"><strong>{c.reasons}</strong><ul>{result.reasons.map((key) => <li key={key}>{c.why[key as keyof typeof c.why]}</li>)}</ul></div>}
          <details className="stage-more" open><summary>{c.distribution}</summary><div className="ticket-options">{Object.entries(result.decision.scores).sort((a, b) => b[1] - a[1]).map(([key, score]) => <div className={key === result.decision.selected ? "ticket-option selected" : "ticket-option"} key={key}><span>{result.decision.labels[key]}</span><strong>{Math.round(score * 100)}%</strong><div className="ticket-bar"><span style={{ width: `${score * 100}%` }} /></div></div>)}</div></details>
          <details className="stage-more"><summary>{c.json}</summary>
            <CostScale engine="jev" cost={result.cost} usage={result.model_response.usage} lang={lang} />
            <div className="ticket-json">
              <details><summary>{c.http}</summary><pre>{JSON.stringify({ method: "POST", path: "/api/actions/review", body: { action, target, context, reason, lang } }, null, 2)}</pre></details>
              <details><summary>{c.sent}</summary><pre>{JSON.stringify(result.model_request, null, 2)}</pre></details>
              <details><summary>{c.received}</summary><pre>{JSON.stringify(result.model_response, null, 2)}</pre></details>
            </div>
          </details>
        </article>}
      </section>
    </div>
    <section className="action-audit"><h2>{c.history}</h2><p className="small muted">{c.storage}</p>
      {audit.length === 0 ? <p className="muted">{c.historyEmpty}</p> : <ol>{audit.map((entry) => <li key={entry.id} className={`gate-${entry.gate}`}><time>{new Date(entry.at).toLocaleString(lang === "pl" ? "pl-PL" : "en-US")}</time><strong>{c.actions[entry.action]} · {entry.target}</strong><span>{c[entry.gate]}</span><p>{entry.reason}</p></li>)}</ol>}
    </section>
  </main>;
}
