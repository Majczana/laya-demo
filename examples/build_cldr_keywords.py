"""Extract Polish CLDR emoji keywords for the 100-emoji catalog."""

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.request import urlopen

from app.data_loader import load_emoji_catalog


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = PROJECT_ROOT / "data" / "emojis_100.json"
OUTPUT_PATH = PROJECT_ROOT / "data" / "emoji_keywords_cldr_pl.json"
CLDR_BASE = "https://raw.githubusercontent.com/unicode-org/cldr/main/common"
SOURCES = (
    f"{CLDR_BASE}/annotations/pl.xml",
    f"{CLDR_BASE}/annotationsDerived/pl.xml",
)
VARIATION_SELECTOR = "️"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build data/emoji_keywords_cldr_pl.json from Unicode CLDR."
    )
    parser.add_argument(
        "--source",
        action="append",
        help="Local CLDR XML file used instead of downloading (repeatable).",
    )
    return parser.parse_args()


def load_annotations(xml_text: str) -> dict[str, list[str]]:
    """Map emoji without variation selectors to their keyword lists."""

    root = ET.fromstring(xml_text)
    annotations: dict[str, list[str]] = {}
    for node in root.iter("annotation"):
        if node.get("type") == "tts" or not node.text:
            continue
        key = node.get("cp", "").replace(VARIATION_SELECTOR, "")
        annotations[key] = [
            keyword.strip() for keyword in node.text.split("|") if keyword.strip()
        ]
    return annotations


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    args = parse_args()
    if args.source:
        texts = [Path(path).read_text(encoding="utf-8") for path in args.source]
    else:
        texts = [urlopen(url).read().decode("utf-8") for url in SOURCES]

    annotations: dict[str, list[str]] = {}
    for text in texts:
        for key, keywords in load_annotations(text).items():
            annotations.setdefault(key, keywords)

    catalog = load_emoji_catalog(CATALOG_PATH)
    keywords = {
        item.id: annotations.get(item.emoji.replace(VARIATION_SELECTOR, ""), [])
        for item in catalog.items
    }
    missing = [emoji_id for emoji_id, values in keywords.items() if not values]

    output = {
        "version": 1,
        "language": "pl",
        "source": "Unicode CLDR annotations (pl), https://github.com/unicode-org/cldr",
        "license": "Unicode License v3, https://www.unicode.org/license.txt",
        "keywords": keywords,
    }
    OUTPUT_PATH.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Zapisano {OUTPUT_PATH.relative_to(PROJECT_ROOT)}")
    print(f"Brak słów kluczowych: {missing or 'brak'}")


if __name__ == "__main__":
    main()
