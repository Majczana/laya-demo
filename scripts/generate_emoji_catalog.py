"""Build the 200-item bilingual catalog from Unicode's emoji test data.

The first 100 entries remain the hand-written demo catalog. The remaining
entries use Unicode short names for English and CLDR translations for Polish.
``emoji-test.txt`` and the CLDR annotations are downloaded separately because
they are versioned upstream data files.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


EMOJI_LINE = re.compile(
    r"^\s*(?P<codepoints>[0-9A-F ]+)\s*;\s*fully-qualified\s+#\s+"
    r"(?P<emoji>\S+)\s+E[0-9.]+\s+(?P<name>.+?)\s*$"
)
ID_WORD = re.compile(r"[^a-z0-9]+")


def load_existing(path: Path) -> tuple[int, list[dict[str, str]]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["version"], data["items"]


def load_polish_annotations(path: Path) -> dict[str, dict[str, list[str]]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["annotations"]["annotations"]


def slug(name: str, used: set[str]) -> str:
    value = ID_WORD.sub("-", name.lower()).strip("-") or "emoji"
    if value[0].isdigit():
        value = f"emoji-{value}"
    candidate = value
    suffix = 2
    while candidate in used:
        candidate = f"{value}-{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


def parse_unicode_catalog(path: Path, existing_symbols: set[str], used_ids: set[str]) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        match = EMOJI_LINE.match(line)
        if not match:
            continue
        emoji = match.group("emoji")
        if emoji in existing_symbols:
            continue
        name = match.group("name")
        items.append(
            {
                "id": slug(name, used_ids),
                "emoji": emoji,
                "label": name,
                "description": (
                    f"emoji representing {name}, used to describe people, objects, "
                    "activities, feelings, or situations"
                ),
            }
        )
    return items


def polish_label(emoji: str, fallback: str, annotations: dict[str, dict[str, list[str]]]) -> str:
    candidates = [emoji, emoji.replace("\ufe0f", "")]
    without_skin_tone = re.sub(r"[\U0001F3FB-\U0001F3FF]", "", emoji)
    candidates.extend([without_skin_tone, without_skin_tone.replace("\ufe0f", "")])
    for candidate in candidates:
        entry = annotations.get(candidate)
        if entry:
            label = (entry.get("tts") or entry.get("default") or [fallback])[0]
            if without_skin_tone != emoji:
                return f"{label} — wariant koloru skóry"
            return label
    return "wariant emoji"


def localize(
    items: list[dict[str, str]],
    language: str,
    annotations: dict[str, dict[str, list[str]]],
) -> list[dict[str, str]]:
    if language == "en":
        return items
    return [
        {
            **item,
            "label": polish_label(item["emoji"], item["label"], annotations),
            "description": (
                f'emoji oznaczające "{polish_label(item["emoji"], item["label"], annotations)}", '
                "używane do opisywania osób, przedmiotów, aktywności, uczuć lub sytuacji"
            ),
        }
        for item in items
    ]


def write_catalog(path: Path, version: int, language: str, items: list[dict[str, str]]) -> None:
    path.write_text(
        json.dumps(
            {"version": version, "language": language, "items": items},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("unicode_file", type=Path)
    parser.add_argument("--polish-source", type=Path, required=True)
    parser.add_argument("--english-source", type=Path, required=True)
    parser.add_argument("--polish-output", type=Path, required=True)
    parser.add_argument("--english-output", type=Path, required=True)
    parser.add_argument("--polish-annotations", type=Path, required=True)
    parser.add_argument("--count", type=int, default=200)
    args = parser.parse_args()

    version, polish_base = load_existing(args.polish_source)
    polish_annotations = load_polish_annotations(args.polish_annotations)
    _, english_base = load_existing(args.english_source)
    if len(polish_base) != len(english_base):
        raise SystemExit("the two source catalogs must have the same length")
    if [item["id"] for item in polish_base] != [item["id"] for item in english_base]:
        raise SystemExit("the two source catalogs must list IDs in the same order")
    if [item["emoji"] for item in polish_base] != [item["emoji"] for item in english_base]:
        raise SystemExit("the two source catalogs must list emoji in the same order")
    if args.count < len(polish_base):
        raise SystemExit("target count cannot be smaller than the source catalog")

    existing_symbols = {item["emoji"] for item in polish_base}
    used_ids = {item["id"] for item in polish_base}
    additions = parse_unicode_catalog(args.unicode_file, existing_symbols, used_ids)
    if len(polish_base) + len(additions) < args.count:
        raise SystemExit(
            f"Unicode catalog contains only {len(polish_base) + len(additions)} usable emoji"
        )
    additions = additions[: args.count - len(polish_base)]

    polish_items = polish_base + localize(additions, "pl", polish_annotations)
    english_items = english_base + additions
    write_catalog(args.polish_output, version + 1, "pl", polish_items)
    write_catalog(args.english_output, version + 1, "en", english_items)
    print(f"wrote {len(polish_items)} emoji to {args.polish_output} and {args.english_output}")


if __name__ == "__main__":
    main()
