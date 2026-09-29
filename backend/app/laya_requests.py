"""Build typed LAYA requests from validated demo data."""

from typing import Literal, TypedDict

from app.data_models import EmojiCatalog


class ChoiceQuestion(TypedDict):
    """One LAYA choice question."""

    type: Literal["choice"]
    instructions: str
    criteria: dict[str, str]


class ChoiceRequest(TypedDict):
    """Complete request accepted by LAYA's prediction interface."""

    state: dict[str, str]
    questions: dict[str, ChoiceQuestion]


class NoulQuestion(TypedDict):
    """One independent LAYA yes-or-no question."""

    type: Literal["noul"]
    instructions: str
    labels: dict[Literal["false", "true"], str]


class NoulRequest(TypedDict):
    """A batch of independent emoji matching questions."""

    state: dict[str, str]
    questions: dict[str, NoulQuestion]


CriteriaMode = Literal["descriptions", "labels"]
OptionKeyMode = Literal["ids", "opaque"]

# Emoji prompts follow the catalog language. Polish instructions with tak/nie
# labels scored NDCG@5 0.7297 on the Polish test phrases against 0.6993 with
# the English wording on the same Polish catalog.
EMOJI_PROMPTS = {
    "pl": {
        "choice": (
            "Która opcja najlepiej pasuje do treści użytkownika? "
            "Oceń znaczenie całej treści i wybierz jedną opcję."
        ),
        "noul": "Czy treść użytkownika w polu `text` pasuje znaczeniowo do kategorii „{category}”?",
        "labels": {"false": "nie", "true": "tak"},
        "criteria": {
            "false": "treść użytkownika nie ma związku z tą kategorią",
            "true": "treść użytkownika pasuje znaczeniowo do tej kategorii",
        },
    },
    "en": {
        "choice": "Which option best matches the meaning of the user's text in the `text` field?",
        "noul": "Does the user's text in the `text` field match the meaning of the category '{category}'?",
        "labels": {"false": "no", "true": "yes"},
        "criteria": {
            "false": "the user's text is unrelated to this category",
            "true": "the user's text matches the meaning of this category",
        },
    },
}


def emoji_prompts(catalog: EmojiCatalog) -> dict:
    """Return the prompt set for the catalog's language (English as fallback)."""

    return EMOJI_PROMPTS.get(catalog.language.split("-")[0], EMOJI_PROMPTS["en"])


def build_option_key_map(
    catalog: EmojiCatalog,
    *,
    option_key_mode: OptionKeyMode = "ids",
) -> dict[str, str]:
    """Map model-facing option keys to stable emoji IDs."""

    if option_key_mode == "ids":
        return {item.id: item.id for item in catalog.items}
    if option_key_mode == "opaque":
        if len(catalog.items) > 26:
            raise ValueError("opaque A-Z keys support at most 26 options")
        return {
            chr(ord("A") + index): item.id
            for index, item in enumerate(catalog.items)
        }
    raise ValueError(f"unsupported option key mode: {option_key_mode}")


def build_choice_request(
    text: str,
    catalog: EmojiCatalog,
    *,
    criteria_mode: CriteriaMode = "descriptions",
    option_key_mode: OptionKeyMode = "ids",
) -> ChoiceRequest:
    """Create a choice request without loading or running the model."""

    normalized_text = text.strip()
    if not normalized_text:
        raise ValueError("text must not be empty")

    option_keys = build_option_key_map(
        catalog,
        option_key_mode=option_key_mode,
    )
    items_by_id = {item.id: item for item in catalog.items}

    if criteria_mode == "descriptions":
        criteria = {
            option_key: (
                f"{items_by_id[emoji_id].label}: "
                f"{items_by_id[emoji_id].description}"
            )
            for option_key, emoji_id in option_keys.items()
        }
    elif criteria_mode == "labels":
        criteria = {
            option_key: items_by_id[emoji_id].label
            for option_key, emoji_id in option_keys.items()
        }
    else:
        raise ValueError(f"unsupported criteria mode: {criteria_mode}")

    return {
        "state": {"text": normalized_text},
        "questions": {
            "emoji_match": {
                "type": "choice",
                "instructions": emoji_prompts(catalog)["choice"],
                "criteria": criteria,
            }
        },
    }


