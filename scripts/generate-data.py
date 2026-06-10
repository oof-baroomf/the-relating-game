import json
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path
from zipfile import ZipFile

import fasttext
import numpy as np


ENABLE_URL = "https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt"
FREQUENCY_URL = "https://raw.githubusercontent.com/possibly-wrong/word-frequency/main/word-frequency.txt"
FASTTEXT_URL = "https://dl.fbaipublicfiles.com/fasttext/vectors-english/wiki-news-300d-1M-subword.bin.zip"
BLOCKLIST_URL = "https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en"
FASTTEXT_ZIP_NAME = "wiki-news-300d-1M-subword.bin.zip"
FASTTEXT_BIN_NAME = "wiki-news-300d-1M-subword.bin"

ROOT_DIR = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT_DIR / "public" / "data"
VECTOR_DIR = OUT_DIR / "vectors"
CACHE_DIR = ROOT_DIR / ".cache" / "fasttext"
MODEL_ZIP = CACHE_DIR / FASTTEXT_ZIP_NAME
MODEL_BIN = CACHE_DIR / FASTTEXT_BIN_NAME
BLOCKLIST_SUPPLEMENT_PATH = ROOT_DIR / "scripts" / "nsfw-supplement.txt"

ENDPOINT_MIN_FREQUENCY_RANK = 2500
ENDPOINT_MAX_FREQUENCY_RANK = 12000
VECTOR_SHARD_SIZE = 20000
WORD_RE = re.compile(r"^[a-z]{2,15}$")
ENDPOINT_RE = re.compile(r"^[a-z]{5,10}$")


def clean_word(value):
    return value.strip().lower()


def fetch_text(url):
    with urllib.request.urlopen(url) as response:
        return response.read().decode("utf-8")


def ensure_model():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if not MODEL_ZIP.exists():
        subprocess.run(
            [
                "aria2c",
                "--continue=true",
                "--max-connection-per-server=16",
                "--split=16",
                "--min-split-size=16M",
                "--file-allocation=none",
                f"--dir={CACHE_DIR}",
                f"--out={FASTTEXT_ZIP_NAME}",
                FASTTEXT_URL,
            ],
            check=True,
        )
    if not MODEL_BIN.exists():
        with ZipFile(MODEL_ZIP) as archive:
            archive.extract(FASTTEXT_BIN_NAME, CACHE_DIR)


def normalized_vector(model, word):
    vector = model.get_word_vector(word).astype("<f4", copy=False)
    norm = np.linalg.norm(vector)
    if norm == 0:
        raise RuntimeError(f'fastText returned a zero vector for "{word}"')
    return (vector / norm).astype("<f4", copy=False)


def load_blocked_words(dictionary_set):
    source_words = {
        clean_word(word)
        for word in fetch_text(BLOCKLIST_URL).splitlines()
        if WORD_RE.fullmatch(clean_word(word))
    }
    supplement_words = {
        clean_word(word)
        for word in BLOCKLIST_SUPPLEMENT_PATH.read_text(encoding="utf-8").splitlines()
        if WORD_RE.fullmatch(clean_word(word))
    }
    return sorted((source_words | supplement_words) & dictionary_set)


def main():
    ensure_model()

    dictionary_text = fetch_text(ENABLE_URL)
    frequency_text = fetch_text(FREQUENCY_URL)

    dictionary_words = sorted(
        {
            clean_word(word)
            for word in dictionary_text.splitlines()
            if WORD_RE.fullmatch(clean_word(word))
        }
    )
    dictionary_set = set(dictionary_words)
    blocked_words = load_blocked_words(dictionary_set)
    blocked_set = set(blocked_words)

    frequency_rows = [
        (index + 1, clean_word(line.split("\t", 1)[0]))
        for index, line in enumerate(frequency_text.splitlines())
    ]
    endpoint_words = list(
        dict.fromkeys(
            word
            for rank, word in frequency_rows
            if ENDPOINT_MIN_FREQUENCY_RANK <= rank <= ENDPOINT_MAX_FREQUENCY_RANK
            and word in dictionary_set
            and word not in blocked_set
            and ENDPOINT_RE.fullmatch(word)
        )
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if VECTOR_DIR.exists():
        shutil.rmtree(VECTOR_DIR)
    VECTOR_DIR.mkdir(parents=True)

    model = fasttext.load_model(str(MODEL_BIN))
    dim = model.get_dimension()
    shard_paths = []

    for shard_index, start in enumerate(range(0, len(dictionary_words), VECTOR_SHARD_SIZE)):
        words = dictionary_words[start : start + VECTOR_SHARD_SIZE]
        rows = np.empty((len(words), dim), dtype="<f4")
        for row_index, word in enumerate(words):
            rows[row_index] = normalized_vector(model, word)

        shard_name = f"{shard_index:03}.bin"
        shard_path = VECTOR_DIR / shard_name
        rows.tofile(shard_path)
        shard_paths.append(f"data/vectors/{shard_name}")

    for stale_name in ("embeddings.json", "subword.json", "nouns.txt"):
        stale_path = OUT_DIR / stale_name
        if stale_path.exists():
            stale_path.unlink()

    (OUT_DIR / "dictionary.txt").write_text(
        "\n".join(dictionary_words) + "\n",
        encoding="utf-8",
    )
    (OUT_DIR / "endpoints.json").write_text(
        json.dumps({"words": endpoint_words}, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    (OUT_DIR / "blocked-words.json").write_text(
        json.dumps({"words": blocked_words}, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    (OUT_DIR / "lexicon.json").write_text(
        json.dumps(
            {
                "dim": dim,
                "shardSize": VECTOR_SHARD_SIZE,
                "words": dictionary_words,
                "shards": shard_paths,
                "source": "fastText wiki-news-300d-1M-subword.bin",
            },
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )
    (OUT_DIR / "manifest.json").write_text(
        json.dumps(
            {
                "dictionaryWords": len(dictionary_words),
                "endpointWords": len(endpoint_words),
                "endpointMinFrequencyRank": ENDPOINT_MIN_FREQUENCY_RANK,
                "endpointMaxFrequencyRank": ENDPOINT_MAX_FREQUENCY_RANK,
                "blockedWords": len(blocked_words),
                "vectorWords": len(dictionary_words),
                "vectorDim": dim,
                "vectorShardSize": VECTOR_SHARD_SIZE,
                "vectorShards": len(shard_paths),
                "dictionarySource": ENABLE_URL,
                "frequencySource": FREQUENCY_URL,
                "blocklistSource": BLOCKLIST_URL,
                "blocklistSupplement": str(BLOCKLIST_SUPPLEMENT_PATH.relative_to(ROOT_DIR)),
                "vectorSource": FASTTEXT_URL,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "dictionaryWords": len(dictionary_words),
                "endpointWords": len(endpoint_words),
                "vectorWords": len(dictionary_words),
                "vectorDim": dim,
                "vectorShards": len(shard_paths),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        raise
