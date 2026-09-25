import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type CatalogItem = {
  id: string;
  emoji: string;
  label: string;
};

type PredictionItem = CatalogItem & {
  score: number;
  rank: number;
};

type PredictionResponse = {
  text: string;
  model: string;
  device: string;
  elapsed_ms: number;
  items: PredictionItem[];
};

type EmojiStyle = CSSProperties & {
  "--x": string;
  "--y": string;
  "--rotation": string;
  "--delay": string;
  "--lift": string;
  "--scale": string;
  "--opacity": string;
};

const REQUEST_DELAY_MS = 70;

function pseudoRandom(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function emojiStyle(index: number, score: number | null): EmojiStyle {
  const column = index % 10;
  const row = Math.floor(index / 10);
  const jitterX = (pseudoRandom(index + 1) - 0.5) * 5;
  const jitterY = (pseudoRandom(index + 101) - 0.5) * 5;
  const strength = score ?? 0.36;

  return {
    "--x": `${5 + column * 10 + jitterX}%`,
    "--y": `${5 + row * 10 + jitterY}%`,
    "--rotation": `${(pseudoRandom(index + 211) - 0.5) * 18}deg`,
    "--delay": `${-pseudoRandom(index + 307) * 4}s`,
    "--lift": `${-8 - strength * 76}px`,
    "--scale": `${0.72 + strength * 0.62}`,
    "--opacity": `${score === null ? 0.74 : 0.12 + strength * 0.88}`,
  };
}

export default function App() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [text, setText] = useState("");
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [status, setStatus] = useState("Ładowanie katalogu…");
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCatalog() {
      try {
        const response = await fetch("/api/catalog", { signal: controller.signal });
        if (!response.ok) throw new Error(`API zwróciło ${response.status}`);
        const data = (await response.json()) as { items: CatalogItem[] };
        setCatalog(data.items);
        setStatus("Model gotowy · zacznij pisać");
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError("Nie udało się połączyć z backendem LAYA.");
        setStatus("Brak połączenia");
      }
    }

    loadCatalog();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const query = text.trim();
    const currentRequest = ++requestId.current;

    if (!query) {
      setPrediction(null);
      setError(null);
      if (catalog.length) setStatus("Model gotowy · zacznij pisać");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("LAYA analizuje…");
      setError(null);

      try {
        const response = await fetch("/api/predict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: query }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`API zwróciło ${response.status}`);

        const data = (await response.json()) as PredictionResponse;
        if (currentRequest !== requestId.current) return;
        setPrediction(data);
        setStatus(`${data.elapsed_ms.toFixed(0)} ms · ${data.device}`);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        if (currentRequest !== requestId.current) return;
        setError("Predykcja nie powiodła się. Sprawdź backend.");
        setStatus("Błąd predykcji");
      }
    }, REQUEST_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [text, catalog.length]);

  const scores = useMemo(
    () => new Map(prediction?.items.map((item) => [item.id, item]) ?? []),
    [prediction],
  );

  const topItems = useMemo(
    () =>
      prediction
        ? [...prediction.items].sort((a, b) => a.rank - b.rank).slice(0, 5)
        : [],
    [prediction],
  );

  return (
    <main className="stage">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <div className="emoji-field" aria-label="Pole stu emoji ocenianych przez LAYA">
        {catalog.map((item, index) => {
          const result = scores.get(item.id);
          const score = result?.score ?? null;
          return (
            <span
              className={`emoji-slot ${result && result.rank <= 5 ? "is-top" : ""}`}
              key={item.id}
              style={emojiStyle(index, score)}
              title={`${item.label}${score === null ? "" : ` · ${(score * 100).toFixed(1)}%`}`}
            >
              <span className="emoji-glyph">{item.emoji}</span>
            </span>
          );
        })}
      </div>

      <section className="control-panel">
        <p className="eyebrow">LAYA · 100 niezależnych decyzji</p>
        <h1>Co masz na myśli?</h1>
        <p className="intro">
          Pisz lub usuwaj znaki. Emoji reagują także na niepełne słowa.
        </p>

        <label className="prompt">
          <span className="sr-only">Tekst dla modelu</span>
          <input
            autoFocus
            maxLength={240}
            onChange={(event) => setText(event.target.value)}
            placeholder="np. jedzenie zdrowe"
            spellCheck={false}
            value={text}
          />
          <span className={`status ${error ? "has-error" : ""}`} aria-live="polite">
            <span className="status-dot" />
            {error ?? status}
          </span>
        </label>

        <div className="top-results" aria-live="polite">
          {topItems.map((item) => (
            <span className="result-chip" key={item.id}>
              <span>{item.emoji}</span>
              {item.label}
              <strong>{Math.round(item.score * 100)}%</strong>
            </span>
          ))}
        </div>
      </section>
    </main>
  );
}