def build_noul_request(
    text: str,
    catalog: EmojiCatalog,
    *,
    criteria_mode: CriteriaMode = "descriptions",
    describe_answers: bool = False,
) -> NoulRequest:
    """Create one independent yes-or-no matching question per emoji.

    LAYA reads the answer descriptions as short labels (tak/nie). Jev reads
    them as criteria for when the answer is true or false; describing them
    raised its NDCG@5 on the Polish test phrases from about 0.73 to 0.78-0.80
    (Jev varies a little between runs), while the same descriptions lowered
    LAYA's from 0.730 to 0.688 (examples/compare_emoji_engines.py). The
    question itself is the same for both models.
    """

    normalized_text = text.strip()
    if not normalized_text:
        raise ValueError("text must not be empty")
    if criteria_mode not in ("descriptions", "labels"):
        raise ValueError(f"unsupported criteria mode: {criteria_mode}")

    def category(item) -> str:
        if criteria_mode == "labels":
            return item.label
        return f"{item.label}: {item.description}"

    prompts = emoji_prompts(catalog)
    return {
        "state": {"text": normalized_text},
        "questions": {
            item.id: {
                "type": "noul",
                "instructions": prompts["noul"].format(category=category(item)),
                "labels": dict(prompts["criteria" if describe_answers else "labels"]),
            }
            for item in catalog.items
        },
    }


class TetrisMoveFeatures(TypedDict):
    """Board features after one legal placement, computed by the game engine."""

    linesCleared: int
    holes: int
    maxHeight: int
    bumpiness: int
    nextLinePotential: int


class TetrisBoardFeatures(TypedDict):
    """The same features for the board before the move."""

    holes: int
    maxHeight: int
    bumpiness: int


_COUNT_WORDS = {0: "no", 1: "one", 2: "two", 3: "three", 4: "four"}


def _count(value: int, noun: str) -> str:
    word = _COUNT_WORDS.get(value, "many")
    return f"{word} {noun}" if value == 1 else f"{word} {noun}s"


def describe_tetris_move(move: TetrisMoveFeatures, board: TetrisBoardFeatures) -> str:
    """Describe in words what a placement changes on the board.

    LAYA compares meanings, not numbers: with raw metrics its choice followed
    the option position rather than the content. Describing the change (new
    holes, how much the stack rises, whether the surface gets rougher) instead
    of the absolute state keeps different moves from sounding the same; in
    examples/compare_tetris_prompts.py it cut tied scores from 60% to 15% and
    doubled LAYA's lines (20.5 -> 40.2).
    """

    parts = [f"clears {_count(move['linesCleared'], 'line')}"]
    new_holes = move["holes"] - board["holes"]
    parts.append(
        "creates no new holes" if new_holes <= 0 else f"creates {_count(new_holes, 'new hole')}"
    )
    rise = move["maxHeight"] - board["maxHeight"]
    parts.append(
        "lowers the stack" if rise < 0
        else "keeps the stack height" if rise == 0
        else f"raises the stack by {_count(rise, 'row')}"
    )
    rougher = move["bumpiness"] - board["bumpiness"]
    parts.append(
        "makes the surface flatter" if rougher < 0
        else "keeps the surface as flat" if rougher == 0
        else "makes the surface a bit rougher" if rougher <= 2
        else "makes the surface much rougher"
    )
    if move["maxHeight"] >= 15:
        parts.append("the stack is near the top")
    if move["nextLinePotential"]:
        parts.append(f"the next piece can clear {_count(move['nextLinePotential'], 'line')}")
    return ", ".join(parts)


def describe_tetris_move_absolute(move: TetrisMoveFeatures) -> str:
    """The earlier description of the board after the move, kept for comparisons."""

    parts = [f"clears {_count(move['linesCleared'], 'line')}"]
    holes = move["holes"]
    parts.append(
        "leaves no holes" if holes == 0
        else f"leaves {_count(holes, 'covered hole')}" if holes < 5
        else "leaves many covered holes"
    )
    height = move["maxHeight"]
    parts.append(
        "the stack stays low" if height <= 7
        else "the stack gets tall" if height <= 12
        else "the stack gets dangerously tall"
    )
    if move["nextLinePotential"]:
        parts.append(
            f"the next piece can clear {_count(move['nextLinePotential'], 'line')}"
        )
    return ", ".join(parts)


