import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { errorText, isAbort, postJson } from "./api";
import { ENGINE_NAMES, useEngine, type Engine } from "./engine";
import { useI18n } from "./i18n";
import { CostScale } from "./CostScale";
import { Dial, StageEmpty } from "./Stage";
import { EXAMPLES } from "./groundingExamples";

type Verdict = "supported" | "unsupported" | "contradicted";
type Claim = { index: number; text: string; support: number; contradiction: number | null; verdict: Verdict };
type Check = {
  engine: Engine; model: string; elapsed_ms: number;
  claims: Claim[]; counts: Record<Verdict, number>; faithfulness: number;
  thresholds: { support: number; contradiction: number }; asked_contradiction: boolean;
  cost: { usd: number | null; source: "local_api" | "provider" | "unreported" };
  model_request: unknown; model_response: { usage?: { input_tokens?: number; output_tokens?: number }; [key: string]: unknown };
};

const COPY = {
  pl: {
    heading: "Weryfikacja odpowiedzi ze źródłem", intro: "Wklej dokument i odpowiedź asystenta. Odpowiedź jest dzielona na zdania, a model sprawdza każde z nich osobno: potwierdzone, niepotwierdzone albo sprzeczne ze źródłem.",
    examples: "Przykłady", source: "Źródło (dokument, mail, procedura)", answer: "Odpowiedź asystenta do sprawdzenia", sourcePlaceholder: "Wklej tekst, na którym ma się opierać odpowiedź…", answerPlaceholder: "Wklej odpowiedź lub streszczenie do sprawdzenia…",
    layaLimit: "LAYA czyta początek źródła (ok. 400 tokenów, około 1500 znaków); Jev czyta całość.",
    run: "Sprawdź wybranym modelem", compare: "Porównaj oba modele", working: "Sprawdzam zdania…", result: "Werdykty",
    empty: "Wybierz przykład albo wklej własny tekst — tu pojawią się werdykty dla każdego zdania.", busy: "Model porównuje każde zdanie ze źródłem…",
    verdicts: { supported: "Potwierdzone w źródle", unsupported: "Brak w źródle", contradicted: "Sprzeczne ze źródłem" },
    verdictsLaya: { supported: "Potwierdzone w źródle", unsupported: "Niepotwierdzone", contradicted: "Sprzeczne ze źródłem" },
    faithfulness: "wierność źródłu", claims: "Odpowiedź zdanie po zdaniu", split: "Podział na zdania robi prosty algorytm, nie model.",
    support: "poparte", contradiction: "sprzeczne", rule: (support: number, contradiction: number) => `Reguła: poparte ≥ ${support}% → potwierdzone · inaczej sprzeczne ≥ ${contradiction}% → sprzeczne · inaczej → brak w źródle.`,
    ruleLaya: (support: number) => `Reguła: poparte ≥ ${support}% → potwierdzone · inaczej → niepotwierdzone. LAYA nie jest pytana o sprzeczność: w naszych próbach odpowiadała na to pytanie na poziomie losowym, więc trzeci werdykt daje tylko Jev.`,
    unsupportedCount: "niepotwierdzone", note: "Wynik to odpowiedzi modelu na pytania tak/nie dla każdego zdania, a nie dowód. Model może pominąć subtelną zmianę faktu, więc ważne odpowiedzi warto sprawdzić ręcznie.",
    details: "Koszt i surowy JSON", json: "Wysłane i odebrane JSON", http: "POST do backendu", sent: "Sent · żądanie do modelu", received: "Received · surowa odpowiedź", error: "Sprawdzenie nie powiodło się.",
  },
  en: {
    heading: "Answer-to-source verification", intro: "Paste a document and an assistant's answer. The answer is split into sentences and the model checks each one separately: supported, unconfirmed or contradicted by the source.",
    examples: "Examples", source: "Source (document, e-mail, procedure)", answer: "Assistant answer to verify", sourcePlaceholder: "Paste the text the answer should rely on…", answerPlaceholder: "Paste the answer or summary to check…",
    layaLimit: "LAYA reads the start of the source (about 400 tokens, roughly 1,500 characters); Jev reads all of it.",
    run: "Check with selected model", compare: "Compare both models", working: "Checking sentences…", result: "Verdicts",
    empty: "Pick an example or paste your own text — a verdict for each sentence appears here.", busy: "The model compares each sentence with the source…",
    verdicts: { supported: "Supported by the source", unsupported: "Not in the source", contradicted: "Contradicts the source" },
    verdictsLaya: { supported: "Supported by the source", unsupported: "Unconfirmed", contradicted: "Contradicts the source" },
    faithfulness: "faithfulness", claims: "The answer sentence by sentence", split: "The sentence split is a simple algorithm, not the model.",
    support: "supported", contradiction: "contradicted", rule: (support: number, contradiction: number) => `Rule: supported ≥ ${support}% → supported · otherwise contradicted ≥ ${contradiction}% → contradicts · otherwise → not in the source.`,
    ruleLaya: (support: number) => `Rule: supported ≥ ${support}% → supported · otherwise → unconfirmed. LAYA is not asked about contradiction: in our trials it answered that question at chance level, so only Jev gives the third verdict.`,
    unsupportedCount: "unconfirmed", note: "The result is the model's yes/no answers per sentence, not proof. A model can miss a subtle change of fact, so review important answers by hand.",
    details: "Cost and raw JSON", json: "Sent and received JSON", http: "POST to backend", sent: "Sent · model request", received: "Received · raw response", error: "The check failed.",
  },
};

