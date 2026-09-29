"""Configurable 0–2 score questions over several repair-information sources."""

from math import isfinite
from typing import Any

from app.engines import Engine, predict
from app.injection import actual_cost
from app.jev_runtime import JEV_MODEL_NAME
from app.laya_runtime import HEAD_MAX_LEN, LAYA_CHECKPOINT, ModelOutputError, answer, checked_probability


def build_request(state: dict[str, str], criteria: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "state": state,
        "questions": {
            f"criterion_{index}": {
                "type": "score",
                "instructions": criterion["question"],
                "criteria": list(criterion["levels"]),
            }
            for index, criterion in enumerate(criteria)
        },
    }


def score_repair(state: dict[str, str], criteria: list[dict[str, Any]], engine: Engine) -> dict[str, Any]:
    request = build_request(state, criteria)
    raw = predict(request, engine=engine)
    results = []
    for index, criterion in enumerate(criteria):
        response = answer(raw, f"criterion_{index}")
        score = response.get("score")
        if isinstance(score, bool) or not isinstance(score, (int, float)) or not isfinite(score) or not 0 <= score <= 2:
            raise ModelOutputError(f"the model returned an invalid score for criterion {index}")
        probabilities = response.get("probabilities")
        if not isinstance(probabilities, dict):
            raise ModelOutputError(f"the model returned no level probabilities for criterion {index}")
        levels = {str(level): checked_probability(probabilities.get(str(level)), f"criterion {index} level {level}") for level in range(3)}
        confidence = response.get("confidence")
        if confidence is not None:
            confidence = checked_probability(confidence, f"criterion {index} confidence")
        results.append({
            "name": criterion["name"],
            "score": float(score),
            "levels": criterion["levels"],
            "probabilities": levels,
            "confidence": confidence,
        })
    model_request = (
        {"model": JEV_MODEL_NAME, **request}
        if engine == "jev" else
        {"model": LAYA_CHECKPOINT, "head_max_len": HEAD_MAX_LEN, **request}
    )
    return {"results": results, "cost": actual_cost(raw, engine), "model_request": model_request, "model_response": raw}