# Kept in English whatever the UI language: the Polish version of this prompt
# scored at chance level (23-31/60) on evaluate_tetris_moves.py.
TETRIS_INSTRUCTIONS = (
    "A Tetris player wants to clear lines and avoid holes and a tall stack. "
    "Would this move help them? The move {description}."
)


def build_tetris_request(
    moves: list[TetrisMoveFeatures], board: TetrisBoardFeatures
) -> NoulRequest:
    """Ask one independent yes-or-no question per candidate move.

    Independent noul questions do not depend on the order of the candidates,
    unlike one choice question over all of them.
    """

    return {
        "state": {"game": "Tetris"},
        "questions": {
            f"move_{index}": {
                "type": "noul",
                "instructions": TETRIS_INSTRUCTIONS.format(
                    description=describe_tetris_move(move, board)
                ),
                "labels": {"false": "no", "true": "yes"},
            }
            for index, move in enumerate(moves)
        },
    }


class SnakeMoveFeatures(TypedDict):
    """What one legal Snake move does, computed by the game engine."""

    eats: bool
    foodDelta: int
    openPercent: int
    exits: int
    boxedIn: bool


class SnakeStrategyFeatures(TypedDict):
    """What following one Snake strategy leads to, computed by the game engine."""

    strategy: str
    steps: int
    safe: bool
    openPercent: int


def _steps(count: int) -> str:
    return "one step" if count == 1 else f"{count} steps"


def _survival(safe: bool) -> str:
    return "the snake survives" if safe else "the snake gets stuck and dies"


def describe_snake_move(move: SnakeMoveFeatures) -> str:
    """Describe in words what a Snake move does and whether the snake survives it.

    On examples/compare_snake_prompts.py the earlier wording, which named the
    danger ("boxes the snake into a space too small for it", "leads into a dead
    end"), made both models rate the trapping move higher: LAYA picked the safe
    option in 33% of scenarios, below chance. Stating the outcome instead
    ("and then the snake survives / gets stuck and dies") gave 100% for LAYA
    and Jev.
    """

    if move["eats"]:
        base = "eats the food"
    else:
        base = "moves towards the food" if move["foodDelta"] < 0 else "moves away from the food"
    risky = move["boxedIn"] or move["exits"] == 0
    return f"{base}, and then {_survival(not risky)}"


def describe_snake_strategy(option: SnakeStrategyFeatures) -> str:
    """Describe in words what a Snake strategy does and whether the snake survives it.

    Chosen on examples/compare_snake_prompts.py, where both models picked the
    safe option 100% of the time and, when everything was safe, went for the
    food 100% of the time. Two things mattered: waiting strategies say they get
    no food (otherwise LAYA preferred following its tail over far-away food and
    the snake circled forever), and the food wording leaves out the distance
    (with "N steps away" LAYA rated a trapping route above a safe wait).
    """

    kind = option["strategy"]
    if kind == "food":
        if option["safe"]:
            return "heads for the food, eats it, and the snake survives"
        return "heads for the food, and then the snake gets stuck and dies"
    name = "follows its own tail" if kind == "tail" else "moves into the largest open area"
    if option["safe"]:
        return f"{name}, and the snake survives but gets no food"
    return f"{name}, and the snake gets stuck and dies"


# Kept in English whatever the UI language, like the Tetris prompt.
SNAKE_INSTRUCTIONS = (
    "A Snake player wants to eat the food and stay alive as long as possible. "
    "Would this move help them? The move {description}."
)


def _build_snake_request(descriptions: list[str]) -> NoulRequest:
    """One independent yes-or-no question per option, so the order of the options cannot matter."""

    return {
        "state": {"game": "Snake"},
        "questions": {
            f"move_{index}": {
                "type": "noul",
                "instructions": SNAKE_INSTRUCTIONS.format(description=description),
                "labels": {"false": "no", "true": "yes"},
            }
            for index, description in enumerate(descriptions)
        },
    }


def build_snake_request(moves: list[SnakeMoveFeatures]) -> NoulRequest:
    return _build_snake_request([describe_snake_move(move) for move in moves])


def build_snake_strategy_request(options: list[SnakeStrategyFeatures]) -> NoulRequest:
    return _build_snake_request([describe_snake_strategy(option) for option in options])
