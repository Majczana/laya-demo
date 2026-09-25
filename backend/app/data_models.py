"""Typed representation of the JSON files used by the demo."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DataModel(BaseModel):
    """Common strict settings for every data model."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class EmojiItem(DataModel):
    """One candidate that LAYA can rank."""

    id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    emoji: str = Field(min_length=1)
    label: str = Field(min_length=1)
    description: str = Field(min_length=1)


class EmojiCatalog(DataModel):
    """Versioned collection of all candidates in the experiment."""

    version: int = Field(ge=1)
    language: str = Field(pattern=r"^[a-z]{2}(?:-[A-Z]{2})?$")
    items: list[EmojiItem] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_catalog(self) -> "EmojiCatalog":
        if len(self.items) != 16:
            raise ValueError("the demo requires exactly 16 emoji")

        item_ids = [item.id for item in self.items]
        if len(item_ids) != len(set(item_ids)):
            raise ValueError("emoji IDs must be unique")

        symbols = [item.emoji for item in self.items]
        if len(symbols) != len(set(symbols)):
            raise ValueError("emoji symbols must be unique")

        return self


class ExpectedResults(DataModel):
    """Expected relevance groups for one test case."""

    primary: list[str] = Field(min_length=1)
    related: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_groups(self) -> "ExpectedResults":
        if len(self.primary) != len(set(self.primary)):
            raise ValueError("primary IDs must be unique")
        if len(self.related) != len(set(self.related)):
            raise ValueError("related IDs must be unique")

        overlap = set(self.primary) & set(self.related)
        if overlap:
            repeated = ", ".join(sorted(overlap))
            raise ValueError(f"IDs cannot be both primary and related: {repeated}")

        return self


class TestCase(DataModel):
    """One Polish phrase and its expected ranking groups."""

    id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    input: str = Field(min_length=1)
    expected: ExpectedResults
    rationale: str = Field(min_length=1)


class RelevanceWeights(DataModel):
    """Weights used when calculating ranking quality."""

    primary: int = Field(ge=0)
    related: int = Field(ge=0)
    other: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_order(self) -> "RelevanceWeights":
        if not self.primary > self.related > self.other:
            raise ValueError("relevance must satisfy primary > related > other")
        return self


class EvaluationConfig(DataModel):
    """Shared ranking metric for choice and noul results."""

    metric: Literal["ndcg"]
    k: int = Field(gt=0)
    relevance: RelevanceWeights


class TestSuite(DataModel):
    """Versioned collection of controlled model experiments."""

    version: int = Field(ge=1)
    language: str = Field(pattern=r"^[a-z]{2}(?:-[A-Z]{2})?$")
    evaluation: EvaluationConfig
    cases: list[TestCase] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_case_ids(self) -> "TestSuite":
        case_ids = [case.id for case in self.cases]
        if len(case_ids) != len(set(case_ids)):
            raise ValueError("test case IDs must be unique")
        return self


class DemoData(DataModel):
    """All validated static data needed by the model experiments."""

    emojis: EmojiCatalog
    tests: TestSuite
