import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, isAbort, postJson } from "./api";
import { ENGINES, ENGINE_NAMES, useEngine, type Engine } from "./engine";
import { useI18n, type Messages } from "./i18n";
import {
  BOARD_HEIGHT,
  applyPlacement,
  boardFeatures,
  candidatePlacements,
  cellsFor,
  fallWhileThinking,
  fits,
  ghostY,
  move,
  newGame,
  rotate,
  shortlistPlacements,
  stepDown,
  togglePause,
  type GameState,
  type PieceType,
  type Placement,
} from "./tetrisEngine";

type ChoiceResponse = {
  elapsed_ms: number;
  selected_index: number;
  scores: number[];
  question: string;
  descriptions: string[];
};

/** Everything the model was shown and answered for one piece. */
type Decision = {
  engine: Engine;
  serial: number;
  candidates: Placement[];
  chosen: number;
  /** null when there was only one legal move and the model was not asked. */
  scores: number[] | null;
  descriptions: string[] | null;
  elapsedMs: number | null;
};

type MoveEntry = {
  kind: "move";
  id: string;
  time: number;
  serial: number;
  piece: PieceType;
  engine: Engine;
  phase: "asking" | "moving" | "placed" | "error";
  decision?: Decision;
  steps?: { rotations: number; shift: number; drop: number };
  cleared?: number;
};

type LogEntry =
  | MoveEntry
  | { kind: "game"; id: string; time: number; engine: Engine }
  | { kind: "end"; id: string; time: number; score: number; lines: number };

/** How many of the engine's ranked moves the model chooses from. */
type CandidateLimit = "4" | "8" | "all";
const CANDIDATE_LIMITS: CandidateLimit[] = ["4", "8", "all"];

type GameRecord = {
  id: number;
  engine: Engine;
  candidates?: CandidateLimit;
  endedAt: number;
  score: number;
  lines: number;
  pieces: number;
  avgMs: number | null;
  avgScore: number | null;
  result: "over" | "stopped";
};

/** Totals for the game in progress; each game has one model and one candidate limit. */
type Run = {
  engine: Engine;
  limit: CandidateLimit;
  rated: number;
  totalMs: number;
  totalScore: number;
  saved: boolean;
};

/** The backend answered, but with an index the game cannot use. */
class InvalidMove extends Error {}
type DisplayCell = PieceType | "ghost" | "target" | null;

const SLOTS = 4;
const MAX_LOG = 150;
const MAX_GAMES = 20;
const DEFAULT_SPEED = 5;
const SPEED_KEY = "laya-demo:tetris-speed";
const LIMIT_KEY = "laya-demo:tetris-candidates";
const LOG_CHIPS = 6;
const GAMES_KEY = "laya-demo:tetris-games";

/** Delay between animation steps (rotate, shift or fall one row); speed 1–10. */
function stepDelay(speed: number): number {
  return Math.round(300 * 0.68 ** (speed - 1));
}

function readStoredSpeed(): number {
  try {
    const value = Number(window.localStorage.getItem(SPEED_KEY));
    return Number.isInteger(value) && value >= 1 && value <= 10 ? value : DEFAULT_SPEED;
  } catch {
    return DEFAULT_SPEED;
  }
}

