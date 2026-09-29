import { useEffect, useRef, useState } from "react";
import { EmojiDemo } from "./EmojiDemo";
import { TetrisDemo } from "./TetrisDemo";
import { SnakeDemo } from "./SnakeDemo";
import { InjectionDemo } from "./InjectionDemo";
import { TicketDemo } from "./TicketDemo";
import { RepairScoreDemo } from "./RepairScoreDemo";
import { NoteGateDemo } from "./NoteGateDemo";
import { ActionGateDemo } from "./ActionGateDemo";
import { DocumentSorterDemo } from "./DocumentSorterDemo";
import { GroundingDemo } from "./GroundingDemo";
import { PartsDemo } from "./PartsDemo";
import { DispatchDemo } from "./DispatchDemo";
import { EngineSwitch, ENGINES, useEngine } from "./engine";
import { LanguageSwitch, useI18n } from "./i18n";

type Game = "emoji" | "tetris" | "snake" | "injection" | "tickets" | "repairs" | "notes" | "actions" | "documents" | "grounding" | "parts" | "queue";

const GAMES: Game[] = ["emoji", "tetris", "snake", "injection", "tickets", "repairs", "notes", "actions", "documents", "grounding", "parts", "queue"];
const MODEL_NAMES = "convaiinnovations/laya-multilingual, typesafe/jev-1.13";

type GroupId = "games" | "classify" | "score";

/** Menu categories; the numbers shown next to a demo follow GAMES, not this order. */
const GROUPS: { id: GroupId; games: Game[] }[] = [
  { id: "games", games: ["emoji", "tetris", "snake"] },
  { id: "classify", games: ["injection", "tickets", "queue", "documents", "parts"] },
  { id: "score", games: ["repairs", "notes", "actions", "grounding"] },
];

