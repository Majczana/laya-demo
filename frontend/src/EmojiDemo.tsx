import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmojiPile, type LiftedItem } from "./EmojiPile";
import { errorText, getJson, isAbort, postJson } from "./api";
import { ENGINE_NAMES, useEngine, type Engine } from "./engine";
import { useI18n, type Lang } from "./i18n";

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
  lang: Lang;
  engine: Engine;
  model: string;
  elapsed_ms: number;
  items: PredictionItem[];
};

type Status =
  | { kind: "connecting" | "waiting" | "ready" | "analyzing" | "predictionError" | "unavailable" }
  | { kind: "elapsed"; ms: number; engine: Engine };

type Failure = { reason: unknown; fallback: "catalogFailed" | "predictionFailed" };

type Query = { text: string; lang: Lang; engine: Engine };

const REQUEST_DELAY_MS = 70;
const MAX_LIFTED = 12;
// Measured with examples/diagnose_emoji_typing.py on 34 Polish phrases. The
// models score on different scales, so each has its own threshold. LAYA: best
// F1 (lifted emoji that are right vs expected emoji found). Jev: 0.55 had a
// slightly better F1 but left four phrases, "jedzenie" among them, with
// nothing lifted; 0.45 leaves one and is as quiet while typing.
const DEFAULT_THRESHOLDS: Record<Engine, number> = { laya: 0.85, jev: 0.45 };
// One or two typed letters mostly produced wrong emoji (Jev: 8 of 9 cases);
// three still allows short words such as "kot" or "zoo".
const MIN_CHARS = 3;
// Real phrases lift at most 7 emoji at these thresholds; LAYA marks 44-86 of
// 200 emoji for gibberish such as "asdfgh", so that many means no clear match.
const NO_CLEAR_MATCH = 20;

function thresholdKey(engine: Engine) {
  // v2: the defaults changed after measuring, so older stored values are dropped.
  return `laya-demo:emoji-threshold:v2:${engine}`;
}

function readStoredThreshold(engine: Engine) {
  try {
    const stored = window.localStorage.getItem(thresholdKey(engine));
    const value = stored === null ? NaN : Number(stored);
    return value > 0 && value < 1 ? value : DEFAULT_THRESHOLDS[engine];
  } catch {
    return DEFAULT_THRESHOLDS[engine];
  }
}

