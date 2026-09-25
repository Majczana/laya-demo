const emoji = [
  "🍕",
  "🥦",
  "🍎",
  "☕",
  "🧥",
  "🧣",
  "👟",
  "👗",
  "🌧️",
  "❄️",
  "☀️",
  "☂️",
  "⚽",
  "🎮",
  "📚",
  "🎸",
];

export default function App() {
  return (
    <main className="stage">
      <p className="eyebrow">Eksperyment 01 · środowisko</p>
      <h1>LAYA Emoji Demo</h1>
      <p className="intro">
        Scena jest gotowa. W następnym kroku porównamy decyzje
        <code>choice</code> i <code>noul</code>.
      </p>

      <div className="emoji-cloud" aria-label="Zestaw szesnastu testowych emoji">
        {emoji.map((symbol) => (
          <span className="emoji" key={symbol}>
            {symbol}
          </span>
        ))}
      </div>

      <label className="prompt">
        <span>Zdanie dla modelu</span>
        <input
          disabled
          placeholder="np. jedzenie zdrowe"
          title="Pole zostanie uruchomione po podłączeniu eksperymentu LAYA"
        />
      </label>
    </main>
  );
}

