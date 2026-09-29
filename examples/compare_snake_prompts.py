"""Compare Snake option descriptions on scenarios with a known right answer.

Each scenario offers 2-3 options (strategies or moves). Some options are unsafe: they end with
the snake cut off from its own tail. A wording is good when the model's top-rated option is not
an unsafe one whenever a safe alternative exists. Options are independent noul questions, as in
the app, so the order of the options cannot matter.

    python examples/compare_snake_prompts.py --engine laya
    python examples/compare_snake_prompts.py --engine jev --scenarios 40
"""

import argparse
import random
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.engines import predict  # noqa: E402
from app.laya_requests import SNAKE_INSTRUCTIONS  # noqa: E402

NOUL_LABELS = {"false": "no", "true": "yes"}


# ---------- strategy wordings ----------

def steps_text(steps: int) -> str:
    return "one step" if steps == 1 else f"{steps} steps"


def strategy_current(option: dict) -> str:
    """Negative wording, like the first Snake prompt: it names the danger."""
    kind = option["strategy"]
    if kind == "food":
        tail = "and can still get out afterwards" if option["safe"] else "but would trap the snake after eating"
        return f"heads for the food, {steps_text(option['steps'])} away, {tail}"
    if kind == "tail":
        return "follows its own tail, which is a safe way to wait"
    return "moves into the largest open area"


def strategy_positive(option: dict) -> str:
    """Only good things are named; a risky option simply lacks the reassurance."""
    kind = option["strategy"]
    if kind == "food":
        text = f"heads for the food, {steps_text(option['steps'])} away"
        return text + (" and stays free to move afterwards" if option["safe"] else "")
    if kind == "tail":
        return "follows its own tail and stays free to move"
    return "moves into the largest open area and stays free to move"


def strategy_verdict(option: dict) -> str:
    """Leads with a plain verdict word before the details."""
    kind = option["strategy"]
    if kind == "food":
        verdict = "a safe plan" if option["safe"] else "a dangerous plan"
        return f"is {verdict}: it heads for the food, {steps_text(option['steps'])} away"
    if kind == "tail":
        return "is a safe plan: it follows its own tail"
    return "is a safe plan: it moves into the largest open area"


def strategy_survival(option: dict) -> str:
    """Speaks about survival directly."""
    kind = option["strategy"]
    if kind == "food":
        outcome = "the snake survives" if option["safe"] else "the snake gets stuck and dies"
        return f"heads for the food, {steps_text(option['steps'])} away, and then {outcome}"
    if kind == "tail":
        return "follows its own tail, and the snake survives"
    return "moves into the largest open area, and the snake survives"


def strategy_payoff(option: dict) -> str:
    """Survival plus what the option gets: food, or nothing."""
    kind = option["strategy"]
    if kind == "food":
        outcome = "eats and the snake survives" if option["safe"] else "the snake gets stuck and dies"
        return f"heads for the food, {steps_text(option['steps'])} away, and then {outcome}"
    return f"{'follows its own tail' if kind == 'tail' else 'moves into the largest open area'}, and the snake survives but gets no food"


def strategy_closer(option: dict) -> str:
    """Survival plus whether the option gets closer to eating."""
    kind = option["strategy"]
    if kind == "food":
        return f"gets {steps_text(option['steps'])} closer to the food, and then {_survival(option['safe'])}"
    return f"{'follows its own tail' if kind == 'tail' else 'moves into the largest open area'}, gets no closer to the food, and {_survival(option['safe'])}"


def _survival(safe: bool) -> str:
    return "the snake survives" if safe else "the snake gets stuck and dies"


def strategy_hybrid1(option: dict) -> str:
    """Survival wording; waiting options say they get no food."""
    kind = option["strategy"]
    if kind == "food":
        return strategy_survival(option)
    name = "follows its own tail" if kind == "tail" else "moves into the largest open area"
    return f"{name}, and the snake survives but gets no food"


def strategy_hybrid2(option: dict) -> str:
    """As hybrid1, and safe food says it is eaten."""
    if option["strategy"] == "food" and option["safe"]:
        return f"heads for the food, {steps_text(option['steps'])} away, eats it, and the snake survives"
    return strategy_hybrid1(option)


def strategy_hybrid3(option: dict) -> str:
    """As hybrid2, without the distance: how far the food is does not change the wording."""
    if option["strategy"] == "food":
        return "heads for the food, eats it, and the snake survives" if option["safe"] else "heads for the food, and then the snake gets stuck and dies"
    return strategy_hybrid1(option)


STRATEGY_VARIANTS = {
    "current": strategy_current,
    "survival": strategy_survival,
    "payoff": strategy_payoff,
    "hybrid1": strategy_hybrid1,
    "hybrid2": strategy_hybrid2,
    "hybrid3": strategy_hybrid3,
}


# ---------- move wordings ----------

def move_current(move: dict) -> str:
    parts = ["eats the food"] if move["eats"] else ["moves towards the food" if move["foodDelta"] < 0 else "moves away from the food"]
    if move["boxedIn"]:
        parts.append("boxes the snake into a space too small for it")
    elif move["openPercent"] < 60:
        parts.append("leaves the snake little open space")
    else:
        parts.append("keeps plenty of open space")
    if move["exits"] == 0:
        parts.append("leads into a dead end")
    elif move["exits"] == 1:
        parts.append("leaves only one way out")
    return ", ".join(parts)


