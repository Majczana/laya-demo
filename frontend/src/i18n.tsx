import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "pl" | "en";

export const LANGS: Lang[] = ["pl", "en"];
const DEFAULT_LANG: Lang = "pl";
const LANG_KEY = "laya-demo:lang";

const en = {
  locale: "en-US",
  htmlTitle: "LAYA vs Jev demos",
  language: "Language",
  nav: {
    home: "LAYA vs Jev",
    main: "Demos",
  },
  engine: {
    label: "Model",
    jevMissing: "Jev: set OPENROUTER_API_KEY and restart the backend",
  },
  home: {
    eyebrow: "Decision models side by side",
    title: "LAYA vs Jev",
    lead: "Two small demos of decision models. LAYA runs on this computer; Jev from TypeSafe is called through OpenRouter. Both get exactly the same questions: switch the model in the header to compare their answers.",
    checking: "Checking the backend…",
    ready: (device: string, jev: boolean) => `Backend ready · LAYA on ${device} · ${jev ? "Jev available" : "Jev needs an API key"}`,
    offline: "Backend offline · start uvicorn",
    footer: (models: string) => `Models: ${models}. Scores are experimental and not calibrated; the two models' scales differ.`,
  },
  games: {
    emoji: {
      title: "Emoji Rain",
      description: "Type a phrase. The model answers 200 yes-or-no questions, one per emoji, and the matching emoji rise from the pile.",
      meta: "noul · 200 questions per request",
    },
    tetris: {
      title: "Tetris",
      description: "The game engine lists legal moves. The model rates each one and the best-rated move is played.",
      meta: "noul · up to 4 questions per piece",
    },
  },
  errors: {
    input: (detail: string) => `Check the input: ${detail}.`,
    model: "The model failed or returned an answer the demo could not read.",
    backend: "The backend is unavailable or still loading LAYA. Check the backend terminal.",
    unreachable: "Cannot reach the backend. Is uvicorn running?",
    status: (status: number) => `The backend returned an error (${status}).`,
  },
  emoji: {
    connecting: "Connecting to the backend…",
    waiting: "Waiting for the backend to load LAYA…",
    ready: (device: string) => `Ready · ${device}`,
    analyzing: "Scoring…",
    elapsed: (ms: number, model: string) => `${model} · ${ms} ms`,
    catalogFailed: "Could not load the emoji catalog.",
    predictionFailed: "Prediction failed. Check the backend.",
    predictionError: "Prediction error",
    unavailable: "No connection",
    heading: "Emoji Rain",
    intro: "Each emoji is scored on its own, so several can match at once. Switch the model in the header to compare.",
    inputLabel: "Phrase",
    placeholder: "e.g. healthy food",
    threshold: (model: string) => `Threshold · ${model}`,
    thresholdDefault: (model: string, percent: number) => `Each model keeps its own threshold; the default for ${model} is ${percent}%.`,
    manyMatches: (count: number, shown: number) => `${count} match, showing the top ${shown}`,
    matches: (count: number, total: number) => `${count} of ${total} match`,
    thresholdHint: (model: string, percent: number) => `Emoji above the threshold are lifted. Each model has its own threshold (${model} default: ${percent}%) because the two models score on different scales.`,
    tooShort: (count: number) => `Type at least ${count} characters.`,
    noClearMatch: (count: number, total: number) => `No clear match: the model marked ${count} of ${total} emoji as matching, so none are lifted.`,
  },
  tetris: {
    heading: "Tetris",
    intro: "A model test with no manual control. For every piece the selected model rates the candidate moves while the piece keeps falling, then the best-rated move is completed. The piece waits at the floor if the answer takes longer. Switching the model or the number of candidates starts a new game.",
    score: "Score",
    lines: "Lines",
    level: "Level",
    combo: "Combo",
    best: (value: number) => `best ${value}`,
    next: "Next",
    piece: (type: string) => `Piece ${type}`,
    empty: "Empty",
    board: (lines: number) => `Tetris board, ${lines} lines cleared`,
    gameOver: "Game over",
    paused: "Paused",
    playAgain: "Play again",
    thinking: (model: string) => `Asking ${model}…`,
    executing: "Moving the piece to the chosen spot",
    watching: "Waiting for the next piece",
    question: "Question sent for each candidate move",
    decisionTitle: "Current decision",
    decisionTop: (shown: number, total: number) => `best ${shown} of ${total}`,
    noDecision: "No decision yet.",
    onlyMove: "Only one legal move; the model was not asked.",
    candidate: (column: number, degrees: number) => `column ${column}, ${degrees}°`,
    chosen: "chosen",
    response: (ms: number) => `response ${ms} ms`,
    noResponse: (model: string) => `${model} did not respond.`,
    invalidMove: (model: string) => `${model} returned an invalid move.`,
    pausedAfterError: "The game is paused; resume to ask again.",
    logTitle: "Decision log",
    logEmpty: "Every model decision appears here.",
    logNewGame: (model: string) => `New game · ${model}`,
    logAsking: (model: string) => `asking ${model}…`,
    logChoice: (column: number, degrees: number) => `column ${column} · rotation ${degrees}°`,
    logOnly: "only legal move, the model was not asked",
    logCandidates: "Scores of all candidates",
    logTie: "tie: the engine's order decided",
    logRotate: (count: number) => `rotate ${count}×`,
    logLeft: (count: number) => `${count} left`,
    logRight: (count: number) => `${count} right`,
    logDrop: (count: number) => `drop ${count}`,
    logCleared: (lines: number) => lines === 0 ? "no lines" : lines === 1 ? "+1 line" : `+${lines} lines`,
    logEnd: (score: string, lines: number) => `Game over · score ${score} · ${lines} lines`,
    gameTitle: "Game",
    pace: "Speed",
    paceNote: (ms: number) => `${ms} ms per move step · the level does not change the speed`,
    candidatesLabel: "Candidates",
    candidatesAll: "all",
    candidatesNote: "How many moves the model chooses from. With 4 or 8 the game engine first keeps its own best moves; with all, only the model decides. Changing it starts a new game.",
    pause: "Pause",
    resume: "Resume",
    newGame: "New game",
    gamesTitle: "Recent games in this session",
    gamesEmpty: "Finished and stopped games appear here.",
    gamesSummary: (model: string, games: number, lines: string) => `${model}: ${games} ${games === 1 ? "game" : "games"}, avg ${lines} lines`,
    gamesEnded: "Ended",
    gamesModel: "Model",
    gamesScore: "Score",
    gamesLines: "Lines",
    gamesPieces: "Pieces",
    gamesTime: "Avg. response",
    gamesRating: "Avg. score",
    gamesResult: "Result",
    resultOver: "game over",
    resultStopped: "stopped",
    disclaimer: "The score is the model's answer to the question about each move, not a guarantee of a good move. With 4 or 8 candidates the game engine's heuristic preselects the moves, which helps a weak model a lot; “all” is the pure model test.",
  },
};

