import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmojiPile, type LiftedItem } from "./EmojiPile";

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

const REQUEST_DELAY_MS = 70;
const DEFAULT_THRESHOLD = 0.7;
const MAX_LIFTED = 12;
const THRESHOLD_KEY = "laya-demo:threshold";

function readStoredThreshold() {
  try {
    const stored = Number(window.localStorage.getItem(THRESHOLD_KEY));
    return stored > 0 && stored < 1 ? stored : DEFAULT_THRESHOLD;
  } catch {
    return DEFAULT_THRESHOLD;
  }
}

export default function App() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [text, setText] = useState("");
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [status, setStatus] = useState("Ładowanie katalogu…");
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(readStoredThreshold);
  const latestQuery = useRef("");
  const inFlight = useRef(false);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(THRESHOLD_KEY, String(threshold));
    } catch {
      // Storage is only a convenience; the slider still works without it.
    }
  }, [threshold]);

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
        setError("Nie udało się połączyć z backendem.");
        setStatus("Brak połączenia");
      }
    }

    loadCatalog();
    return () => controller.abort();
  }, []);

  // The model handles one prediction at a time, so keep at most one request in
  // flight and, when it returns, send only the newest text. Firing a request
  // per keystroke would queue them on the backend and add up their latency.
  const sendLatest = useCallback(async () => {
    const query = latestQuery.current;
    if (inFlight.current || !query) return;

    inFlight.current = true;
    setStatus("Model analizuje…");
    setError(null);

    try {
      const response = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: query }),
      });
      if (!response.ok) throw new Error(`API zwróciło ${response.status}`);

      const data = (await response.json()) as PredictionResponse;
      if (latestQuery.current) {
        setPrediction(data);
        setStatus(`${data.elapsed_ms.toFixed(0)} ms · ${data.device}`);
      }
    } catch {
      if (latestQuery.current) {
        setError("Predykcja nie powiodła się. Sprawdź backend.");
        setStatus("Błąd predykcji");
      }
    } finally {
      inFlight.current = false;
    }

    if (latestQuery.current && latestQuery.current !== query) sendLatest();
  }, []);

  useEffect(() => {
    const query = text.trim();
    latestQuery.current = query;

    if (!query) {
      setPrediction(null);
      setError(null);
      if (catalog.length) setStatus("Model gotowy · zacznij pisać");
      return;
    }

    const timer = window.setTimeout(sendLatest, REQUEST_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text, catalog.length, sendLatest]);

  const lifted = useMemo<LiftedItem[]>(
    () =>
      prediction
        ? prediction.items
            .filter((item) => item.score >= threshold)
            .sort((a, b) => a.rank - b.rank)
            .slice(0, MAX_LIFTED)
            .map(({ id, score }) => ({ id, score }))
        : [],
    [prediction, threshold],
  );

  const matchCount = prediction
    ? prediction.items.filter((item) => item.score >= threshold).length
    : 0;

  return (
    <main className="stage">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <EmojiPile items={catalog} lifted={lifted} anchorRef={panelRef} />

      <section className="control-panel" ref={panelRef}>
        <p className="eyebrow">Embeddingi · 100 emoji</p>
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

        <label className="threshold">
          <span>
            Próg dopasowania <strong>{Math.round(threshold * 100)}%</strong>
          </span>
          <input
            type="range"
            min={0.05}
            max={0.95}
            step={0.05}
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
          />
          <span className="threshold-note" aria-live="polite">
            {prediction
              ? matchCount > MAX_LIFTED
                ? `${matchCount} pasuje · unosi się ${MAX_LIFTED} najlepszych`
                : `${matchCount} z ${prediction.items.length} emoji pasuje`
              : "Emoji powyżej progu uniosą się nad stos"}
          </span>
        </label>
      </section>
    </main>
  );
}