def move_positive(move: dict) -> str:
    parts = ["eats the food"] if move["eats"] else ["moves towards the food" if move["foodDelta"] < 0 else "moves away from the food"]
    risky = move["boxedIn"] or move["exits"] == 0
    parts.append("stays free to move afterwards" if not risky else "")
    return ", ".join(part for part in parts if part)


def move_survival(move: dict) -> str:
    risky = move["boxedIn"] or move["exits"] == 0
    base = "eats the food" if move["eats"] else ("moves towards the food" if move["foodDelta"] < 0 else "moves away from the food")
    return f"{base}, and then the snake {'gets stuck and dies' if risky else 'survives'}"


MOVE_VARIANTS = {"current": move_current, "positive": move_positive, "survival": move_survival}


# ---------- scenarios ----------

def strategy_scenarios(count: int, seed: int) -> list[list[dict]]:
    rng = random.Random(seed)
    scenarios = []
    while len(scenarios) < count:
        options = [
            {"strategy": "food", "steps": rng.randint(1, 40), "safe": rng.random() < 0.5, "openPercent": rng.randint(20, 100)},
            {"strategy": "tail", "steps": rng.randint(1, 20), "safe": True, "openPercent": rng.randint(20, 100)},
            {"strategy": "space", "steps": 0, "safe": True, "openPercent": rng.randint(20, 100)},
        ]
        options = rng.sample(options, rng.choice([2, 3]))
        if any(not o["safe"] for o in options) and any(o["safe"] for o in options):
            scenarios.append(options)
    return scenarios


def move_scenarios(count: int, seed: int) -> list[list[dict]]:
    rng = random.Random(seed)
    scenarios = []
    while len(scenarios) < count:
        options = [
            {
                "eats": rng.random() < 0.1,
                "foodDelta": rng.choice([-1, 1]),
                "openPercent": rng.randint(20, 100),
                "exits": rng.randint(0, 3),
                "boxedIn": rng.random() < 0.4,
            }
            for _ in range(rng.choice([2, 3]))
        ]
        risky = [o["boxedIn"] or o["exits"] == 0 for o in options]
        if any(risky) and not all(risky):
            scenarios.append(options)
    return scenarios


def food_scenarios(count: int, seed: int) -> list[list[dict]]:
    """Everything is safe; the right answer is to go for the food."""
    rng = random.Random(seed)
    scenarios = []
    for _ in range(count):
        options = [
            {"strategy": "food", "steps": rng.randint(1, 40), "safe": True, "openPercent": rng.randint(20, 100)},
            {"strategy": "tail", "steps": rng.randint(1, 12), "safe": True, "openPercent": rng.randint(20, 100)},
            {"strategy": "space", "steps": 0, "safe": True, "openPercent": rng.randint(20, 100)},
        ]
        scenarios.append(rng.sample(options, rng.choice([2, 3])) if rng.random() < 0.5 else options)
    return [sc for sc in scenarios if any(o["strategy"] == "food" for o in sc)]


def is_unsafe(option: dict) -> bool:
    if "strategy" in option:
        return not option["safe"]
    return option["boxedIn"] or option["exits"] == 0


def score_options(engine: str, descriptions: list[str]) -> list[float]:
    request = {
        "state": {"game": "Snake"},
        "questions": {
            f"move_{i}": {
                "type": "noul",
                "instructions": SNAKE_INSTRUCTIONS.format(description=text),
                "labels": NOUL_LABELS,
            }
            for i, text in enumerate(descriptions)
        },
    }
    result = predict(request, engine=engine)
    return [result["answers"][f"move_{i}"]["noul"] for i in range(len(descriptions))]


def evaluate(engine: str, name: str, describe, scenarios: list[list[dict]], wants_food: bool = False) -> None:
    def one(options):
        scores = score_options(engine, [describe(o) for o in options])
        best = max(range(len(scores)), key=scores.__getitem__)
        ties = len(set(round(s, 3) for s in scores)) < len(scores)
        if wants_food:
            return options[best]["strategy"] == "food", ties
        return not is_unsafe(options[best]), ties

    with ThreadPoolExecutor(max_workers=1 if engine == "laya" else 4) as pool:
        outcomes = list(pool.map(one, scenarios))
    safe = sum(1 for ok, _ in outcomes if ok)
    ties = sum(1 for _, tie in outcomes if tie)
    label = "top pick is food" if wants_food else "top pick safe"
    print(f"  {name:10s} {label} {safe:3d}/{len(scenarios)} ({safe / len(scenarios):.0%})   tied scores {ties}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", default="laya", choices=["laya", "jev"])
    parser.add_argument("--scenarios", type=int, default=60)
    parser.add_argument("--seed", type=int, default=3)
    args = parser.parse_args()
    print(f"{args.engine}: chance level is about 50%; every scenario has at least one safe and one unsafe option")
    print("strategies")
    scenarios = strategy_scenarios(args.scenarios, args.seed)
    for name, describe in STRATEGY_VARIANTS.items():
        evaluate(args.engine, name, describe, scenarios)
    print("strategies, all safe: does the model still go for the food?")
    scenarios = food_scenarios(args.scenarios, args.seed)
    for name, describe in STRATEGY_VARIANTS.items():
        evaluate(args.engine, name, describe, scenarios, wants_food=True)
    print("moves")
    scenarios = move_scenarios(args.scenarios, args.seed)
    for name, describe in MOVE_VARIANTS.items():
        evaluate(args.engine, name, describe, scenarios)


if __name__ == "__main__":
    main()