function readStoredLimit(): CandidateLimit {
  try {
    const value = window.localStorage.getItem(LIMIT_KEY);
    return CANDIDATE_LIMITS.includes(value as CandidateLimit) ? (value as CandidateLimit) : "4";
  } catch {
    return "4";
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

function newRun(engine: Engine, limit: CandidateLimit): Run {
  return { engine, limit, rated: 0, totalMs: 0, totalScore: 0, saved: false };
}

/** Candidate indexes ordered by the model's score, best first. */
function byScore(decision: Decision): number[] {
  const indexes = decision.candidates.map((_, index) => index);
  const { scores } = decision;
  return scores ? indexes.sort((a, b) => scores[b] - scores[a]) : indexes;
}

/** One animation step towards the chosen landing: rotate, then shift, then fall. */
function advance(game: GameState, serial: number, target: Placement): GameState {
  if (game.status !== "playing" || game.pieceSerial !== serial) return game;
  let next = game;
  if (game.active.rotation !== target.rotation) next = rotate(game);
  else if (game.active.x !== target.x) next = move(game, game.active.x < target.x ? 1 : -1);
  else if (fits(game.board, { ...game.active, y: game.active.y + 1 })) return stepDown(game);
  // Landed on the target, or the path is blocked: place the piece exactly where
  // the model chose instead of letting it land somewhere else.
  if (next !== game) return next;
  const placed = applyPlacement(game, target);
  return placed !== game ? placed : stepDown(game);
}

function MiniPiece({ type }: { type: PieceType | null }) {
  const { t } = useI18n();
  const occupied = new Set(type ? cellsFor(type, 0).map(({ x, y }) => `${x},${y}`) : []);
  return (
    <div className="tetris-mini" aria-label={type ? t.tetris.piece(type) : t.tetris.empty}>
      {Array.from({ length: 16 }, (_, index) => {
        const x = index % 4;
        const y = Math.floor(index / 4);
        return <span className={occupied.has(`${x},${y}`) ? `tetris-cell piece-${type}` : "tetris-cell"} key={index} />;
      })}
    </div>
  );
}

function displayCells(game: GameState, target: Placement | null): DisplayCell[] {
  const grid: DisplayCell[][] = game.board.map((row) => [...row]);
  const outline = target
    ? { rotation: target.rotation, x: target.x, y: target.y, kind: "target" as const }
    : { ...game.active, y: ghostY(game.board, game.active), kind: "ghost" as const };
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

function clock(time: number, t: Messages): string {
  return new Date(time).toLocaleTimeString(t.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const percent = (value: number) => Math.round(value * 100);

function stepsText({ rotations, shift, drop }: NonNullable<MoveEntry["steps"]>, t: Messages): string {
  return [
    rotations ? t.tetris.logRotate(rotations) : null,
    shift > 0 ? t.tetris.logRight(shift) : shift < 0 ? t.tetris.logLeft(-shift) : null,
    t.tetris.logDrop(drop),
  ].filter(Boolean).join(", ");
}

function LogItem({ entry }: { entry: LogEntry }) {
  const { t } = useI18n();
  const time = <time className="log-time num">{clock(entry.time, t)}</time>;
  if (entry.kind === "game") {
    return <li className="log-banner">{t.tetris.logNewGame(ENGINE_NAMES[entry.engine])}{time}</li>;
  }
  if (entry.kind === "end") {
    return (
      <li className="log-banner is-end">
        {t.tetris.logEnd(entry.score.toLocaleString(t.locale), entry.lines)}{time}
      </li>
    );
  }

  const { decision, steps } = entry;
  const placement = decision?.candidates[decision.chosen];
  const scores = decision?.scores ?? null;
  const best = scores ? scores[decision!.chosen] : null;
  const tie = scores !== null && scores.filter((score) => score === best).length > 1;
  return (
    <li className={`log-move is-${entry.phase}`}>
      <div className="log-head">
        <span className={`log-piece piece-${entry.piece}`} aria-hidden="true">{entry.piece}</span>
        <strong className="num">#{entry.serial}</strong>
        <span className="log-model">{ENGINE_NAMES[entry.engine]}</span>
        {decision?.elapsedMs != null && <span className="log-ms num">{Math.round(decision.elapsedMs)} ms</span>}
        {time}
      </div>

      {entry.phase === "asking" && <p className="log-note">{t.tetris.logAsking(ENGINE_NAMES[entry.engine])}</p>}
      {entry.phase === "error" && <p className="log-note error">{t.tetris.noResponse(ENGINE_NAMES[entry.engine])}</p>}

      {placement && (
        <p className="log-choice">
          {t.tetris.logChoice(placement.x + 1, placement.rotation * 90)}
          {best !== null && <strong className="num"> · {percent(best)}%</strong>}
        </p>
      )}
      {decision && !scores && <p className="log-note">{t.tetris.logOnly}</p>}

      {scores && (
        <ol className="log-scores" aria-label={t.tetris.logCandidates}>
          {byScore(decision!).slice(0, LOG_CHIPS).map((index) => (
            <li key={index} className={`num${index === decision!.chosen ? " is-chosen" : ""}`}>{percent(scores[index])}</li>
          ))}
          {scores.length > LOG_CHIPS && <li className="num is-more">+{scores.length - LOG_CHIPS}</li>}
        </ol>
      )}
      {tie && <p className="log-note">{t.tetris.logTie}</p>}

      {steps && (
        <p className="log-steps">
          {stepsText(steps, t)}
          {entry.phase === "placed" && entry.cleared !== undefined && (
            <span className={entry.cleared > 0 ? "log-lines" : undefined}> · {t.tetris.logCleared(entry.cleared)}</span>
          )}
        </p>
      )}
    </li>
  );
}

function RecentGames({ games }: { games: GameRecord[] }) {
  const { t } = useI18n();
  const played = ENGINES
    .map((engine) => ({ engine, records: games.filter((game) => game.engine === engine) }))
    .filter(({ records }) => records.length > 0);

  return (
    <section className="panel tetris-games">
      <h2>{t.tetris.gamesTitle}</h2>
      {games.length === 0 ? (
        <p className="muted small">{t.tetris.gamesEmpty}</p>
      ) : (
        <>
          <p className="small">
            {played.map(({ engine, records }) => t.tetris.gamesSummary(
              ENGINE_NAMES[engine],
              records.length,
              (records.reduce((sum, game) => sum + game.lines, 0) / records.length)
                .toLocaleString(t.locale, { maximumFractionDigits: 1 }),
            )).join(" · ")}
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t.tetris.gamesEnded}</th>
                <th scope="col">{t.tetris.gamesModel}</th>
                <th scope="col">{t.tetris.candidatesLabel}</th>
                <th scope="col">{t.tetris.gamesScore}</th>
                <th scope="col">{t.tetris.gamesLines}</th>
                <th scope="col">{t.tetris.gamesPieces}</th>
                <th scope="col">{t.tetris.gamesTime}</th>
                <th scope="col">{t.tetris.gamesRating}</th>
                <th scope="col">{t.tetris.gamesResult}</th>
              </tr>
            </thead>
            <tbody>
              {games.map((game) => (
                <tr key={game.id}>
                  <td className="num">{clock(game.endedAt, t)}</td>
                  <th scope="row">{ENGINE_NAMES[game.engine]}</th>
                  <td className="num">{game.candidates === "all" ? t.tetris.candidatesAll : (game.candidates ?? "4")}</td>
                  <td className="num">{game.score.toLocaleString(t.locale)}</td>
                  <td className="num">{game.lines}</td>
                  <td className="num">{game.pieces}</td>
                  <td className="num">{game.avgMs === null ? "–" : `${Math.round(game.avgMs)} ms`}</td>
                  <td className="num">{game.avgScore === null ? "–" : `${percent(game.avgScore)}%`}</td>
                  <td>{game.result === "over" ? t.tetris.resultOver : t.tetris.resultStopped}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export function TetrisDemo() {
  const { t } = useI18n();
  const { backend, engine } = useEngine();
  const [game, setGame] = useState(newGame);
  const [speed, setSpeed] = useState(readStoredSpeed);
  const [limit, setLimit] = useState(readStoredLimit);
  const [thinking, setThinking] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>(() => [{ kind: "game", id: "0:game", time: Date.now(), engine }]);
  const [games, setGames] = useState(readGames);
  const [error, setError] = useState<{ reason: unknown; engine: Engine } | null>(null);
  const gameRef = useRef(game);
  const decisionRef = useRef(decision);
  const engineRef = useRef(engine);
  const limitRef = useRef(limit);
  const thinkingRef = useRef(false);
  const generationRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const runRef = useRef(newRun(engine, limit));
  const lockRef = useRef({ serial: game.pieceSerial, lines: game.lines });
  gameRef.current = game;
  decisionRef.current = decision;
  engineRef.current = engine;
  limitRef.current = limit;

  const stepMs = stepDelay(speed);
  const modelName = ENGINE_NAMES[engine];
  const modelId = backend.state === "ready" ? backend.health.engines[engine].model : "";

  const addLog = useCallback((entry: LogEntry) => {
    setLog((previous) => [entry, ...previous].slice(0, MAX_LOG));
  }, []);

  const updateMove = useCallback((id: string, update: (entry: MoveEntry) => MoveEntry) => {
    setLog((previous) => previous.map((entry) => (entry.kind === "move" && entry.id === id ? update(entry) : entry)));
  }, []);

  /** Saves the current game once, when it ends, is restarted or the model changes. */
  const recordGame = useCallback((result: GameRecord["result"]) => {
    const run = runRef.current;
    const current = gameRef.current;
    if (run.saved || current.pieceSerial <= 1) return;
    run.saved = true;
    const record: GameRecord = {
      id: Date.now(),
      engine: run.engine,
      candidates: run.limit,
      endedAt: Date.now(),
      score: current.score,
      lines: current.lines,
      pieces: current.pieceSerial - 1,
      avgMs: run.rated ? run.totalMs / run.rated : null,
      avgScore: run.rated ? run.totalScore / run.rated : null,
      result,
    };
    setGames((previous) => [record, ...previous].slice(0, MAX_GAMES));
  }, []);

  const startGame = useCallback(() => {
    generationRef.current++;
    requestRef.current?.abort();
    requestRef.current = null;
    thinkingRef.current = false;
    setThinking(false);
    setDecision(null);
    setError(null);
    const fresh = newGame();
    lockRef.current = { serial: fresh.pieceSerial, lines: fresh.lines };
    runRef.current = newRun(engineRef.current, limitRef.current);
    addLog({ kind: "game", id: `${generationRef.current}:game`, time: Date.now(), engine: engineRef.current });
    setGame(fresh);
  }, [addLog]);

  const askModel = useCallback(async () => {
    const current = gameRef.current;
    if (current.status !== "playing" || thinkingRef.current || decisionRef.current?.serial === current.pieceSerial) return;

    const requestEngine = engineRef.current;
    const generation = generationRef.current;
    const id = `${generation}:${current.pieceSerial}`;
    const all = candidatePlacements(current.board, current.active, current.queue[0]);
    const candidates = shortlistPlacements(all, limitRef.current === "all" ? all.length : Number(limitRef.current));
    if (candidates.length === 0) {
      setGame((previous) => previous.pieceSerial === current.pieceSerial ? { ...previous, status: "over" } : previous);
      return;
    }

    // A retry after an error reuses the entry of the same piece.
    const entry: MoveEntry = {
      kind: "move", id, time: Date.now(), serial: current.pieceSerial,
      piece: current.active.type, engine: requestEngine, phase: "asking",
    };
    setLog((previous) => previous.some((item) => item.id === id)
      ? previous.map((item) => (item.id === id ? entry : item))
      : [entry, ...previous].slice(0, MAX_LOG));

    const accept = (choice: Decision) => {
      const latest = gameRef.current;
      if (generation !== generationRef.current || latest.pieceSerial !== current.pieceSerial || latest.status === "over") return;
      const placement = choice.candidates[choice.chosen];
      decisionRef.current = choice;
      setDecision(choice);
      updateMove(id, (item) => ({
        ...item,
        phase: "moving",
        decision: choice,
        steps: {
          rotations: (placement.rotation - latest.active.rotation + 4) % 4,
          shift: placement.x - latest.active.x,
          drop: placement.y - latest.active.y,
        },
      }));
      if (choice.scores && choice.elapsedMs !== null) {
        const run = runRef.current;
        run.rated++;
        run.totalMs += choice.elapsedMs;
        run.totalScore += choice.scores[choice.chosen];
      }
    };

    const base = { engine: requestEngine, serial: current.pieceSerial, candidates };
    if (candidates.length === 1) {
      accept({ ...base, chosen: 0, scores: null, descriptions: null, elapsedMs: null });
      return;
    }

    thinkingRef.current = true;
    setThinking(true);
    setError(null);
    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const data = await postJson<ChoiceResponse>("/tetris/choose", {
        candidates: candidates.map(({ linesCleared, holes, maxHeight, bumpiness, nextLinePotential }) => (
          { linesCleared, holes, maxHeight, bumpiness, nextLinePotential }
        )),
        // Moves are described by what they change compared with this board.
        board: (({ holes, maxHeight, bumpiness }) => ({ holes, maxHeight, bumpiness }))(boardFeatures(current.board)),
        engine: requestEngine,
      }, controller.signal);
      if (generation !== generationRef.current) return;
      if (
        !Number.isInteger(data.selected_index)
        || data.selected_index < 0
        || data.selected_index >= candidates.length
        || !Array.isArray(data.scores)
        || data.scores.length !== candidates.length
        || !data.scores.every(Number.isFinite)
      ) throw new InvalidMove();
      setQuestion(data.question);
      accept({
        ...base,
        chosen: data.selected_index,
        scores: data.scores,
        descriptions: data.descriptions,
        elapsedMs: data.elapsed_ms,
      });
    } catch (reason) {
      if (generation === generationRef.current && !isAbort(reason)) {
        // Pause instead of playing on without the model; resuming asks again.
        setError({ reason, engine: requestEngine });
        updateMove(id, (item) => ({ ...item, phase: "error" }));
        setGame((previous) => (previous.status === "playing" ? togglePause(previous) : previous));
      }
    } finally {
      if (generation === generationRef.current) {
        requestRef.current = null;
        thinkingRef.current = false;
        setThinking(false);
      }
    }
  }, [updateMove]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SPEED_KEY, String(speed));
    } catch {
      // The slider still works if storage is unavailable.
    }
  }, [speed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LIMIT_KEY, limit);
    } catch {
      // The setting still works if storage is unavailable.
    }
  }, [limit]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(GAMES_KEY, JSON.stringify(games));
    } catch {
      // The list still works for this page view if storage is unavailable.
    }
  }, [games]);

  // One game is played by one model with one candidate limit, so changing
  // either starts a new game.
  useEffect(() => {
    if (runRef.current.engine === engine && runRef.current.limit === limit) return;
    recordGame("stopped");
    startGame();
  }, [engine, limit, recordGame, startGame]);

  // Ask for a decision as soon as a new piece appears; gravity keeps running
  // while the model thinks, but the piece waits at the floor instead of
  // locking before the model can choose a placement.
  useEffect(() => {
    if (thinking || game.status !== "playing" || decision?.serial === game.pieceSerial) return;
    const timer = window.setTimeout(askModel, 0);
    return () => window.clearTimeout(timer);
  }, [thinking, game.status, game.pieceSerial, decision, askModel]);

  useEffect(() => {
    if (!thinking || game.status !== "playing") return;
    const serial = game.pieceSerial;
    const interval = window.setInterval(() => {
      setGame((previous) => (
        previous.pieceSerial === serial ? fallWhileThinking(previous) : previous
      ));
    }, stepMs);
    return () => window.clearInterval(interval);
  }, [thinking, game.status, game.pieceSerial, stepMs]);

  const executing = decision !== null && decision.serial === game.pieceSerial && game.status === "playing";

  useEffect(() => {
    if (!executing || !decision) return;
    const target = decision.candidates[decision.chosen];
    const interval = window.setInterval(() => setGame((previous) => advance(previous, decision.serial, target)), stepMs);
    return () => window.clearInterval(interval);
  }, [executing, decision, stepMs]);

  // Mark the previous piece as placed and note how many lines it cleared.
  useEffect(() => {
    const previous = lockRef.current;
    if (game.pieceSerial !== previous.serial) {
      updateMove(`${generationRef.current}:${previous.serial}`, (item) => ({
        ...item, phase: "placed", cleared: game.lines - previous.lines,
      }));
    }
    lockRef.current = { serial: game.pieceSerial, lines: game.lines };
  }, [game.pieceSerial, game.lines, updateMove]);

  useEffect(() => {
    if (game.status !== "over" || runRef.current.saved) return;
    // A piece that locked above the board ends the game without a new serial.
    updateMove(`${generationRef.current}:${game.pieceSerial}`, (item) => (
      item.phase === "moving" ? { ...item, phase: "placed", cleared: 0 } : item
    ));
    recordGame("over");
    addLog({ kind: "end", id: `${generationRef.current}:end`, time: Date.now(), score: game.score, lines: game.lines });
  }, [game.status, game.pieceSerial, game.score, game.lines, recordGame, addLog, updateMove]);

  useEffect(() => () => {
    generationRef.current++;
    requestRef.current?.abort();
  }, []);

  const restart = () => {
    recordGame("stopped");
    startGame();
  };

  const togglePaused = () => {
    if (game.status === "paused") setError(null);
    setGame((previous) => togglePause(previous));
  };

  const level = Math.floor(game.lines / 10) + 1;
  const target = executing && decision ? decision.candidates[decision.chosen] : null;
  const cells = displayCells(game, target);
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
            <div><dt>{t.tetris.level}</dt><dd className="num">{level}</dd></div>
            <div>
              <dt>{t.tetris.combo}</dt>
              <dd className="num">{game.combo > 1 ? `×${game.combo}` : "–"} <small>{t.tetris.best(game.bestCombo)}</small></dd>
            </div>
          </dl>

          <section className="panel">
            <h2>{modelName} <span className="model-id num">{modelId}</span></h2>
            <div className="model-now">
              <p className="status" aria-live="polite">
                {thinking ? t.tetris.thinking(modelName) : executing ? t.tetris.executing : t.tetris.watching}
              </p>
              <div className="next-piece">
                <span className="label">{t.tetris.next}</span>
                <MiniPiece type={game.queue[0] ?? null} />
              </div>
            </div>

            <div className="decision">
              <span className="label">
                {t.tetris.decisionTitle}
                {decision && ` · ${ENGINE_NAMES[decision.engine]} · #${decision.serial}`}
                {decision && decision.candidates.length > SLOTS && ` · ${t.tetris.decisionTop(SLOTS, decision.candidates.length)}`}
              </span>
              <ol className="candidates">
                {Array.from({ length: SLOTS }, (_, slot) => {
                  const index = decision ? byScore(decision)[slot] ?? -1 : -1;
                  const candidate = decision?.candidates[index];
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
                  : decision.scores && decision.elapsedMs !== null ? t.tetris.response(Math.round(decision.elapsedMs))
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
              <span>{t.tetris.pace} <span className="num">{speed}/10</span></span>
              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              />
              <small className="muted">{t.tetris.paceNote(stepMs)}</small>
            </label>
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
