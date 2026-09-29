import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { errorText, isAbort, postJson } from "./api";
import { ENGINE_NAMES, useEngine, type Engine } from "./engine";
import { useI18n } from "./i18n";
import { DEFAULT_HEIGHT, DEFAULT_WIDTH, newGame, type Move, type Strategy } from "./snakeEngine";
import {
  DEFAULT_SETTINGS,
  createSession,
  forgetRequest,
  isStrategy,
  pause as pauseSession,
  receive,
  summarize,
  takeRequest,
  tick,
  type Choice,
  type Mode,
  type ModelRequest,
  type Session,
  type SessionEvent,
  type Settings,
  type Summary,
} from "./snakeSession";

type ChoiceResponse = {
  elapsed_ms: number;
  selected_index: number;
  scores: number[];
  question: string;
  descriptions: string[];
};

/** The backend answered, but with an index the game cannot use. */
class InvalidMove extends Error {}

/** Starting speed for the 1–10 slider, in milliseconds per move. */
const SPEED_STEPS = [900, 700, 550, 420, 320, 240, 180, 130, 90, 60];
const DEFAULT_LEVEL = 4;
const RAMPS = { off: { every: 0, factor: 1 }, slow: { every: 3, factor: 0.92 }, fast: { every: 3, factor: 0.8 } } as const;
type RampKey = keyof typeof RAMPS;
const RAMP_KEYS: RampKey[] = ["off", "slow", "fast"];

const MAX_FRAME_MS = 100;
const MAX_LOG = 60;
const LEVEL_KEY = "laya-demo:snake-speed";
const RAMP_KEY = "laya-demo:snake-ramp";
const MODE_KEY = "laya-demo:snake-mode";
const GUARD_KEY = "laya-demo:snake-guard";
const MODES: Mode[] = ["strategy", "moves"];
type GuardKey = "on" | "off";
const GUARDS: GuardKey[] = ["on", "off"];

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
    return Number.isInteger(value) && value >= 1 && value <= SPEED_STEPS.length ? value : DEFAULT_LEVEL;
  } catch {
    return DEFAULT_LEVEL;
  }
}

function buildSettings(level: number, ramp: RampKey, mode: Mode, guard: GuardKey): Settings {
  return { ...DEFAULT_SETTINGS, mode, guard: guard === "on", stepMs: SPEED_STEPS[level - 1], rampEvery: RAMPS[ramp].every, rampFactor: RAMPS[ramp].factor };
}

/** What the backend needs to know about each option; the engine has already checked they are legal. */
function payloadFor(request: ModelRequest) {
  return request.candidates.map((option) => (isStrategy(option)
    ? { strategy: option.strategy, steps: option.steps, safe: option.safe, openPercent: option.openPercent }
    : { eats: option.eats, foodDelta: option.foodDelta, openPercent: option.openPercent, exits: option.exits, boxedIn: option.boxedIn }));
}

type Decision = Choice & { engine: Engine; turn: number };

type TurnRow = {
  kind: "turn"; id: string; turn: number; move: Move | null; strategy: Strategy | null;
  phase: "asking" | "answered" | "late" | "played";
  /** moves mode: time to answer. strategy mode: see `landed`. */
  answerMs: number | null; ate: boolean; asked: boolean;
  /** strategy mode: a new order arrived during this move. */
  landed: { strategy: Strategy; answerMs: number; lagSteps: number } | null;
  fallback: boolean;
};

type LogRow =
  | { kind: "game"; id: string; engine: Engine }
  | TurnRow
  | { kind: "end"; id: string; score: number; steps: number; cause: string | null };

