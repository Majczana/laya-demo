import { useEffect, useState } from "react";
import { EmojiDemo } from "./EmojiDemo";
import { TetrisDemo } from "./TetrisDemo";
import { EngineSwitch, ENGINES, useEngine } from "./engine";
import { LanguageSwitch, useI18n } from "./i18n";

type Game = "emoji" | "tetris";

const GAMES: Game[] = ["emoji", "tetris"];
const MODEL_NAMES = "convaiinnovations/laya-multilingual, typesafe/jev-1.13";

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
        <nav aria-label={t.nav.main}>
          {GAMES.map((game) => (
            <a key={game} href={`#${game}`} aria-current={activeGame === game ? "page" : undefined}>
              {t.games[game].title}
            </a>
          ))}
        </nav>
        <EngineSwitch />
        <LanguageSwitch />
      </header>

      {activeGame === "emoji" && <EmojiDemo />}
      {activeGame === "tetris" && <TetrisDemo />}
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
                  {game === "emoji" ? <EmojiPreview /> : <TetrisPreview />}
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
