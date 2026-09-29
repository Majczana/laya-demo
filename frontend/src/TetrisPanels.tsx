import { useEffect, useRef } from "react";
import { ENGINES, ENGINE_NAMES, type Engine } from "./engine";
import { useI18n, type Messages } from "./i18n";
import { byScore, type LogEntry, type MoveEntry } from "./tetrisLog";
import { cellsFor, type PieceType } from "./tetrisEngine";
import type { Session, Summary } from "./tetrisSession";

export type GameRecord = {
  id: number;
  engine: Engine;
  candidates: string;
  gravityMs: number;
  endedAt: number;
  score: number;
  lines: number;
  pieces: number;
  onTarget: number;
  avgAnswerMs: number | null;
  avgScore: number | null;
  result: "over" | "stopped";
};

const LOG_CHIPS = 6;
const percent = (value: number) => Math.round(value * 100);

export function clock(time: number, t: Messages): string {
  return new Date(time).toLocaleTimeString(t.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function MiniPiece({ type }: { type: PieceType | null }) {
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

function stepsText({ rotations, shift, drop }: NonNullable<MoveEntry["steps"]>, t: Messages): string {
  return [
    rotations ? t.tetris.logRotate(rotations) : null,
    shift > 0 ? t.tetris.logRight(shift) : shift < 0 ? t.tetris.logLeft(-shift) : null,
    t.tetris.logDrop(drop),
  ].filter(Boolean).join(", ");
}

export function LogItem({ entry }: { entry: LogEntry }) {
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

  const { choice, steps, report } = entry;
  const placement = choice?.candidates[choice.chosen];
  const scores = choice?.scores ?? null;
  const best = scores ? scores[choice!.chosen] : null;
  const tie = scores !== null && scores.filter((score) => score === best).length > 1;
  const outcome = report?.outcome;
  return (
    <li className={`log-move is-${entry.phase}${outcome ? ` outcome-${outcome}` : ""}`}>
      <div className="log-head">
        <span className={`log-piece piece-${entry.piece}`} aria-hidden="true">{entry.piece}</span>
        <strong className="num">#{entry.serial}</strong>
        <span className="log-model">{ENGINE_NAMES[entry.engine]}</span>
        {choice?.modelMs != null && <span className="log-ms num">{Math.round(choice.modelMs)} ms</span>}
        {time}
      </div>

      {entry.phase === "asking" && <p className="log-note">{t.tetris.logAsking(ENGINE_NAMES[entry.engine])}</p>}
      {entry.phase === "error" && <p className="log-note error">{t.tetris.noResponse(ENGINE_NAMES[entry.engine])}</p>}

      {placement && (
        <p className="log-choice">
          {t.tetris.logChoice(placement.x + 1, placement.rotation * 90)}
          {best !== null && <strong className="num"> · {percent(best)}%</strong>}
          {scores && entry.answerMs !== undefined && <span className="muted"> · {t.tetris.logAnswer(Math.round(entry.answerMs))}</span>}
        </p>
      )}
      {choice && !scores && <p className="log-note">{t.tetris.logOnly}</p>}

      {scores && (
        <ol className="log-scores" aria-label={t.tetris.logCandidates}>
          {byScore(choice!).slice(0, LOG_CHIPS).map((index) => (
            <li key={index} className={`num${index === choice!.chosen ? " is-chosen" : ""}`}>{percent(scores[index])}</li>
          ))}
          {scores.length > LOG_CHIPS && <li className="num is-more">+{scores.length - LOG_CHIPS}</li>}
        </ol>
      )}
      {tie && <p className="log-note">{t.tetris.logTie}</p>}

      {steps && (
        <p className="log-steps">
          {stepsText(steps, t)}
          {report && <span className={report.cleared > 0 ? "log-lines" : undefined}> · {t.tetris.logCleared(report.cleared)}</span>}
        </p>
      )}
      {outcome && (
        <p className={`log-outcome is-${outcome}`}>
          {outcome === "on-target" ? t.tetris.logOnTarget : outcome === "off-target" ? (entry.abandoned ? t.tetris.logAbandoned : t.tetris.logOffTarget) : t.tetris.logUnanswered}
        </p>
      )}
    </li>
  );
}

/** Shrinking bar: how long the piece has left before it would lock without help. Updated straight in the DOM every frame. */
export function TimingHud({ session, summary, late }: { session: Session; summary: Summary; late: number }) {
  const { t } = useI18n();
  const barRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const gravityRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let frame = 0;
    const paint = () => {
      const bar = barRef.current;
      if (bar && textRef.current && fieldRef.current && gravityRef.current) {
        const elapsed = session.clock - session.spawnedAt;
        const left = Math.max(0, session.budgetMs - elapsed);
        const answered = session.answeredAt !== null;
        bar.style.width = `${Math.min(100, (left / Math.max(1, session.budgetMs)) * 100)}%`;
        fieldRef.current.dataset.state = answered ? "answered" : left <= 0 ? "late" : left < session.budgetMs * 0.3 ? "low" : "waiting";
        textRef.current.textContent = answered
          ? t.tetris.hudAnswered(Math.round(session.answeredAt! - session.spawnedAt))
          : left <= 0 ? t.tetris.hudNever : `${Math.round(left)} ms · ${t.tetris.hudWaiting}`;
        gravityRef.current.textContent = t.tetris.hudGravityValue(session.gravityMs);
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [session, t]);

  return (
    <div className="timing">
      <div className="timing-row">
        <span className="label">{t.tetris.hudGravity}</span>
        <strong className="num" ref={gravityRef} />
      </div>
      <div className="timing-field" ref={fieldRef} data-state="waiting">
        <span className="label">{t.tetris.hudBudget}</span>
        <span className="timing-track" aria-hidden="true"><span ref={barRef} /></span>
        <span className="timing-text num" ref={textRef} />
        <small className="muted">{t.tetris.hudBudgetNote}</small>
      </div>
      {summary.pieces > 0 && (
        <p className="small timing-tally">
          {t.tetris.hudTally(summary.onTarget, summary.pieces)}
          {late > 0 && <span className="muted"> · {late}×</span>}
        </p>
      )}
    </div>
  );
}

export function RecentGames({ games }: { games: GameRecord[] }) {
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
                <th scope="col">{t.tetris.gamesSpeed}</th>
                <th scope="col">{t.tetris.gamesScore}</th>
                <th scope="col">{t.tetris.gamesLines}</th>
                <th scope="col">{t.tetris.gamesPieces}</th>
                <th scope="col">{t.tetris.gamesOnTarget}</th>
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
                  <td className="num">{game.candidates === "all" ? t.tetris.candidatesAll : game.candidates}</td>
                  <td className="num">{game.gravityMs} ms</td>
                  <td className="num">{game.score.toLocaleString(t.locale)}</td>
                  <td className="num">{game.lines}</td>
                  <td className="num">{game.pieces}</td>
                  <td className="num">{game.pieces ? `${percent(game.onTarget / game.pieces)}%` : "–"}</td>
                  <td className="num">{game.avgAnswerMs === null ? "–" : `${Math.round(game.avgAnswerMs)} ms`}</td>
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
