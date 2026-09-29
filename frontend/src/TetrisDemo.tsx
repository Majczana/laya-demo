import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { errorText, isAbort, postJson } from "./api";
import { ENGINE_NAMES, useEngine, type Engine } from "./engine";
import { useI18n } from "./i18n";
import { BOARD_HEIGHT, cellsFor, ghostY, newGame, type PieceType, type Placement } from "./tetrisEngine";
import { MAX_LOG, applyEvent, byScore, markError, type Decision, type LogEntry } from "./tetrisLog";
import {
  DEFAULT_SETTINGS,
  createSession,
  forgetRequest,
  pause as pauseSession,
  receive,
  summarize,
  takeRequest,
  tick,
  type Session,
  type Settings,
  type Summary,
} from "./tetrisSession";
import { LogItem, MiniPiece, RecentGames, TimingHud, type GameRecord } from "./TetrisPanels";

type ChoiceResponse = {
  elapsed_ms: number;
  selected_index: number;
  scores: number[];
  question: string;
  descriptions: string[];
};

/** How many of the engine's ranked moves the model chooses from. */
type CandidateLimit = "4" | "8" | "all";
const CANDIDATE_LIMITS: CandidateLimit[] = ["4", "8", "all"];

/** The backend answered, but with an index the game cannot use. */
class InvalidMove extends Error {}
type DisplayCell = PieceType | "ghost" | "target" | null;

/** Starting gravity for the 1–10 slider, in milliseconds per row. */
const GRAVITY_STEPS = [1200, 900, 650, 480, 350, 250, 180, 120, 80, 50];
const DEFAULT_LEVEL = 4;
const RAMPS = { off: { every: 0, factor: 1 }, slow: { every: 5, factor: 0.9 }, fast: { every: 5, factor: 0.8 } } as const;
type RampKey = keyof typeof RAMPS;
const RAMP_KEYS: RampKey[] = ["off", "slow", "fast"];

const SLOTS = 4;
const MAX_GAMES = 20;
const MAX_FRAME_MS = 100;
const LEVEL_KEY = "laya-demo:tetris-gravity";
const RAMP_KEY = "laya-demo:tetris-ramp";
const LIMIT_KEY = "laya-demo:tetris-candidates";
const GAMES_KEY = "laya-demo:tetris-games-v2";

const percent = (value: number) => Math.round(value * 100);

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function readLevel(): number {
  try {
    const value = Number(window.localStorage.getItem(LEVEL_KEY));
    return Number.isInteger(value) && value >= 1 && value <= GRAVITY_STEPS.length ? value : DEFAULT_LEVEL;
  } catch {
    return DEFAULT_LEVEL;
  }
}

// Session storage: the list survives a reload of this tab but not a new session.
function readGames(): GameRecord[] {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(GAMES_KEY) ?? "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function buildSettings(level: number, ramp: RampKey, limit: CandidateLimit): Settings {
  return {
    ...DEFAULT_SETTINGS,
    gravityMs: GRAVITY_STEPS[level - 1],
    rampEvery: RAMPS[ramp].every,
    rampFactor: RAMPS[ramp].factor,
    candidates: limit === "all" ? "all" : Number(limit),
  };
}

function displayCells(session: Session): DisplayCell[] {
  const { game, plan } = session;
  const grid: DisplayCell[][] = game.board.map((row) => [...row]);
  const outline = plan
    ? { rotation: plan.target.rotation, x: plan.target.x, y: plan.target.y, kind: "target" as const }
    : { rotation: game.active.rotation, x: game.active.x, y: ghostY(game.board, game.active), kind: "ghost" as const };
  for (const { x, y } of cellsFor(game.active.type, outline.rotation)) {
    const row = outline.y + y;
    if (row >= 0 && row < BOARD_HEIGHT && grid[row][outline.x + x] === null) {
      grid[row][outline.x + x] = outline.kind;
    }
  }
  for (const { x, y } of cellsFor(game.active.type, game.active.rotation)) {
    const row = game.active.y + y;
    if (row >= 0 && row < BOARD_HEIGHT) grid[row][game.active.x + x] = game.active.type;
  }
  return grid.flat();
}

/** Totals for the game in progress; each game has one model and one set of settings. */
type Run = { engine: Engine; key: string; rated: number; totalScore: number; saved: boolean; gravityMs: number; limit: CandidateLimit };