/** Turns the session's events into log rows; one row per turn, updated as the turn progresses. */
function applyEvent(rows: LogRow[], event: SessionEvent, generation: number, mode: Mode): LogRow[] {
  const id = `${generation}:${event.type === "move" ? event.report.turn : "turn" in event ? event.turn : "end"}`;
  const update = (patch: Partial<TurnRow>) => rows.map((row) => (row.kind === "turn" && row.id === id ? { ...row, ...patch } : row));
  switch (event.type) {
    case "turn":
      return [{
        kind: "turn" as const, id, turn: event.turn, move: null, strategy: null, phase: "asking" as const,
        answerMs: null, ate: false, asked: false, landed: null, fallback: false,
      }, ...rows].slice(0, MAX_LOG);
    case "answer": {
      const picked = event.choice.candidates[event.choice.chosen];
      if (mode === "strategy" && isStrategy(picked)) {
        return update({ landed: { strategy: picked.strategy, answerMs: event.answerMs, lagSteps: event.lagSteps }, asked: event.choice.scores !== null });
      }
      return update({ move: picked.move, phase: "answered", answerMs: event.answerMs, asked: event.choice.scores !== null });
    }
    case "move":
      return update({
        move: event.report.move, strategy: event.report.strategy, fallback: event.report.fallback,
        phase: mode === "strategy" ? "played" : event.report.outcome === "answered" ? "played" : "late",
        answerMs: event.report.answerMs, ate: event.report.ate, asked: event.report.asked,
      });
    case "over":
      return [{ kind: "end" as const, id: `${generation}:end`, score: event.score, steps: event.steps, cause: event.cause }, ...rows].slice(0, MAX_LOG);
  }
}

function boardCells(session: Session): string[] {
  const { width, height, snake, food } = session.game;
  const cells = Array<string>(width * height).fill("");
  if (food) cells[food.y * width + food.x] = "is-food";
  snake.forEach((cell, index) => { cells[cell.y * width + cell.x] = index === 0 ? "is-head" : "is-body"; });
  return cells;
}

type Run = { engine: Engine; key: string };

