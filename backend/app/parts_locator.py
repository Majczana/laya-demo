"""Point at the robot parts a described fault may involve, one independent question per part.

Several parts can light up at once (a lost route may involve both the LiDAR and
the camera), unlike a single multiple-choice question. The part list is the
demo taxonomy from ``ticket_triage``, restricted to what the robot family has.
"""

from typing import Any

from app.engines import Engine, predict
from app.injection import actual_cost
from app.jev_runtime import JEV_MODEL_NAME, jev_questions
from app.laya_runtime import HEAD_MAX_LEN, LAYA_CHECKPOINT, answer, checked_probability
from app.ticket_triage import OPTIONS


ROBOTS = {
    "delivery": ("robot kelnerski", "serving robot"),
    "cleaning": ("robot czyszczący", "cleaning robot"),
}

# Every family has these; the rest only make sense for one family.
_COMMON = ["battery", "charger", "wheel", "lidar", "camera", "bumper", "screen"]
PARTS_BY_ROBOT = {
    "delivery": _COMMON + ["tray"],
    "cleaning": _COMMON + ["pump", "filter"],
}

# A part is called likely from this score up; it is a display threshold, not calibrated.
LIKELY_THRESHOLD = 0.5

# Kept short and in English whatever the UI language: on the demo examples LAYA picked the
# expected part first 5 times of 8 with this wording, against 2-3 of 8 for longer or Polish
# wordings, which made it light up most of the robot. The part names follow the same rule.
INSTRUCTION = "Is a faulty {part} the cause of the symptom"


def part_name(part: str, lang: str) -> str:
    """The name shown in the UI; the questions always use the English one."""

    return OPTIONS["part"][part][0 if lang == "pl" else 1]


def build_request(symptom: str, robot: str, lang: str) -> dict[str, Any]:
    index = 0 if lang == "pl" else 1
    labels = {"false": "nie" if lang == "pl" else "no", "true": "tak" if lang == "pl" else "yes"}
    return {
        "state": {"symptom": symptom, "robot": ROBOTS[robot][index]},
        "questions": {
            f"part_{part}": {
                "type": "noul",
                "instructions": INSTRUCTION.format(part=part_name(part, "en")),
                "labels": labels,
            }
            for part in PARTS_BY_ROBOT[robot]
        },
    }


def locate(symptom: str, robot: str, lang: str, engine: Engine) -> dict[str, Any]:
    request = build_request(symptom, robot, lang)
    raw = predict(request, engine=engine)
    parts = [
        {
            "id": part,
            "name": part_name(part, lang),
            "score": checked_probability(answer(raw, f"part_{part}").get("noul"), f"part_{part}"),
        }
        for part in PARTS_BY_ROBOT[robot]
    ]
    ranked = sorted(parts, key=lambda item: item["score"], reverse=True)
    model_request = (
        {"model": JEV_MODEL_NAME, "state": request["state"], "questions": jev_questions(request["questions"])}
        if engine == "jev" else
        {"model": LAYA_CHECKPOINT, "head_max_len": HEAD_MAX_LEN, **request}
    )
    return {
        "robot": robot,
        "parts": ranked,
        "likely": [item["id"] for item in ranked if item["score"] >= LIKELY_THRESHOLD],
        "threshold": LIKELY_THRESHOLD,
        "cost": actual_cost(raw, engine),
        "model_request": model_request,
        "model_response": raw,
    }