export function TetrisDemo() {
  const { t } = useI18n();
  const { backend, engine } = useEngine();
  const [level, setLevel] = useState(readLevel);
  const [ramp, setRamp] = useState<RampKey>(() => readStored(RAMP_KEY, RAMP_KEYS, "slow"));
  const [limit, setLimit] = useState<CandidateLimit>(() => readStored(LIMIT_KEY, CANDIDATE_LIMITS, "4"));
  const [session, setSession] = useState<Session>(() => createSession(buildSettings(level, ramp, limit), newGame()));
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary>(() => summarize([]));
  const [log, setLog] = useState<LogEntry[]>(() => [{ kind: "game", id: "0:game", time: Date.now(), engine }]);
  const [games, setGames] = useState(readGames);
  const [error, setError] = useState<{ reason: unknown; engine: Engine } | null>(null);

  const runKey = `${engine}|${level}|${ramp}|${limit}`;
  const sessionRef = useRef(session);
  const engineRef = useRef(engine);
  const readyRef = useRef(false);
  const inFlightRef = useRef(false);
  const generationRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const runRef = useRef<Run>({ engine, key: runKey, rated: 0, totalScore: 0, saved: false, gravityMs: GRAVITY_STEPS[level - 1], limit });
  sessionRef.current = session;
  engineRef.current = engine;
  readyRef.current = backend.state === "ready";

  const modelName = ENGINE_NAMES[engine];
  const modelId = backend.state === "ready" ? backend.health.engines[engine].model : "";

  /** Saves the current game once, when it ends, is restarted or a setting changes. */
  const recordGame = useCallback((result: GameRecord["result"]) => {
    const run = runRef.current;
    const current = sessionRef.current;
    if (run.saved || current.reports.length === 0) return;
    run.saved = true;
    const totals = summarize(current.reports);
    const record: GameRecord = {
      id: Date.now(), engine: run.engine, candidates: run.limit, gravityMs: run.gravityMs, endedAt: Date.now(),
      score: current.game.score, lines: current.game.lines, pieces: totals.pieces, onTarget: totals.onTarget,
      avgAnswerMs: totals.avgAnswerMs, avgScore: run.rated ? run.totalScore / run.rated : null, result,
    };
    setGames((previous) => [record, ...previous].slice(0, MAX_GAMES));
  }, []);

  const startGame = useCallback(() => {
    generationRef.current++;
    requestRef.current?.abort();
    requestRef.current = null;
    inFlightRef.current = false;
    setError(null);
    setDecision(null);
    setSummary(summarize([]));
    const fresh = createSession(buildSettings(level, ramp, limit), newGame());
    runRef.current = { engine: engineRef.current, key: runKey, rated: 0, totalScore: 0, saved: false, gravityMs: GRAVITY_STEPS[level - 1], limit };
    setLog((previous) => [{ kind: "game" as const, id: `${generationRef.current}:game`, time: Date.now(), engine: engineRef.current }, ...previous].slice(0, MAX_LOG));
    sessionRef.current = fresh;
    setSession(fresh);
  }, [level, ramp, limit, runKey]);

  /** Asks the model about the current piece. One request at a time; the clock keeps running meanwhile. */
  const ask = useCallback(async () => {
    const current = sessionRef.current;
    if (inFlightRef.current) return;
    const request = takeRequest(current);
    if (!request) return;
    inFlightRef.current = true;
    const generation = generationRef.current;
    const requestEngine = engineRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const data = await postJson<ChoiceResponse>("/tetris/choose", {
        candidates: request.candidates.map(({ linesCleared, holes, maxHeight, bumpiness, nextLinePotential }) => (
          { linesCleared, holes, maxHeight, bumpiness, nextLinePotential }
        )),
        board: request.board,
        engine: requestEngine,
      }, controller.signal);
      if (generation !== generationRef.current) return;
      if (
        !Number.isInteger(data.selected_index)
        || data.selected_index < 0
        || data.selected_index >= request.candidates.length
        || !Array.isArray(data.scores)
        || data.scores.length !== request.candidates.length
        || !data.scores.every(Number.isFinite)
      ) throw new InvalidMove();
      setQuestion(data.question);
      const applied = receive(current, request.serial, {
        candidates: request.candidates, chosen: data.selected_index, scores: data.scores,
        descriptions: data.descriptions, modelMs: data.elapsed_ms,
      });
      if (applied) {
        runRef.current.rated++;
        runRef.current.totalScore += data.scores[data.selected_index];
      }
    } catch (reason) {
      if (generation === generationRef.current && !isAbort(reason)) {
        // Pause instead of playing on without the model; resuming asks again.
        forgetRequest(current);
        if (current.game.status === "playing") pauseSession(current);
        setError({ reason, engine: requestEngine });
        setLog((previous) => markError(previous, generation, request.serial));
      }
    } finally {
      if (generation === generationRef.current) {
        requestRef.current = null;
        inFlightRef.current = false;
      }
    }
  }, []);

  // The game loop: advance the clock by real time, ask the model when a new piece needs it,
  // and turn session events into log entries. Redraw only when something visible changed.
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let drawn = -1;
    let drawnSession: Session | null = null;
    const loop = (now: number) => {
      const current = sessionRef.current;
      const dt = Math.min(now - last, MAX_FRAME_MS);
      last = now;
      if (readyRef.current && current.game.status === "playing") {
        tick(current, dt);
        void ask();
      }
      if (current.events.length > 0) {
        const events = current.events.splice(0);
        const context = { generation: generationRef.current, engine: runRef.current.engine, now: Date.now() };
        setLog((previous) => events.reduce((entries, event) => applyEvent(entries, event, context), previous));
        for (const event of events) {
          if (event.type === "answer") setDecision({ ...event.choice, engine: context.engine, serial: event.serial });
          if (event.type === "lock") setSummary(summarize(current.reports));
        }
        if (events.some((event) => event.type === "over")) recordGame("over");
      }
      if (current !== drawnSession || current.version !== drawn) {
        drawnSession = current;
        drawn = current.version;
        redraw();
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [ask, recordGame]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LEVEL_KEY, String(level));
      window.localStorage.setItem(RAMP_KEY, ramp);
      window.localStorage.setItem(LIMIT_KEY, limit);
    } catch {
      // The settings still work if storage is unavailable.
    }
  }, [level, ramp, limit]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(GAMES_KEY, JSON.stringify(games));
    } catch {
      // The list still works for this page view if storage is unavailable.
    }
  }, [games]);

  // One game is played by one model with one set of settings, so changing any of them starts a new game.
  useEffect(() => {
    if (runRef.current.key === runKey) return;
    recordGame("stopped");
    startGame();
  }, [runKey, recordGame, startGame]);

  useEffect(() => () => {
    generationRef.current++;
    requestRef.current?.abort();
  }, []);

  const restart = () => {
    recordGame("stopped");
    startGame();
  };

  const togglePaused = () => {
    if (session.game.status === "paused") setError(null);
    pauseSession(session);
    redraw();
  };

  const { game } = session;
  const asking = session.requested && !session.choice;
  const status = game.status === "over" ? t.tetris.gameOver
    : session.plan ? t.tetris.executing
    : session.choice ? t.tetris.lost
    : asking ? t.tetris.thinking(modelName)
    : t.tetris.watching;
  const levelNumber = Math.floor(game.lines / 10) + 1;
  const cells = displayCells(session);
  const ranked = decision ? byScore(decision) : [];
  const rampInfo = RAMPS[ramp];
  const errorMessage = error
    ? `${error.reason instanceof InvalidMove
      ? t.tetris.invalidMove(ENGINE_NAMES[error.engine])
      : errorText(error.reason, t, t.tetris.noResponse(ENGINE_NAMES[error.engine]))} ${t.tetris.pausedAfterError}`
    : null;

  return (
    <main className="tetris-page">
      <div className="page-heading">
        <h1>{t.tetris.heading}</h1>
        <p className="muted">{t.tetris.intro}</p>
      </div>

      <div className="tetris-layout">
        <section className="panel tetris-log" aria-label={t.tetris.logTitle}>
          <h2>{t.tetris.logTitle}</h2>
          <div className="log-body">
            <ol className="log-list" aria-live="polite">
              {log.length === 0 && <li className="muted">{t.tetris.logEmpty}</li>}
              {log.map((entry) => <LogItem key={entry.id} entry={entry} />)}
            </ol>
          </div>
        </section>

        <div className="tetris-play">
          <div className="tetris-board-frame">
            <div className="tetris-board" role="img" aria-label={t.tetris.board(game.lines)}>
              {cells.map((cell, index) => (
                <span
                  className={`tetris-cell ${cell === "ghost" ? "is-ghost" : cell === "target" ? "is-target" : cell ? `piece-${cell}` : ""}`}
                  key={index}
                />
              ))}
            </div>
            {game.status !== "playing" && (
              <div className="tetris-overlay">
                <strong>{game.status === "over" ? t.tetris.gameOver : t.tetris.paused}</strong>
                {game.status === "over" && (
                  <button className="button button-primary" type="button" onClick={restart}>{t.tetris.playAgain}</button>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="tetris-side">
          <dl className="stats">
            <div><dt>{t.tetris.score}</dt><dd className="num">{game.score.toLocaleString(t.locale)}</dd></div>
            <div><dt>{t.tetris.lines}</dt><dd className="num">{game.lines}</dd></div>
            <div><dt>{t.tetris.level}</dt><dd className="num">{levelNumber}</dd></div>
            <div>
              <dt>{t.tetris.combo}</dt>
              <dd className="num">{game.combo > 1 ? `×${game.combo}` : "–"} <small>{t.tetris.best(game.bestCombo)}</small></dd>
            </div>
          </dl>

          <section className="panel">
            <h2>{modelName} <span className="model-id num">{modelId}</span></h2>
            <div className="model-now">
              <p className={`status${session.choice && !session.plan ? " is-lost" : ""}`} aria-live="polite">{status}</p>
              <div className="next-piece">
                <span className="label">{t.tetris.next}</span>
                <MiniPiece type={game.queue[0] ?? null} />
              </div>
            </div>

            <TimingHud session={session} summary={summary} late={session.lateAnswers} />

            <div className="decision">
              <span className="label">
                {t.tetris.decisionTitle}
                {decision && ` · ${ENGINE_NAMES[decision.engine]} · #${decision.serial}`}
                {decision && decision.candidates.length > SLOTS && ` · ${t.tetris.decisionTop(SLOTS, decision.candidates.length)}`}
              </span>
              <ol className="candidates">
                {Array.from({ length: SLOTS }, (_, slot) => {
                  const index = decision ? ranked[slot] ?? -1 : -1;
                  const candidate: Placement | undefined = decision?.candidates[index];
                  const score = decision?.scores?.[index];
                  const chosen = candidate !== undefined && index === decision?.chosen;
                  return (
                    <li key={slot} className={chosen ? "is-chosen" : undefined}>
                      <span className="candidate-head">
                        <span>{candidate ? t.tetris.candidate(candidate.x + 1, candidate.rotation * 90) : "–"}</span>
                        <span className="num">
                          {score !== undefined ? `${percent(score)}%` : ""}
                          {chosen ? ` · ${t.tetris.chosen}` : ""}
                        </span>
                      </span>
                      <span className="score-bar" aria-hidden="true">
                        <span style={{ width: `${(score ?? (chosen ? 1 : 0)) * 100}%` }} />
                      </span>
                      <span className="candidate-text">{decision?.descriptions?.[index] ?? ""}</span>
                    </li>
                  );
                })}
              </ol>
              <small className="muted">
                {!decision ? t.tetris.noDecision
                  : decision.scores && decision.modelMs !== null ? t.tetris.response(Math.round(decision.modelMs))
                  : t.tetris.onlyMove}
              </small>
            </div>

            <details className="question">
              <summary>{t.tetris.question}</summary>
              <p className="small muted">{question ?? "…"}</p>
            </details>
            {errorMessage && <p className="error" role="alert">{errorMessage}</p>}
          </section>

          <section className="panel">
            <h2>{t.tetris.gameTitle}</h2>
            <label className="slider">
              <span>{t.tetris.gravity} <span className="num">{level}/{GRAVITY_STEPS.length}</span></span>
              <input
                type="range"
                min="1"
                max={GRAVITY_STEPS.length}
                step="1"
                value={level}
                onChange={(event) => setLevel(Number(event.target.value))}
              />
              <small className="muted">{t.tetris.gravityNote(GRAVITY_STEPS[level - 1])}</small>
            </label>
            <div className="setting">
              <span>{t.tetris.ramp}</span>
              <div className="lang-switch" role="group" aria-label={t.tetris.ramp}>
                {RAMP_KEYS.map((option) => (
                  <button type="button" key={option} aria-pressed={ramp === option} onClick={() => setRamp(option)}>
                    {t.tetris.rampOptions[option]}
                  </button>
                ))}
              </div>
              <small className="muted">{t.tetris.rampNote(rampInfo.every, Math.round((1 - rampInfo.factor) * 100))}</small>
            </div>
            <div className="setting">
              <span>{t.tetris.candidatesLabel}</span>
              <div className="lang-switch" role="group" aria-label={t.tetris.candidatesLabel}>
                {CANDIDATE_LIMITS.map((option) => (
                  <button type="button" key={option} aria-pressed={limit === option} onClick={() => setLimit(option)}>
                    {option === "all" ? t.tetris.candidatesAll : option}
                  </button>
                ))}
              </div>
              <small className="muted">{t.tetris.candidatesNote}</small>
            </div>
            <div className="button-row">
              <button className="button" type="button" onClick={togglePaused} disabled={game.status === "over"}>
                {game.status === "paused" ? t.tetris.resume : t.tetris.pause}
              </button>
              <button className="button" type="button" onClick={restart}>{t.tetris.newGame}</button>
            </div>
          </section>
        </aside>
      </div>

      <RecentGames games={games} />

      <p className="muted small tetris-note">{t.tetris.disclaimer}</p>
    </main>
  );
}