export type Messages = typeof en;

const pl: Messages = {
  locale: "pl-PL",
  htmlTitle: "Dema LAYA vs Jev",
  language: "Język",
  nav: {
    home: "LAYA vs Jev",
    main: "Dema",
  },
  engine: {
    label: "Model",
    jevMissing: "Jev: ustaw OPENROUTER_API_KEY i uruchom ponownie backend",
  },
  home: {
    eyebrow: "Modele decyzyjne obok siebie",
    title: "LAYA vs Jev",
    lead: "Dwa małe dema modeli decyzyjnych. LAYA działa na tym komputerze, a Jev od TypeSafe jest wywoływany przez OpenRouter. Oba dostają dokładnie te same pytania: przełącz model w nagłówku, żeby porównać ich odpowiedzi.",
    checking: "Sprawdzam backend…",
    ready: (device, jev) => `Backend gotowy · LAYA na ${device} · ${jev ? "Jev dostępny" : "Jev wymaga klucza API"}`,
    offline: "Backend wyłączony · uruchom uvicorn",
    footer: (models) => `Modele: ${models}. Wyniki są eksperymentalne i nieskalibrowane; skale obu modeli się różnią.`,
  },
  games: {
    emoji: {
      title: "Deszcz emoji",
      description: "Wpisz frazę. Model odpowiada na 200 pytań tak/nie, po jednym na emoji, a pasujące emoji unoszą się ze stosu.",
      meta: "noul · 200 pytań na zapytanie",
    },
    tetris: {
      title: "Tetris",
      description: "Silnik gry wypisuje dozwolone ruchy. Model ocenia każdy z nich i wykonywany jest najlepiej oceniony.",
      meta: "noul · do 4 pytań na klocek",
    },
  },
  errors: {
    input: (detail) => `Sprawdź dane: ${detail}.`,
    model: "Model zwrócił błąd albo odpowiedź, której demo nie umie odczytać.",
    backend: "Backend jest niedostępny albo wciąż ładuje LAYA. Sprawdź terminal backendu.",
    unreachable: "Brak połączenia z backendem. Czy uvicorn jest uruchomiony?",
    status: (status) => `Backend zwrócił błąd (${status}).`,
  },
  emoji: {
    connecting: "Łączenie z backendem…",
    waiting: "Czekam, aż backend załaduje LAYA…",
    ready: (device) => `Gotowe · ${device}`,
    analyzing: "Liczę…",
    elapsed: (ms, model) => `${model} · ${ms} ms`,
    catalogFailed: "Nie udało się wczytać katalogu emoji.",
    predictionFailed: "Predykcja nie powiodła się. Sprawdź backend.",
    predictionError: "Błąd predykcji",
    unavailable: "Brak połączenia",
    heading: "Deszcz emoji",
    intro: "Każde emoji jest oceniane osobno, więc kilka może pasować naraz. Przełącz model w nagłówku, żeby porównać.",
    inputLabel: "Fraza",
    placeholder: "np. zdrowe jedzenie",
    threshold: (model) => `Próg · ${model}`,
    thresholdDefault: (model, percent) => `Każdy model ma własny próg; domyślny dla ${model} to ${percent}%.`,
    manyMatches: (count, shown) => `pasuje ${count}, pokazuję ${shown} najlepszych`,
    matches: (count, total) => `pasuje ${count} z ${total}`,
    thresholdHint: (model, percent) => `Emoji powyżej progu zostają uniesione. Każdy model ma własny próg (${model} domyślnie: ${percent}%), bo oba modele oceniają w innej skali.`,
    tooShort: (count) => `Wpisz co najmniej ${count} znaki.`,
    noClearMatch: (count, total) => `Brak wyraźnego dopasowania: model oznaczył ${count} z ${total} emoji jako pasujące, więc nic nie unoszę.`,
  },
  tetris: {
    heading: "Tetris",
    intro: "Test modeli bez ręcznego sterowania. Dla każdego klocka wybrany model ocenia możliwe ruchy, a klocek w tym czasie cały czas spada. Po odpowiedzi wykonywany jest najlepiej oceniony ruch; jeśli odpowiedź trwa dłużej, klocek czeka na dnie. Zmiana modelu albo liczby kandydatów zaczyna nową grę.",
    score: "Wynik",
    lines: "Linie",
    level: "Poziom",
    combo: "Combo",
    best: (value) => `najlepsze ${value}`,
    next: "Następny",
    piece: (type) => `Klocek ${type}`,
    empty: "Pusto",
    board: (lines) => `Plansza Tetrisa, wyczyszczone linie: ${lines}`,
    gameOver: "Koniec gry",
    paused: "Pauza",
    playAgain: "Zagraj ponownie",
    thinking: (model) => `Pytam ${model}…`,
    executing: "Przesuwam klocek na wybrane miejsce",
    watching: "Czekam na następny klocek",
    question: "Pytanie wysyłane dla każdego ruchu",
    decisionTitle: "Bieżąca decyzja",
    decisionTop: (shown, total) => `najlepsze ${shown} z ${total}`,
    noDecision: "Jeszcze nie ma decyzji.",
    onlyMove: "Tylko jeden możliwy ruch; model nie był pytany.",
    candidate: (column, degrees) => `kolumna ${column}, ${degrees}°`,
    chosen: "wybrany",
    response: (ms) => `odpowiedź ${ms} ms`,
    noResponse: (model) => `${model} nie odpowiada.`,
    invalidMove: (model) => `${model} zwraca nieprawidłowy ruch.`,
    pausedAfterError: "Gra jest wstrzymana; wznów, żeby zapytać ponownie.",
    logTitle: "Log decyzji",
    logEmpty: "Tu pojawia się każda decyzja modelu.",
    logNewGame: (model) => `Nowa gra · ${model}`,
    logAsking: (model) => `pytam ${model}…`,
    logChoice: (column, degrees) => `kolumna ${column} · obrót ${degrees}°`,
    logOnly: "jedyny możliwy ruch, model nie był pytany",
    logCandidates: "Oceny wszystkich kandydatów",
    logTie: "remis: zdecydowała kolejność silnika",
    logRotate: (count) => `obrót ${count}×`,
    logLeft: (count) => `${count} w lewo`,
    logRight: (count) => `${count} w prawo`,
    logDrop: (count) => `spadek o ${count}`,
    logCleared: (lines) => lines === 0 ? "bez linii" : lines === 1 ? "+1 linia" : `+${lines} linie`,
    logEnd: (score, lines) => `Koniec gry · wynik ${score} · linie ${lines}`,
    gameTitle: "Gra",
    pace: "Tempo",
    paceNote: (ms) => `${ms} ms na krok ruchu · poziom nie zmienia tempa`,
    candidatesLabel: "Kandydaci",
    candidatesAll: "wszystkie",
    candidatesNote: "Z ilu ruchów wybiera model. Przy 4 lub 8 silnik gry najpierw zostawia swoje najlepsze ruchy; przy „wszystkie” decyduje tylko model. Zmiana zaczyna nową grę.",
    pause: "Pauza",
    resume: "Wznów",
    newGame: "Nowa gra",
    gamesTitle: "Ostatnie gry w tej sesji",
    gamesEmpty: "Tu pojawiają się zakończone i przerwane gry.",
    gamesSummary: (model, games, lines) => `${model}: gier ${games}, śr. ${lines} linii`,
    gamesEnded: "Koniec",
    gamesModel: "Model",
    gamesScore: "Wynik",
    gamesLines: "Linie",
    gamesPieces: "Klocki",
    gamesTime: "Śr. odpowiedź",
    gamesRating: "Śr. ocena",
    gamesResult: "Stan",
    resultOver: "koniec gry",
    resultStopped: "przerwana",
    disclaimer: "Ocena to odpowiedź modelu na pytanie o każdy ruch, a nie gwarancja dobrego ruchu. Przy 4 lub 8 kandydatach heurystyka silnika wstępnie wybiera ruchy, co bardzo pomaga słabszemu modelowi; „wszystkie” to czysty test modelu.",
  },
};

const MESSAGES: Record<Lang, Messages> = { pl, en };

function readStoredLang(): Lang {
  try {
    const stored = window.localStorage.getItem(LANG_KEY);
    return stored === "pl" || stored === "en" ? stored : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

type LanguageContextValue = { lang: Lang; setLang: (lang: Lang) => void; t: Messages };

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(readStoredLang);
  const t = MESSAGES[lang];

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t.htmlTitle;
    try {
      window.localStorage.setItem(LANG_KEY, lang);
    } catch {
      // The switch still works for this visit if storage is unavailable.
    }
  }, [lang, t]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useI18n must be used inside LanguageProvider");
  return value;
}

export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label={t.language}>
      {LANGS.map((option) => (
        <button
          type="button"
          key={option}
          aria-pressed={lang === option}
          onClick={() => setLang(option)}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