const ICON: Record<Verdict, string> = { supported: "✓", unsupported: "?", contradicted: "✕" };
const docGlyph = <svg viewBox="0 0 48 48"><path d="M12 6h17l9 9v27H12z" /><path d="M29 6v9h9M18 26l4 4 8-9" /></svg>;
const percent = (value: number) => Math.round(value * 100);

export function GroundingDemo() {
  const { lang, t } = useI18n();
  const c = COPY[lang];
  const { backend, engine } = useEngine();
  const [source, setSource] = useState("");
  const [reply, setReply] = useState("");
  const [exampleId, setExampleId] = useState<string | null>(null);
  const [results, setResults] = useState<Partial<Record<Engine, Check | { error: unknown }>>>({});
  const [pending, setPending] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const jevReady = backend.state === "ready" && backend.health.engines.jev.available;
  useEffect(() => () => requestRef.current?.abort(), []);

  function invalidate() { requestRef.current?.abort(); setPending(false); setResults({}); setExampleId(null); }
  function choose(id: string) {
    const example = EXAMPLES.find((item) => item.id === id)!;
    invalidate(); setSource(example.source[lang]); setReply(example.answer[lang]); setExampleId(id);
  }
  async function run(models: Engine[]) {
    if (!source.trim() || !reply.trim() || pending) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true);
    setResults({});
    const settled = await Promise.allSettled(models.map((model) => postJson<Check>("/grounding/check", { source, answer: reply, lang, engine: model }, controller.signal)));
    if (controller.signal.aborted) return;
    const next: Partial<Record<Engine, Check | { error: unknown }>> = {};
    settled.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") next[models[index]] = outcome.value;
      else if (!isAbort(outcome.reason)) next[models[index]] = { error: outcome.reason };
    });
    setResults(next);
    setPending(false);
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void run([engine]); }
  const shown = (["laya", "jev"] as Engine[]).filter((model) => results[model]);

  return <main className="ticket-page ground-page">
    <div className="injection-heading"><p className="eyebrow">09 / GROUNDING</p><h1>{c.heading}</h1><p className="muted">{c.intro}</p></div>
    <div className="injection-grid">
      <section className="injection-panel"><h2>{c.examples}</h2>
        <div className="ticket-examples">{EXAMPLES.map((example) => <button type="button" key={example.id} className={exampleId === example.id ? "active" : ""} onClick={() => choose(example.id)}><strong>{example.id}</strong><span>{example.title[lang]}</span></button>)}</div>
        <form className="injection-form" onSubmit={submit}>
          <div className="mail-pane incoming"><label htmlFor="ground-source">{c.source}<small>{source.length}/4000</small></label><textarea id="ground-source" maxLength={4000} placeholder={c.sourcePlaceholder} value={source} onChange={(event) => { invalidate(); setSource(event.target.value); }} /></div>
          <div className="mail-pane outgoing"><label htmlFor="ground-answer">{c.answer}<small>{reply.length}/2000</small></label><textarea id="ground-answer" maxLength={2000} placeholder={c.answerPlaceholder} value={reply} onChange={(event) => { invalidate(); setReply(event.target.value); }} /></div>
          {source.length > 1500 && <p className="small muted">{c.layaLimit}</p>}
          <div className="injection-actions"><button className="injection-primary" type="submit" disabled={pending || !source.trim() || !reply.trim() || backend.state !== "ready"}>{pending ? c.working : c.run}</button><button type="button" disabled={pending || !source.trim() || !reply.trim() || !jevReady} onClick={() => void run(["laya", "jev"])}>{c.compare}</button></div>
        </form>
      </section>
      <section className={`injection-panel ground-results ${pending ? "is-busy" : ""}`} aria-live="polite"><h2>{c.result}</h2>
        {shown.length === 0 && <StageEmpty busy={pending} idle={c.empty} working={c.busy} glyph={docGlyph} />}
        <div className={shown.length > 1 ? "stage-cols" : undefined}>
          {shown.map((model) => {
            const item = results[model]!;
            if ("error" in item) return <article className="injection-result" key={model}><h3>{ENGINE_NAMES[model]}</h3><p className="error">{errorText(item.error, t, c.error)}</p></article>;
            const labels = item.asked_contradiction ? c.verdicts : c.verdictsLaya;
            const tone = item.faithfulness >= 0.8 ? "good" : item.faithfulness >= 0.5 ? "warn" : "bad";
            return <article className="ticket-result" key={model}>
              <div className="stage-head"><h3>{ENGINE_NAMES[model]}</h3><span>{Math.round(item.elapsed_ms)} ms</span></div>
              <div className="ground-summary">
                <Dial value={item.faithfulness} tone={tone} caption={c.faithfulness} label={c.faithfulness} />
                <div className="ground-counts">{(["supported", "unsupported", "contradicted"] as Verdict[]).filter((verdict) => verdict !== "contradicted" || item.asked_contradiction).map((verdict) => <span key={verdict} className={`verdict-chip ${verdict}`}><b>{item.counts[verdict]}</b>{verdict === "unsupported" && !item.asked_contradiction ? c.unsupportedCount : labels[verdict]}</span>)}</div>
              </div>
              <div className="ticket-group"><h4>{c.claims}</h4>
                <ol className="claims">{item.claims.map((claim) => <li key={claim.index} className={`claim ${claim.verdict}`} style={{ "--i": claim.index } as CSSProperties}>
                  <span className="claim-mark" aria-hidden="true">{ICON[claim.verdict]}</span>
                  <div className="claim-body"><p>{claim.text}</p>
                    <div className="claim-scores">
                      <span className="claim-score"><small>{c.support}</small><span className="check-bar"><i style={{ width: `${claim.support * 100}%` }} /></span><b className="num">{percent(claim.support)}%</b></span>
                      {claim.contradiction !== null && <span className="claim-score bad"><small>{c.contradiction}</small><span className="check-bar"><i style={{ width: `${claim.contradiction * 100}%` }} /></span><b className="num">{percent(claim.contradiction)}%</b></span>}
                    </div>
                    <small className="claim-verdict">{labels[claim.verdict]}</small>
                  </div>
                </li>)}</ol>
              </div>
              <p className="small muted ticket-note">{item.asked_contradiction ? c.rule(percent(item.thresholds.support), percent(item.thresholds.contradiction)) : c.ruleLaya(percent(item.thresholds.support))} {c.split}</p>
              <p className="small muted">{c.note}</p>
              <details className="stage-more"><summary>{c.details}</summary>
                <CostScale engine={model} cost={item.cost} usage={item.model_response.usage} lang={lang} />
                <div className="ticket-json"><h4>{c.json}</h4><details><summary>{c.http}</summary><pre>{JSON.stringify({ method: "POST", path: "/api/grounding/check", body: { source, answer: reply, lang, engine: model } }, null, 2)}</pre></details><details><summary>{c.sent}</summary><pre>{JSON.stringify(item.model_request, null, 2)}</pre></details><details><summary>{c.received}</summary><pre>{JSON.stringify(item.model_response, null, 2)}</pre></details></div>
              </details>
            </article>;
          })}
        </div>
      </section>
    </div>
  </main>;
}