/** Category buttons that open a list of demos, so every demo stays reachable however many there are. */
function NavMenu({ active }: { active: Game | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<GroupId | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <nav className="nav-menu" aria-label={t.nav.main} ref={ref}>
      {GROUPS.map((group) => {
        const isOpen = open === group.id;
        return (
          <div className={`nav-group${isOpen ? " open" : ""}`} key={group.id}>
            <button type="button" className={`nav-trigger${active && group.games.includes(active) ? " active" : ""}`} aria-expanded={isOpen} aria-haspopup="true" onClick={() => setOpen(isOpen ? null : group.id)}>
              {t.nav.groups[group.id]}<span className="nav-count">{group.games.length}</span><i aria-hidden="true">▾</i>
            </button>
            {isOpen && (
              <div className="nav-panel">
                {group.games.map((game) => (
                  <a key={game} href={`#${game}`} aria-current={active === game ? "page" : undefined} onClick={() => setOpen(null)}>
                    <span className="nav-num">{String(GAMES.indexOf(game) + 1).padStart(2, "0")}</span>
                    <span className="nav-text"><strong>{t.games[game].title}</strong><small>{t.games[game].meta}</small></span>
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {active && <span className="nav-current"><small>{t.nav.current}</small>{t.games[active].title}</span>}
    </nav>
  );
}

function gameFromHash(): Game | null {
  const name = window.location.hash.slice(1);
  return GAMES.includes(name as Game) ? (name as Game) : null;
}

/** The L-shaped tetromino from the favicon. */
function LogoMark() {
  return (
    <svg className="logo-mark" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

function EmojiPreview() {
  return (
    <span className="preview preview-emoji" aria-hidden="true">
      <span className="is-up">🌧️</span>
      <span>🍕</span>
      <span className="is-up">☂️</span>
      <span>⚽</span>
    </span>
  );
}

// 4×4 cells, top to bottom; letters are piece colours.
const TETRIS_PREVIEW = "..T..TTT.I..JIOO";

function TetrisPreview() {
  return (
    <span className="preview preview-tetris" aria-hidden="true">
      {[...TETRIS_PREVIEW].map((cell, index) => (
        <span key={index} className={cell === "." ? "" : `piece-${cell}`} />
      ))}
    </span>
  );
}

// 4×4 cells, top to bottom: h head, b body, f food.
const SNAKE_PREVIEW = "....bbbb.f.h.b..";

function SnakePreview() {
  return (
    <span className="preview preview-snake" aria-hidden="true">
      {[...SNAKE_PREVIEW].map((cell, index) => (
        <span key={index} className={cell === "h" ? "is-head" : cell === "b" ? "is-body" : cell === "f" ? "is-food" : ""} />
      ))}
    </span>
  );
}

function InjectionPreview() {
  return <span className="preview preview-injection" aria-hidden="true"><span>?</span><span>✓</span></span>;
}

function TicketPreview() {
  return <span className="preview preview-injection preview-ticket" aria-hidden="true"><span>P1</span><span>→</span></span>;
}

function RepairPreview() {
  return <span className="preview preview-injection preview-repair" aria-hidden="true"><span>0</span><span>→</span><span>2</span></span>;
}

function NotePreview() {
  return <span className="preview preview-injection preview-note" aria-hidden="true"><span>✎</span><span>✓</span></span>;
}

function ActionPreview() {
  return <span className="preview preview-injection preview-note" aria-hidden="true"><span>!</span><span>✓</span></span>;
}

function DocumentPreview() {
  return <span className="preview preview-injection preview-note" aria-hidden="true"><span>▤</span><span>→</span></span>;
}

function GroundingPreview() {
  return <span className="preview preview-injection preview-note" aria-hidden="true"><span>✓</span><span>?</span><span>✕</span></span>;
}

function PartsPreview() {
  return <span className="preview preview-injection preview-note" aria-hidden="true"><span>⚙</span><span>◎</span></span>;
}

function QueuePreview() {
  return <span className="preview preview-injection preview-ticket" aria-hidden="true"><span>P1</span><span>▸</span><span>P3</span></span>;
}

function BackendStatus() {
  const { t } = useI18n();
  const { backend } = useEngine();

  return (
    <p className={`backend-status is-${backend.state}`} aria-live="polite">
      <span className="dot" />
      {backend.state === "ready"
        ? t.home.ready(backend.health.device, backend.health.engines.jev.available)
        : t.home[backend.state]}
    </p>
  );
}

export default function App() {
  const { t } = useI18n();
  const { backend } = useEngine();
  const [activeGame, setActiveGame] = useState<Game | null>(gameFromHash);
  const modelNames = backend.state === "ready"
    ? ENGINES.map((engine) => backend.health.engines[engine].model).join(", ")
    : MODEL_NAMES;

  useEffect(() => {
    const sync = () => setActiveGame(gameFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeGame]);

  return (
    <div className={`app ${activeGame ? `app-${activeGame}` : "app-home"}`}>
      <header className="site-header">
        <a className="site-name" href="#">
          <LogoMark />
          {t.nav.home}
        </a>
        <NavMenu active={activeGame} />
        <EngineSwitch />
        <LanguageSwitch />
      </header>

      {activeGame === "emoji" && <EmojiDemo />}
      {activeGame === "tetris" && <TetrisDemo />}
      {activeGame === "snake" && <SnakeDemo />}
      {activeGame === "injection" && <InjectionDemo />}
      {activeGame === "tickets" && <TicketDemo />}
      {activeGame === "repairs" && <RepairScoreDemo />}
      {activeGame === "notes" && <NoteGateDemo />}
      {activeGame === "actions" && <ActionGateDemo />}
      {activeGame === "documents" && <DocumentSorterDemo />}
      {activeGame === "grounding" && <GroundingDemo />}
      {activeGame === "parts" && <PartsDemo />}
      {activeGame === "queue" && <DispatchDemo />}
      {activeGame === null && (
        <main className="home">
          <section className="home-intro">
            <p className="eyebrow">{t.home.eyebrow}</p>
            <h1>{t.home.title}</h1>
            <p className="lead">{t.home.lead}</p>
            <BackendStatus />
          </section>

          <ol className="demo-list">
            {GAMES.map((game, index) => (
              <li key={game}>
                <a href={`#${game}`}>
                  {game === "emoji" ? <EmojiPreview /> : game === "tetris" ? <TetrisPreview /> : game === "snake" ? <SnakePreview /> : game === "injection" ? <InjectionPreview /> : game === "tickets" ? <TicketPreview /> : game === "repairs" ? <RepairPreview /> : game === "notes" ? <NotePreview /> : game === "actions" ? <ActionPreview /> : game === "documents" ? <DocumentPreview /> : game === "grounding" ? <GroundingPreview /> : game === "parts" ? <PartsPreview /> : <QueuePreview />}
                  <span className="demo-text">
                    <span className="demo-title">
                      <span className="demo-number">{String(index + 1).padStart(2, "0")}</span>
                      {t.games[game].title}
                    </span>
                    <span className="demo-description">{t.games[game].description}</span>
                    <span className="demo-meta">{t.games[game].meta}</span>
                  </span>
                  <span className="demo-arrow" aria-hidden="true">→</span>
                </a>
              </li>
            ))}
          </ol>

          <p className="home-footer">{t.home.footer(modelNames)}</p>
        </main>
      )}
    </div>
  );
}
