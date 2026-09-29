import type { Engine } from "./engine";
import type { Lang } from "./i18n";

const COUNTS = [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000];
const JEV_INPUT_USD_PER_MILLION = 0.042;
const JEV_OUTPUT_USD_PER_MILLION = 0;
const SOURCE = "https://openrouter.ai/typesafe/jev-1.13/api";

type Props = {
  engine: Engine;
  cost: { usd: number | null; source: "local_api" | "provider" | "unreported" };
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  lang: Lang;
};

function money(value: number, lang: Lang) {
  return `${new Intl.NumberFormat(lang === "pl" ? "pl-PL" : "en-US", { minimumFractionDigits: value > 0 && value < 0.01 ? 6 : 2, maximumFractionDigits: 8 }).format(value)} USD`;
}

export function CostScale({ engine, cost, usage, lang }: Props) {
  const pl = lang === "pl";
  const derived = engine === "jev" && typeof usage?.input_tokens === "number"
    ? usage.input_tokens * JEV_INPUT_USD_PER_MILLION / 1_000_000
    : null;
  const perCall = engine === "laya" ? 0 : cost.usd ?? derived;
  const estimated = engine === "jev" && cost.usd === null && derived !== null;

  return <section className="cost-scale">
    <h4>{pl ? "Cennik i skala wywołań" : "Token pricing and call volume"}</h4>
    <div className="cost-rates">
      <div><span>{pl ? "1 mln tokenów wejścia" : "1M input tokens"}</span><strong>{engine === "jev" ? money(JEV_INPUT_USD_PER_MILLION, lang) : pl ? "bez opłaty API" : "no API fee"}</strong></div>
      <div><span>{pl ? "1 mln tokenów wyjścia" : "1M output tokens"}</span><strong>{engine === "jev" ? money(JEV_OUTPUT_USD_PER_MILLION, lang) : pl ? "bez opłaty API" : "no API fee"}</strong></div>
    </div>
    <p className="small muted">{engine === "laya"
      ? pl ? "LAYA działa lokalnie. Sprzęt, energia i utrzymanie nie są tu wycenione." : "LAYA runs locally. Hardware, electricity and operations are not priced here."
      : <>{pl ? "Stawki Jev w OpenRouter, sprawdzone 29.09.2026. " : "Jev rates on OpenRouter, checked 2026-09-29. "}<a href={SOURCE} target="_blank" rel="noreferrer">{pl ? "Aktualny cennik" : "Current pricing"}</a>.</>}
    </p>
    {usage && <p className="small muted">{pl ? "To wywołanie:" : "This call:"} {usage.input_tokens ?? "—"} {pl ? "wejściowych" : "input"} / {usage.output_tokens ?? "—"} {pl ? "wyjściowych tokenów" : "output tokens"}</p>}
    <table><thead><tr><th>{pl ? "Liczba zapytań" : "Calls"}</th><th>{pl ? "Koszt API" : "API cost"}</th></tr></thead>
      <tbody>{COUNTS.map((count) => <tr key={count}><td>{new Intl.NumberFormat(lang === "pl" ? "pl-PL" : "en-US").format(count)}×</td><td>{perCall === null ? "—" : money(perCall * count, lang)}</td></tr>)}</tbody>
    </table>
    <p className="small muted">{engine === "laya"
      ? pl ? "Tabela obejmuje tylko opłatę API, nie całkowity koszt działania." : "The table covers API fees only, not total operating cost."
      : estimated
        ? pl ? "Projekcja z liczby tokenów tego wywołania i podanej stawki; dostawca nie zwrócił kosztu." : "Projection from this call's token count and listed rate; the provider did not return a cost."
        : pl ? "Projekcja: koszt tego wywołania × liczba identycznych zapytań. Inne tickety mogą mieć inną liczbę tokenów." : "Projection: this call's cost × the number of identical calls. Other tickets may use different token counts."}
    </p>
  </section>;
}