export function EmojiDemo() {
  const { lang, t } = useI18n();
  const { backend, engine } = useEngine();
  const device = backend.state === "ready" ? backend.health.device : null;
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [text, setText] = useState("");
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "connecting" });
  const [failure, setFailure] = useState<Failure | null>(null);
  const [thresholds, setThresholds] = useState(() => ({
    laya: readStoredThreshold("laya"),
    jev: readStoredThreshold("jev"),
  }));
  const threshold = thresholds[engine];
  const latestQuery = useRef<Query>({ text: "", lang, engine });
  const inFlight = useRef(false);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      for (const [name, value] of Object.entries(thresholds)) {
        window.localStorage.setItem(thresholdKey(name as Engine), String(value));
      }
    } catch {
      // The slider still works if storage is unavailable.
    }
  }, [thresholds]);

  useEffect(() => {
    if (backend.state === "offline") setStatus({ kind: "waiting" });
  }, [backend.state]);

  // Labels come from the catalog of the selected language. The IDs are the
  // same in every language, so the pile keeps its shape when switching.
  useEffect(() => {
    if (device === null) return;
    const controller = new AbortController();
    getJson<{ items: CatalogItem[] }>(`/catalog?lang=${lang}`, controller.signal)
      .then((data) => {
        setCatalog(data.items);
        setFailure(null);
      })
      .catch((reason) => {
        if (isAbort(reason)) return;
        setFailure({ reason, fallback: "catalogFailed" });
        setStatus({ kind: "unavailable" });
      });
    return () => controller.abort();
  }, [device, lang]);

  // LAYA handles one request at a time and Jev is paid per request; send the
  // newest text after each response.
  const sendLatest = useCallback(async () => {
    const query = latestQuery.current;
    if (inFlight.current || !query.text) return;

    inFlight.current = true;
    setStatus({ kind: "analyzing" });
    setFailure(null);

    try {
      const data = await postJson<PredictionResponse>("/predict", query);
      if (latestQuery.current === query) {
        setPrediction(data);
        setStatus({ kind: "elapsed", ms: Math.round(data.elapsed_ms), engine: data.engine });
      }
    } catch (reason) {
      if (latestQuery.current === query) {
        setFailure({ reason, fallback: "predictionFailed" });
        setStatus({ kind: "predictionError" });
      }
    } finally {
      inFlight.current = false;
    }

    if (latestQuery.current.text.length >= MIN_CHARS && latestQuery.current !== query) sendLatest();
  }, []);

  useEffect(() => {
    const query = { text: text.trim(), lang, engine };
    latestQuery.current = query;

    if (query.text.length < MIN_CHARS) {
      setPrediction(null);
      setFailure(null);
      if (catalog.length) setStatus({ kind: "ready" });
      return;
    }
    // Typing before the backend is ready would only produce errors; the text
    // is sent as soon as the catalog arrives.
    if (!catalog.length) return;

    const timer = window.setTimeout(sendLatest, REQUEST_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text, lang, engine, catalog.length, sendLatest]);

  // Keep the previous result on screen while the next one is computed, so the
  // lifted emoji do not drop and rise again on every keystroke.
  const visiblePrediction = text.trim().length >= MIN_CHARS ? prediction : null;
  // Until the other model answers, the shown scores keep their own threshold.
  const liftThreshold = visiblePrediction ? thresholds[visiblePrediction.engine] : threshold;

  const matchCount = visiblePrediction
    ? visiblePrediction.items.filter((item) => item.score >= liftThreshold).length
    : 0;
  const noClearMatch = matchCount > NO_CLEAR_MATCH;

  const lifted = useMemo<LiftedItem[]>(
    () =>
      visiblePrediction && !noClearMatch
        ? visiblePrediction.items
            .filter((item) => item.score >= liftThreshold)
            .sort((a, b) => a.rank - b.rank)
            .slice(0, MAX_LIFTED)
            .map(({ id, score }) => ({ id, score }))
        : [],
    [visiblePrediction, liftThreshold, noClearMatch],
  );

  const statusText =
    status.kind === "elapsed" ? t.emoji.elapsed(status.ms, ENGINE_NAMES[status.engine])
    : status.kind === "ready" ? t.emoji.ready(device ?? "")
    : t.emoji[status.kind];

  return (
    <main className="emoji-stage">
      <EmojiPile items={catalog} lifted={lifted} anchorRef={panelRef} />

      <section className="emoji-panel" ref={panelRef}>
        <h1>{t.emoji.heading}</h1>
        <p className="muted">{t.emoji.intro}</p>

        <label className="field">
          <span className="sr-only">{t.emoji.inputLabel}</span>
          <input
            className="text-input"
            autoFocus
            maxLength={240}
            onChange={(event) => setText(event.target.value)}
            placeholder={t.emoji.placeholder}
            spellCheck={false}
            value={text}
          />
        </label>

        <div className="emoji-meta">
          <span className={`status ${failure ? "is-error" : ""}`} aria-live="polite">
            {failure ? errorText(failure.reason, t, t.emoji[failure.fallback]) : statusText}
          </span>
          <label className="threshold" title={t.emoji.thresholdDefault(ENGINE_NAMES[engine], Math.round(DEFAULT_THRESHOLDS[engine] * 100))}>
            <span>{t.emoji.threshold(ENGINE_NAMES[engine])}</span>
            <input
              type="range"
              min={0.05}
              max={0.95}
              step={0.05}
              value={threshold}
              onChange={(event) => {
                const value = Number(event.target.value);
                setThresholds((previous) => ({ ...previous, [engine]: value }));
              }}
            />
            <span className="num">{Math.round(threshold * 100)}%</span>
          </label>
        </div>
        <p className="emoji-count muted" aria-live="polite">
          {text.trim() && text.trim().length < MIN_CHARS
            ? t.emoji.tooShort(MIN_CHARS)
            : visiblePrediction && noClearMatch
            ? t.emoji.noClearMatch(matchCount, visiblePrediction.items.length)
            : visiblePrediction
            ? matchCount > MAX_LIFTED
              ? t.emoji.manyMatches(matchCount, MAX_LIFTED)
              : t.emoji.matches(matchCount, visiblePrediction.items.length)
            : t.emoji.thresholdHint(ENGINE_NAMES[engine], Math.round(DEFAULT_THRESHOLDS[engine] * 100))}
        </p>
      </section>
    </main>
  );
}
