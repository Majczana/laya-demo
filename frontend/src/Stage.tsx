import type { CSSProperties, ReactNode } from "react";

/** Shared building blocks for the demo result stages; each demo composes its own look from these. */

export type Tone = "good" | "warn" | "bad" | "neutral";

/** Placeholder that shows what will appear, and turns into a live "working" scene while a request runs. */
export function StageEmpty({ busy, idle, working, glyph }: { busy: boolean; idle: string; working: string; glyph: ReactNode }) {
  return <div className={`stage-empty ${busy ? "busy" : ""}`}>
    <div className="stage-glyph" aria-hidden="true"><i /><i /><i />{glyph}</div>
    <p>{busy ? working : idle}</p>
    {busy && <span className="stage-dots" aria-hidden="true"><b /><b /><b /></span>}
  </div>;
}

/** Semicircle gauge with a swinging needle and an optional threshold tick (0–1 values). */
export function Dial({ value, threshold, tone, caption, label }: { value: number; threshold?: number; tone: Tone; caption: string; label: string }) {
  const clamped = Math.min(1, Math.max(0, value));
  return <div className={`dial ${tone}`} role="img" aria-label={`${label}: ${Math.round(clamped * 100)}%`}>
    <svg viewBox="0 0 200 118" aria-hidden="true">
      <path className="dial-track" d="M 20 100 A 80 80 0 0 1 180 100" pathLength="100" />
      <path className="dial-fill" d="M 20 100 A 80 80 0 0 1 180 100" pathLength="100" style={{ strokeDasharray: `${clamped * 100} 100` }} />
      {threshold !== undefined && <g className="dial-tick" style={{ transform: `rotate(${threshold * 180 - 90}deg)` }}><line x1="100" y1="12" x2="100" y2="26" /></g>}
      <g className="dial-needle" style={{ "--a": `${clamped * 180 - 90}deg` } as CSSProperties}><line x1="100" y1="100" x2="100" y2="30" /><circle cx="100" cy="100" r="6" /></g>
    </svg>
    <b>{Math.round(clamped * 100)}%</b><small>{caption}</small>
  </div>;
}

/** Marker on a 0…max track; the marker slides in from the left. */
export function ScoreTrack({ score, max, tone }: { score: number; max: number; tone: Tone }) {
  const ratio = Math.min(1, Math.max(0, score / max));
  return <div className={`score-track ${tone}`} style={{ "--x": `${ratio * 100}%` } as CSSProperties}>
    <div className="score-rail"><span className="score-fill" /></div>
    {Array.from({ length: max + 1 }, (_, index) => <i key={index} className="score-notch" style={{ left: `${(index / max) * 100}%` }}><small>{index}</small></i>)}
    <em className="score-marker" />
  </div>;
}

/** Yes/no chip with a bar showing how strongly the check passed. */
export function CheckChip({ label, score, pass = 0.5, invert = false }: { label: string; score: number; pass?: number; invert?: boolean }) {
  const ok = invert ? score < pass : score >= pass;
  return <div className={`check-chip ${ok ? "ok" : "no"}`}>
    <span className="check-mark" aria-hidden="true">{ok ? "✓" : "✕"}</span>
    <span className="check-label">{label}</span>
    <strong>{Math.round(score * 100)}%</strong>
    <span className="check-bar"><i style={{ width: `${score * 100}%` }} /></span>
  </div>;
}

/** Padlock whose shackle closes, opens or hangs half-way. */
export function Lock({ state }: { state: "closed" | "open" | "half" }) {
  return <svg className={`lock ${state}`} viewBox="0 0 64 72" aria-hidden="true">
    <path className="lock-shackle" d="M 20 34 V 22 a 12 12 0 0 1 24 0 V 34" />
    <rect className="lock-body" x="10" y="32" width="44" height="34" rx="6" />
    <circle className="lock-hole" cx="32" cy="46" r="4" /><rect className="lock-hole" x="30" y="48" width="4" height="9" rx="2" />
  </svg>;
}
