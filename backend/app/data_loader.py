"""Load and validate the demo's JSON data files."""

import json
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from app.data_models import DemoData, EmojiCatalog, TestSuite


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = PROJECT_ROOT / "data"

ModelType = TypeVar("ModelType", bound=BaseModel)


class DataLoadError(RuntimeError):
    """Raised when a data file cannot be read or validated."""


def _read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise DataLoadError(f"data file does not exist: {path}") from error
    except json.JSONDecodeError as error:
        raise DataLoadError(
            f"invalid JSON in {path} at line {error.lineno}, column {error.colno}"
        ) from error


def _load_model(path: Path, model_type: type[ModelType]) -> ModelType:
    raw_data = _read_json(path)
    try:
        return model_type.model_validate(raw_data)
    except ValidationError as error:
        raise DataLoadError(f"invalid data in {path}:\n{error}") from error


def load_emoji_catalog(path: Path | None = None) -> EmojiCatalog:
    """Load the emoji catalog from disk and validate its structure."""

    source = path or DEFAULT_DATA_DIR / "emojis_pl.json"
    return _load_model(source, EmojiCatalog)


def load_test_suite(path: Path | None = None) -> TestSuite:
    """Load the test suite from disk and validate its structure."""

    source = path or DEFAULT_DATA_DIR / "test-cases.json"
    return _load_model(source, TestSuite)


def load_demo_data(data_dir: Path | None = None) -> DemoData:
    """Load both files and validate relationships between them."""

    source_dir = data_dir or DEFAULT_DATA_DIR
    return load_demo_data_files(
        source_dir / "emojis_pl.json",
        source_dir / "test-cases.json",
    )


def load_demo_data_files(emoji_path: Path, test_path: Path) -> DemoData:
    """Load a selected catalog and test suite, then validate their links."""

    emojis = load_emoji_catalog(emoji_path)
    tests = load_test_suite(test_path)

    # The test suite language describes the input phrases. It may differ from
    # the catalog language because the multilingual checkpoint matches across
    # languages (for example Polish phrases against English descriptions).
    if tests.evaluation.k > len(emojis.items):
        raise DataLoadError("evaluation k cannot exceed the number of emoji")

    known_ids = {item.id for item in emojis.items}
    for test_case in tests.cases:
        referenced_ids = set(test_case.expected.primary)
        referenced_ids.update(test_case.expected.related)
        unknown_ids = referenced_ids - known_ids
        if unknown_ids:
            unknown = ", ".join(sorted(unknown_ids))
            raise DataLoadError(
                f"test case '{test_case.id}' references unknown emoji IDs: {unknown}"
            )

    return DemoData(emojis=emojis, tests=tests)


def main() -> None:
    """Print a small summary when the module is run directly."""

    data = load_demo_data()
    print(f"Loaded {len(data.emojis.items)} emoji")
    print(f"Loaded {len(data.tests.cases)} test cases")
    print(
        f"Evaluation: {data.tests.evaluation.metric.upper()}"
        f"@{data.tests.evaluation.k}"
    )


if __name__ == "__main__":
    main()
