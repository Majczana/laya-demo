"""Score the emoji catalog with one batch of decisions from LAYA or Jev."""

from app.data_models import EmojiCatalog
from app.engines import Engine, predict
from app.laya_requests import build_noul_request
from app.laya_runtime import ModelOutputError, answer, checked_probability


__all__ = ["EmojiDecisionScorer"]


class EmojiDecisionScorer:
    """Preserve catalog IDs when interpreting the model's answers."""

    def __init__(self, catalog: EmojiCatalog) -> None:
        self.catalog = catalog

    def scores(self, text: str, engine: Engine = "laya") -> dict[str, float]:
        request = build_noul_request(text, self.catalog, describe_answers=engine == "jev")
        result = predict(request, engine=engine)
        expected_ids = {item.id for item in self.catalog.items}
        if set(result.get("answers", {})) != expected_ids:
            raise ModelOutputError("the model returned an incomplete emoji catalog")

        return {
            item.id: checked_probability(answer(result, item.id)["noul"], item.id)
            for item in self.catalog.items
        }
