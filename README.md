# LAYA demos

Eleven decision demos using local
[LAYA](https://huggingface.co/convaiinnovations/laya) (`multilingual` checkpoint)
or optional Jev through OpenRouter:

| Demo | What LAYA does |
| --- | --- |
| Emoji Rain | Scores 200 independent `noul` associations while you type. |
| Tetris | Rates up to four legal piece placements with independent `noul` questions. |
| Prompt injection | Checks editable A–E attack/control pairs with one `noul` judgment. |
| PUDU ticket triage | Assigns a P1–P4 priority, identifies a robot from the supplied PUDU/CVTE inventory, and scores ten parts only when a component fault is indicated. |
| Repair scoring | Rates service complexity, repair risk, effort, unsafe practice and impact from 0–2; custom criteria can be added. |
| Note quality gate | Checks customer replies, service notes and sales notes before use. |
| Action justification gate | Jev checks a reason before a simulated removal, cancellation, project rejection or ticket closure; attempts are logged in the browser. |
| Document filing | A live sorting line: documents leave a stack, pass a scanner and land in the folder of a robot and category; a timer, accuracy against known answers, cost and throughput update as it runs. Jev classifies; uncertain cases wait in a review lane for a folder choice. Optional OpenAI Responses API support is available with a separate key. |
| Source check | Splits an assistant answer into sentences and checks each against a source text: supported, not in the source, or (Jev only) contradicted. |
| Fault schematic | Rates every part of a serving or cleaning robot against a fault description with one independent question per part, and lights the likely parts on a drawing of the robot. |
| Dispatch desk | Tickets arrive live; the model triages them one at a time (priority and team) while technicians work the lanes. A slow model lets the inbox grow, a wrong priority breaches the response time and a wrong team sends the ticket back. |

Open `http://localhost:5173`. The header groups the demos into three menus
(Games, Classify and route, Score and gates). Model results are experimental.

The new demos show the JSON sent to each model and its raw response. Ticket
triage uses staged calls: a no-fault ticket never sends part questions, and a
ticket unrelated to equipment reports no robot with 0% confidence. Explicit
model names are read directly from the text; unnamed robots are inferred from
the user's 24-entry PUDU/CVTE inventory and may be marked unclear. CVTE's
[C3 product page](https://www.cvte.com/en/product/cleaningrobot) describes its
floor washing and vacuuming functions. The action gate only simulates system
changes; its attempt log is stored in this browser's local storage. Jev's
reported per-call cost and token counts are shown when available. Volume tables
multiply the observed per-call cost by 1 through 1,000,000 identical requests;
LAYA has no API fee but local hardware and electricity are not measured. Jev's
listed rate is $0.042 per million input tokens and $0 per million output tokens
as checked on 2026-09-29; verify the [current model pricing](https://openrouter.ai/typesafe/jev-1.13/api)
before budgeting. The PUDU categories and parts are illustrative, not an
official service catalog. Priority and quality thresholds are demo rules and
need evaluation on labeled cases before operational use.

### Source check, fault schematic and dispatch desk

**Source check** (`POST /grounding/check`). The answer is split into sentences by
a small deterministic algorithm (not the model); each sentence becomes an
independent “does the source support it?” question, and Jev also gets “does the
source contradict it?”. On the demo examples Jev separated the three cases as
intended; LAYA's answers to the contradiction question were at chance level (8–14
of 24 for every phrasing tried), so LAYA is only asked about support and its
verdicts are “supported / unconfirmed”. LAYA also read only the start of a long
source (about 400 tokens). Keep sources short for LAYA.

**Fault schematic** (`POST /parts/locate`). One independent question per part,
using the ticket-triage part list restricted to what the robot family has (a
serving robot has trays, a cleaning robot a pump and filter). The question is
short and in English whatever the UI language: on eight example faults LAYA
picked the expected part first 5 times with it, against 1–3 with longer or Polish
wordings, and Jev picked it 8 of 8 times. The drawings follow the PUDU BellaBot
and CC1 simplified; brightness is relative to the strongest signal.

**Dispatch desk** (`POST /tickets/triage`, no new endpoint). The simulation in
`frontend/src/queueSim.ts` has no DOM or network. Its rules are tested without a
backend:

```powershell
node --test --experimental-strip-types frontend/scripts/queue-sim.test.mts
```

On 18 sample tickets with an expected priority and team, Jev got 18/18 priorities
and 18/18 teams at about 650 ms per ticket; LAYA got 9/18 and 6/18 at about 90 ms.
Handling times, response times and the technician team are a simulation.

Document filing accepts TXT, MD, CSV, DOCX and text-based PDF up to 10 MB.
The backend extracts up to 20,000 characters and sends that text to the chosen
model. Image-only scans need OCR first. The demo library is stored in this
browser's local storage and is not a shared document repository. Clear model
names can be filed automatically; when the model cannot be identified, the
person must choose a model or a shared folder. Jev scores are shown as model
outputs, not calibrated probabilities. Optional OpenAI classification uses
`gpt-4.1-mini` and a strict JSON response. To enable it, set `OPENAI_API_KEY`
in the root `.env` or backend environment and restart the backend. The OpenAI
option has not been live-tested without that key. OpenAI documents the
[Responses file inputs](https://developers.openai.com/api/docs/guides/file-inputs)
and [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

The whole app has a Polish/English switch in the header (Polish by default;
the choice is remembered in the browser). In Emoji Rain the language also
selects the backend catalog and prompt: `data/emojis_200_pl.json` with Polish
instructions and tak/nie labels, or `data/emojis_200.json` with English ones.
Both catalogs list the same emoji IDs in the same order. On the Polish test
phrases the Polish setup scores NDCG@5 0.7297 against 0.4316 for the English
catalog. The Tetris prompt stays in English in both modes: it is internal, and
the Polish version scored at chance level (23–31/60) in
`examples/evaluate_tetris_moves.py`.

## Run locally

**Quick start (Windows):** double-click `start.cmd` in the repository folder.
On the first run it creates `.venv` and installs the backend and frontend
dependencies. It then opens the backend (with `--reload`) and the frontend in
their own windows, skipping any that already run on ports 8000 or 5173, and
opens `http://localhost:5173`. Close both windows to stop the demo.

Manual start:

Open two terminals in the repository folder. On the first run, install the
dependencies.

**Terminal 1 — backend (Windows PowerShell)**

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r .\backend\requirements.lock
python -m pip install --no-deps -e .\backend
uvicorn app.main:app --reload --app-dir backend
```

**Terminal 2 — frontend**

```powershell
cd frontend
npm install
npm run dev
```

On later runs, skip environment creation and installation: activate `.venv` in
the first terminal and start `uvicorn`; in the second terminal run `npm run
dev` from the `frontend` folder.

On macOS/Linux, use `python3 -m venv .venv` and
`source .venv/bin/activate`; the remaining commands are the same.

The API starts immediately and the catalog is available while LAYA is cold.
The first prediction can take longer because it downloads and loads the LAYA
weights. API health: `http://localhost:8000/health`. LAYA runs locally and
needs no API key.

## Jev (comparison model)

The header has a LAYA / Jev switch. Each demo sends exactly the same
questions to the selected model, so you can flip back and forth and compare
the answers; the choice is remembered in the browser. Jev
([TypeSafe](https://docs.typesafe.ai/introduction)) is called through the
[OpenRouter Decisions API](https://openrouter.ai/docs/guides/community/jev)
and needs an OpenRouter key. Put it in `.env` in the repository root (the file
is git-ignored) and restart the backend:

```text
OPENROUTER_API_KEY=sk-or-v1-...
```

A real environment variable takes precedence over `.env`. Optional:
`JEV_MODEL` (default `typesafe/jev-1.13`) and `JEV_API_URL` (default
`https://openrouter.ai/api/alpha/decisions`). Without a key the Jev button is
disabled. Jev is billed per input token; one Emoji Rain request carries 200
questions, and the backend caches recent phrases per model so switching back
does not pay again.

In Emoji Rain both models get the same question. The yes/no answer
descriptions differ because the two APIs read them differently: LAYA gets the
short labels tak/nie (yes/no), Jev gets `criteria` that say when the answer is
true or false (NDCG@5 about 0.73 -> 0.78–0.80 for Jev; the same descriptions
lowered LAYA's). The two models score on different scales, so each has its own
lift threshold, remembered separately: **LAYA 85%, Jev 45%**. Two more rules
apply to both: nothing is sent before 3 characters, and if more than 20 emoji
pass the threshold the page shows “no clear match” instead of lifting them.

`examples/diagnose_emoji_typing.py` measured this on the 13 test phrases, every
prefix typed on the way to them, and 21 extra phrases with hand-picked expected
emoji (typos, missing diacritics, emotions, negation, indirect associations,
gibberish). On the 34 complete phrases:

| At the default thresholds | LAYA 85% | Jev 45% |
| --- | --- | --- |
| Emoji lifted per phrase | 1.8 | 3.2 |
| Lifted emoji that are right | 70% | 60% |
| Expected emoji found | 47% | 75% |
| Phrases with nothing lifted | 8 of 32 | 1 of 32 |
| Ranking (AUC, 13 test phrases) | 0.89 | 0.97 |

- **Thresholds:** LAYA's best F1 is at 85%; below that it quickly adds wrong
  emoji. Jev scores cautiously: with LAYA's old 75% it lifted about one emoji
  per phrase. Its best F1 is at 55%, but that left four phrases, “jedzenie”
  (food) among them, with nothing lifted, so the default is 45%.
- **Typing:** after one or two letters Jev in particular guesses from the
  letters (“ub” -> bread, burger), hence the 3-character minimum. Mid-word
  prefixes still lift wrong emoji now and then for both models (LAYA: “coś na
  desz” -> strawberry; Jev: “chcę tw” -> T-shirt, keyboard); quality rises
  steadily as the phrase is completed.
- **Gibberish:** In the earlier 100-item benchmark, LAYA scored almost every
  emoji near 100% for “asdfgh” or “xyz 123” (44–86 of 100 above the threshold,
  while real phrases reached at most 7), which the “no clear match” rule caught.
  Jev lifted nothing for them.
- **LAYA's typical mistakes:** confident unrelated emoji (“mecz”, match -> city
  0.91, metro 0.84, cheese 0.72; “wkurzyłem się”, I got angry -> surprise 0.95;
  “pies na spacerze”, dog on a walk -> mountains 0.89, no dog), broad phrases
  scored near zero (“ubrania”, clothes: gloves 0.01, hat 0.03) and missing
  diacritics (“ide na basen” -> guitar).
- **Jev's typical mistakes:** the house emoji for anything near home or travel
  (“lecę na wakacje”, flying on holiday -> house 0.95), typos (“jedznie” ->
  tiredness, keyboard; LAYA handles it) and weak indirect links (“zoo” -> lion
  0.15).

The expected emoji of the extra phrases were chosen by hand, and Jev's answers
vary slightly between runs, so small differences are noise.

## Architecture

```text
browser → React / Vite → FastAPI → LAYA multilingual (local)
                                  → Jev via OpenRouter (optional)
```

- `frontend/` — the start page and eight demos,
- `backend/` — the local API and LAYA question construction,
- `data/` — the 200-item emoji catalogs (Polish and English) and evaluation cases,
- `examples/` — experiments with `choice` and `noul` question types.

The API exposes `POST /predict` (`{"text", "lang", "engine"}`) for emoji,
`POST /tetris/choose` (`{"candidates", "engine"}`) for Tetris, and
`POST /injection/detect`, `/tickets/triage`, `/repairs/score`, `/notes/gate`,
`/actions/review`, `/documents/extract`, and `/documents/classify` for the new
decision demos. The document catalog and available engines are exposed through
`GET /documents/catalog` and `/documents/status`. The emoji catalog is available through
`GET /catalog?lang=pl|en`; `GET /health` reports the model and the device it
runs on. All demos use the same local LAYA checkpoint. LAYA scores 200 emoji in one
batch of independent questions; the demo slider sets the display threshold,
75% by default. `noul` scores are not a correctness guarantee.

### Tetris

The game starts immediately. The game engine enumerates legal placements and
ranks them with its own heuristic (lines, holes, stack height, bumpiness, nearly
complete rows and the next-piece clear potential). The model gets the top 4, the
top 8 or all of them (the “Candidates” setting, 4 by default) and rates each move
with its own `noul` question (“A Tetris player wants to clear lines and avoid
holes and a tall stack. Would this move help them? The move …”); the best-rated
move is played, and on a tie the engine's order decides. Moves are described in
words, relative to the board before the move: lines cleared, new holes, how much
the stack rises, whether the surface gets flatter or rougher, a warning near the
top and the next piece's clear potential. In earlier tests LAYA ignored raw
numbers and picked by option position.

`examples/compare_tetris_prompts.py` plays six seeded headless games (up to 250
pieces each; the same piece sequences for every variant) with a Python port of
the engine. Mean lines per game:

| Variant | LAYA | Jev |
| --- | --- | --- |
| Earlier absolute description (“leaves two covered holes, the stack gets tall”), 4 candidates | 20.5 (60% tied scores) | 69.3 (32% ties) |
| **Relative description (current), 4 candidates** | **40.2** (15% ties) | **97.2** (4% ties) |
| Relative description, 8 candidates | 9.5 | – |
| Relative description, all candidates | 3.3 | 94.5 |
| Stricter question (“Is this a good Tetris move? A good move …”), relative, 4 | 5.7 | 97.0 |
| References: engine's top move 96.7 · random of top 4: 3.7 · random of all: 0.0 | | |

Jev reached the 250-piece cap in every game with the relative description,
even when choosing among all moves without the engine's shortlist. LAYA gains
most from the relative description, loses most of its advantage once it has
more than four candidates, and did much worse with the stricter question, so
the question stays as it was. `examples/evaluate_tetris_moves.py` checks the
question on pairs where one move is strictly better, and
`frontend/scripts/benchmark-tetris.mts` plays the same comparison through the
backend.

Tetris is a live model test with no manual control, and the clock never waits
for the model. Each piece falls at the current gravity and locks where it rests
(after a 400 ms lock delay) whether or not the model has answered. When the
answer arrives, a bot presses a key (rotate, left or right) every 70 ms to steer
the piece to the chosen landing, then drops it. If the answer is late, the piece
is already too low or its path is blocked, the bot gives up after three blocked
presses and the piece lands wherever gravity puts it: nothing is placed for the
model. Gravity also speeds up as pieces are placed (the “Speeding up” setting:
off, 10% or 20% faster every 5 pieces, down to 25 ms per row), so a model that
cannot keep up ends up with pieces piled on top of each other and the game ends.
Requests are single-flight: an answer that arrives after its piece locked is
dropped and the model is asked about the current piece next. The model panel
shows the time left before the piece would lock unaided, and each log entry says
whether the piece landed on target, missed the spot or got no answer in time.
The “Falling speed” slider (1–10) sets the starting gravity, from 1200 ms to
50 ms per row. Pause and New game are the only controls; changing the model, the
speed, the speeding-up or the candidates starts a new game, so each game is played
by one model with one set of settings.

The rules live in `frontend/src/tetrisSession.ts` (no DOM, no network), shared by
the browser demo and the scripts below:

```powershell
# Rules of the session (no backend needed).
node --test --experimental-strip-types frontend/scripts/tetris-session.test.mts

# Plays real-time games against the running backend and reports how well each
# model keeps up as gravity speeds up. "instant" is a zero-latency reference bot.
node --experimental-strip-types frontend/scripts/tetris-live.mts --engine instant,laya,jev --gravity 600,300,150,80 --max 60 --games 2
```

The live script advances the game clock by the time each request really took.
Example (4 candidates, +18% speed every 5 pieces, first 50–80 pieces; “on target”
is the share of pieces that landed where the model chose; one seeded game per
row for Jev, two for the others, so treat the numbers as indicative):

| Start gravity (ms/row) | Instant reference | LAYA (≈45 ms answers) | Jev (≈270 ms answers) |
| --- | --- | --- | --- |
| 600 | 100% | 99% | 100% |
| 300 | 100% | 96% | 100% |
| 150 | 100% | 94% | 100% |
| 80 | 100% | 92% (both games topped out) | 82% (topped out) |

LAYA answers quickly but chooses worse moves, so it tops out earlier at high
speed; Jev picks better but its ≈270 ms network round trip costs it pieces once
gravity is fast. The reference bot, which is limited only by its key rate,
still lands 100% on target at 80 ms per row and starts missing at 40 ms.

The decision log on the left lists every move: time, piece, model, response
time, the chosen column and rotation with its score, the scores of all
candidates, the steps taken (↻ rotations, ← → columns, ↓ rows) and the lines
cleared. The model panel shows the current candidates with their scores, the
word description each one was sent with, and the question template; the chosen
landing is outlined on the board. The scores are not calibrated win
probabilities, and equal descriptions often get equal scores, in which case the
engine's shortlist order decides.

Finished, stopped and model-switched games are listed under “Recent games in
this session” (score, lines, pieces, mean response time and mean score, plus the
mean lines per model). The list is kept in `sessionStorage`, so it survives a
reload of the tab. The game includes scoring, levels, combos, back-to-back
Tetris bonuses, a next-piece preview and a seven-bag piece randomizer.

### Snake

A second live test of a decision model, with no manual control. The engine
(`frontend/src/snakeEngine.ts`, no DOM, no network) lists what the snake can do
and the model rates each option with one independent yes/no question, like
Tetris. The clock never waits for the model, and the snake speeds up as it eats.
Two ways to steer it (the “Control” setting):

- **Strategy (default):** the model picks a standing order (go for the food,
  follow the tail, take the most room) and the engine turns it into a move on the
  current position every step. One question is always open. An answer that
  arrives late is still applied, and the snake keeps following the old order
  until then, so a model slower than one step reacts late but does not crash the
  snake. If the order has nothing to do (no path to the food) or has become
  unsafe, the engine follows the tail instead and counts the override.
- **Moves:** the model picks each move (straight, left, right). If its answer is
  not in by the end of the step, the snake goes straight ahead, which is fatal at
  a wall, and the late answer is dropped. A model slower than one step never gets
  to steer: Jev takes about 300 ms per answer (≈450 ms through the backend), so
  from a 240 ms step (speed 6) every move is unanswered and the snake hits a wall.
  The page warns when the last question took longer than the step.

The “Safety filter” removes options that trap the snake (cut off from its own
tail, no room, no way out) whenever a safe one exists, and overrides an order
that has become unsafe. With it off, the model alone decides.

Wording matters. The first move description named the danger (“boxes the snake
into a space too small for it”) and both models rated it as good: LAYA picked the
safe option in 33% of scenarios, below chance. Stating the outcome (“…and the
snake survives / gets stuck and dies”) and saying that waiting strategies “get no
food” gives 100% safe picks for LAYA and Jev, and 100% food picks when everything
is safe (`examples/compare_snake_prompts.py`).

```powershell
# Rules of the engine, strategies and session (no backend needed).
node --test --experimental-strip-types frontend/scripts/snake-strategy.test.mts frontend/scripts/snake-session.test.mts

# Real-time games against the running backend. "instant" is a zero-latency
# reference and "random" the honest baseline: strategy mode leaves much of the
# work to the engine, so a model only counts if it beats random.
node --experimental-strip-types frontend/scripts/snake-live.mts --engine instant,random,laya,jev --mode both --step 600,240 --max 300 --games 3 --ramp 0

# Compare option wordings on scenarios with a known right answer.
python examples/compare_snake_prompts.py --engine laya
```

Example (16×16, constant speed, safety filter on, 3 seeded games × 300 moves;
food eaten, none of these games ended unless noted):

| Mode | Instant reference | Random | LAYA | Jev (240 ms step, 2 games × 150 moves) |
| --- | --- | --- | --- | --- |
| Strategy | 81 | 22 | 81 | 25, none ended, answers ≈270 ms |
| Moves | 78 (1 ended) | 0 | 78 (a cold start after a backend restart cost one game) | 0, both games ended at a wall |

The backend endpoints are `POST /snake/choose` (moves) and `POST /snake/strategy`.

## Tests

Fast checks that do not load the model:

```powershell
python -m unittest discover -s backend/tests -t backend
```

## Device

LAYA automatically selects the available device. Set `LAYA_DEVICE=cpu` or
`LAYA_DEVICE=cuda` before starting the backend. Optional PyTorch CUDA build for
Windows/NVIDIA:

```powershell
python -m pip install --force-reinstall --no-deps -r .\backend\requirements-cuda.lock
```

Experiment details and reproduction commands are in
[examples/README.md](examples/README.md).