export function SnakeDemo() {
  const { t } = useI18n();
  const { backend, engine } = useEngine();
  const [level, setLevel] = useState(readLevel);
  const [ramp, setRamp] = useState<RampKey>(() => readStored(RAMP_KEY, RAMP_KEYS, "slow"));
  const [mode, setMode] = useState<Mode>(() => readStored(MODE_KEY, MODES, "strategy"));
  const [guard, setGuard] = useState<GuardKey>(() => readStored(GUARD_KEY, GUARDS, "on"));
  const [session, setSession] = useState<Session>(() => createSession(buildSettings(level, ramp, mode, guard), newGame(DEFAULT_WIDTH, DEFAULT_HEIGHT)));
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary>(() => summarize([]));
  const [log, setLog] = useState<LogRow[]>(() => [{ kind: "game", id: "0:game", engine }]);
  const [error, setError] = useState<{ reason: unknown; engine: Engine } | null>(null);
  /** How long the last question took end to end, including the network. */
  const [roundTripMs, setRoundTripMs] = useState<number | null>(null);

  const runKey = `${engine}|${level}|${ramp}|${mode}|${guard}`;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const sessionRef = useRef(session);
  const engineRef = useRef(engine);
  const readyRef = useRef(false);
  const inFlightRef = useRef(false);
  const generationRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const runRef = useRef<Run>({ engine, key: runKey });
  sessionRef.current = session;
  engineRef.current = engine;
  readyRef.current = backend.state === "ready";

  const modelName = ENGINE_NAMES[engine];
  const modelId = backend.state === "ready" ? backend.health.engines[engine].model : "";

  const startGame = useCallback(() => {
    generationRef.current++;
    requestRef.current?.abort();
    requestRef.current = null;
    inFlightRef.current = false;
    setError(null);
    setDecision(null);
    setSummary(summarize([]));
    const fresh = createSession(buildSettings(level, ramp, mode, guard), newGame(DEFAULT_WIDTH, DEFAULT_HEIGHT));
    runRef.current = { engine: engineRef.current, key: runKey };
    setLog((previous) => [{ kind: "game" as const, id: `${generationRef.current}:game`, engine: engineRef.current }, ...previous].slice(0, MAX_LOG));
    sessionRef.current = fresh;
    setSession(fresh);
  }, [level, ramp, mode, guard, runKey]);

  /** Asks the model about the current move. One request at a time; the clock keeps running meanwhile. */
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
    const started = performance.now();
    try {
      const data = await postJson<ChoiceResponse>(current.settings.mode === "strategy" ? "/snake/strategy" : "/snake/choose", {
        candidates: payloadFor(request),
        engine: requestEngine,
      }, controller.signal);
      if (generation !== generationRef.current) return;
      setRoundTripMs(Math.round(performance.now() - started));
      if (
        !Number.isInteger(data.selected_index)
        || data.selected_index < 0
        || data.selected_index >= request.candidates.length
        || !Array.isArray(data.scores)
        || data.scores.length !== request.candidates.length
        || !data.scores.every(Number.isFinite)
      ) throw new InvalidMove();
      setQuestion(data.question);
      receive(current, request.turn, {
        candidates: request.candidates, chosen: data.selected_index, scores: data.scores,
        descriptions: data.descriptions, modelMs: data.elapsed_ms,
      });
    } catch (reason) {
      if (generation === generationRef.current && !isAbort(reason)) {
        // Pause instead of playing on without the model; resuming asks again.
        forgetRequest(current);
        if (current.game.status === "playing") pauseSession(current);
        setError({ reason, engine: requestEngine });
      }
    } finally {
      if (generation === generationRef.current) {
        requestRef.current = null;
        inFlightRef.current = false;
      }
    }
  }, []);

  // The game loop: advance the clock by real time, ask the model when a new move needs it,
  // and turn session events into log rows. Redraw only when something visible changed.
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
        const generation = generationRef.current;
        setLog((previous) => events.reduce((rows, event) => applyEvent(rows, event, generation, current.settings.mode), previous));
        for (const event of events) {
          if (event.type === "answer") setDecision({ ...event.choice, engine: runRef.current.engine, turn: event.turn });
          if (event.type === "move") setSummary(summarize(current.reports));
        }
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
  }, [ask]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LEVEL_KEY, String(level));
      window.localStorage.setItem(RAMP_KEY, ramp);
      window.localStorage.setItem(MODE_KEY, mode);
      window.localStorage.setItem(GUARD_KEY, guard);
    } catch {
      // The settings still work if storage is unavailable.
    }
  }, [level, ramp, mode, guard]);

  // One game is played by one model with one set of settings, so changing any of them starts a new game.
  useEffect(() => {
    if (runRef.current.key === runKey) return;
    startGame();
  }, [runKey, startGame]);

  useEffect(() => () => {
    generationRef.current++;
    requestRef.current?.abort();
  }, []);

  const togglePaused = () => {
    if (session.game.status === "paused") setError(null);
    pauseSession(session);
    redraw();
  };

  const { game } = session;
  const strategyMode = session.settings.mode === "strategy";
  const asking = session.requested && (strategyMode || !session.choice);
  const status = game.status === "over" ? t.snake.gameOver
    : strategyMode ? (asking ? t.snake.thinkingWhile(modelName, t.snake.strategies[session.strategy]) : t.snake.following(t.snake.strategies[session.strategy]))
    : session.choice ? t.snake.answered
    : asking ? t.snake.thinking(modelName)
    : t.snake.watching;
  const tooSlow = !strategyMode && roundTripMs !== null && roundTripMs > session.stepMs;
  const cells = boardCells(session);
  const errorMessage = error
    ? `${error.reason instanceof InvalidMove
      ? t.snake.invalidMove(ENGINE_NAMES[error.engine])
      : errorText(error.reason, t, t.snake.noResponse(ENGINE_NAMES[error.engine]))} ${t.snake.pausedAfterError}`
    : null;
  const rampInfo = RAMPS[ramp];
  const answeredCount = summary.answered;

  return (
    <main className="tetris-page">
      <div className="page-heading">
        <h1>{t.snake.heading}</h1>
        <p className="muted">{t.snake.intro}</p>
      </div>

      <div className="tetris-layout">
        <section className="panel tetris-log" aria-label={t.snake.logTitle}>
          <h2>{t.snake.logTitle}</h2>
          <div className="log-body">
            <ol className="log-list snake-log" aria-live="polite">
              {log.length === 0 && <li className="muted">{t.snake.logEmpty}</li>}
              {log.map((row) => (
                <li key={row.id} className={row.kind === "turn" && row.phase === "late" ? "is-late" : undefined}>
                  {row.kind === "game" && <strong>{t.snake.logNewGame(ENGINE_NAMES[row.engine])}</strong>}
                  {row.kind === "end" && <strong>{t.snake.logEnd(row.cause ? t.snake.causes[row.cause as keyof typeof t.snake.causes] : "", row.score, row.steps)}</strong>}
                  {row.kind === "turn" && (
                    <>
                      <span className="num">#{row.turn}</span>{" "}
                      <strong>{row.move ? t.snake.moves[row.move] : "…"}</strong>{" "}
                      {strategyMode ? (
                        <span className="muted">
                          {row.strategy ? `${t.snake.strategies[row.strategy]}` : ""}
                          {row.landed ? ` · ${t.snake.logLanded(t.snake.strategies[row.landed.strategy], Math.round(row.landed.answerMs), row.landed.lagSteps)}` : ""}
                          {row.fallback ? ` · ${t.snake.logFallback}` : ""}
                          {row.ate ? ` · ${t.snake.logAte}` : ""}
                        </span>
                      ) : (
                        <span className="muted">
                          {row.phase === "asking" ? t.snake.logAsking(modelName)
                            : row.phase === "late" ? t.snake.logLate
                            : !row.asked ? t.snake.logOnly
                            : row.answerMs !== null ? t.snake.logAnswer(Math.round(row.answerMs)) : ""}
                          {row.ate ? ` · ${t.snake.logAte}` : ""}
                        </span>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <div className="tetris-play">
          <div className="tetris-board-frame">
            <div className="snake-board" role="img" aria-label={t.snake.board(game.score)} style={{ gridTemplateColumns: `repeat(${game.width}, 1fr)` }}>
              {cells.map((cell, index) => <span className={`snake-cell ${cell}`} key={index} />)}
            </div>
            {game.status !== "playing" && (
              <div className="tetris-overlay">
                <strong>{game.status === "over" ? t.snake.gameOver : t.snake.paused}</strong>
                {game.status === "over" && (
                  <button className="button button-primary" type="button" onClick={startGame}>{t.snake.playAgain}</button>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="tetris-side">
          <dl className="stats">
            <div><dt>{t.snake.food}</dt><dd className="num">{game.score}</dd></div>
            <div><dt>{t.snake.length}</dt><dd className="num">{game.snake.length}</dd></div>
            <div><dt>{t.snake.moveCount}</dt><dd className="num">{game.steps}</dd></div>
            <div><dt>{t.snake.speed}</dt><dd className="num">{session.stepMs} <small>ms</small></dd></div>
          </dl>

          <section className="panel">
            <h2>{modelName} <span className="model-id num">{modelId}</span></h2>
            <p className={`status${session.choice ? "" : asking ? "" : " is-lost"}`} aria-live="polite">{status}</p>
            <p className="small muted">
              {summary.turns === 0 ? t.snake.hudEmpty
                : strategyMode ? t.snake.hudStrategy(
                  summary.avgAnswerMs === null ? null : Math.round(summary.avgAnswerMs),
                  summary.avgLagSteps === null ? null : Math.round(summary.avgLagSteps * 10) / 10,
                  summary.fallbacks,
                )
                : t.snake.hudTally(answeredCount, summary.turns, summary.avgAnswerMs === null ? null : Math.round(summary.avgAnswerMs), summary.minSlackMs === null ? null : Math.round(summary.minSlackMs))}
            </p>
            {tooSlow && <p className="small warning" role="status">{t.snake.slowWarning(roundTripMs!, Math.round(session.stepMs))}</p>}

            <div className="decision">
              <span className="label">
                {t.snake.decisionTitle}
                {decision && ` · ${ENGINE_NAMES[decision.engine]} · #${decision.turn}`}
              </span>
              <ol className="candidates">
                {(decision?.candidates ?? []).map((candidate, slot) => {
                  const score = decision?.scores?.[slot];
                  const chosen = slot === decision?.chosen;
                  return (
                    <li key={slot} className={chosen ? "is-chosen" : undefined}>
                      <span className="candidate-head">
                        <span>
                          {isStrategy(candidate)
                            ? `${t.snake.strategies[candidate.strategy]}${candidate.steps > 0 ? ` · ${t.snake.steps(candidate.steps)}` : ""}${candidate.safe ? "" : ` · ${t.snake.unsafe}`}`
                            : t.snake.moves[candidate.move]}
                        </span>
                        <span className="num">
                          {score !== undefined ? `${percent(score)}%` : ""}
                          {chosen ? ` · ${t.snake.chosen}` : ""}
                        </span>
                      </span>
                      <span className="score-bar" aria-hidden="true">
                        <span style={{ width: `${(score ?? (chosen ? 1 : 0)) * 100}%` }} />
                      </span>
                      <span className="candidate-text">{decision?.descriptions?.[slot] ?? ""}</span>
                    </li>
                  );
                })}
              </ol>
              <small className="muted">
                {!decision ? t.snake.noDecision
                  : decision.scores && decision.modelMs !== null ? t.snake.response(Math.round(decision.modelMs))
                  : t.snake.onlyMove}
              </small>
            </div>

            <details className="question">
              <summary>{t.snake.question}</summary>
              <p className="small muted">{question ?? "…"}</p>
            </details>
            {errorMessage && <p className="error" role="alert">{errorMessage}</p>}
          </section>

          <section className="panel">
            <h2>{t.snake.gameTitle}</h2>
            <label className="slider">
              <span>{t.snake.speedLabel} <span className="num">{level}/{SPEED_STEPS.length}</span></span>
              <input type="range" min="1" max={SPEED_STEPS.length} step="1" value={level} onChange={(event) => setLevel(Number(event.target.value))} />
              <small className="muted">{t.snake.speedNote(SPEED_STEPS[level - 1])}</small>
            </label>
            <div className="setting">
              <span>{t.snake.modeTitle}</span>
              <div className="lang-switch" role="group" aria-label={t.snake.modeTitle}>
                {MODES.map((option) => (
                  <button type="button" key={option} aria-pressed={mode === option} onClick={() => setMode(option)}>
                    {t.snake.modeOptions[option]}
                  </button>
                ))}
              </div>
              <small className="muted">{t.snake.modeNote[mode]}</small>
            </div>
            <div className="setting">
              <span>{t.snake.guardTitle}</span>
              <div className="lang-switch" role="group" aria-label={t.snake.guardTitle}>
                {GUARDS.map((option) => (
                  <button type="button" key={option} aria-pressed={guard === option} onClick={() => setGuard(option)}>
                    {t.snake.guardOptions[option]}
                  </button>
                ))}
              </div>
              <small className="muted">{t.snake.guardNote}</small>
            </div>
            <div className="setting">
              <span>{t.snake.ramp}</span>
              <div className="lang-switch" role="group" aria-label={t.snake.ramp}>
                {RAMP_KEYS.map((option) => (
                  <button type="button" key={option} aria-pressed={ramp === option} onClick={() => setRamp(option)}>
                    {t.snake.rampOptions[option]}
                  </button>
                ))}
              </div>
              <small className="muted">{t.snake.rampNote(rampInfo.every, Math.round((1 - rampInfo.factor) * 100))}</small>
            </div>
            <div className="button-row">
              <button className="button" type="button" onClick={togglePaused} disabled={game.status === "over"}>
                {game.status === "paused" ? t.snake.resume : t.snake.pause}
              </button>
              <button className="button" type="button" onClick={startGame}>{t.snake.newGame}</button>
            </div>
          </section>
        </aside>
      </div>

      <p className="muted small tetris-note">{t.snake.disclaimer}</p>
    </main>
  );
}
