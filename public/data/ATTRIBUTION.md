# Data Attribution

`dictionary.txt` is generated from the ENABLE word list, fetched from
https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt. ENABLE is
widely distributed as a public-domain Scrabble-like word-game dictionary.

`endpoints.json` is generated from dictionary words across parts of speech using
words ranked 10,000 through 45,000 in
https://github.com/possibly-wrong/word-frequency. That keeps daily/random start
and target words outside the most common band without falling into the
near-zero-frequency tail. The frequency list is derived from Google Books Ngrams
and sorted by decreasing 2020 frequency.

`lexicon.json` and `vectors/*.bin` are generated from
`wiki-news-300d-1M-subword.bin`, the official fastText English word-vector model
distributed at https://fasttext.cc/docs/en/english-vectors.html. Every accepted
dictionary word has a precomputed 300-dimensional vector from that model.

`blocked-words.json` is generated from the English list in Shutterstock's
LDNOOBW project at
https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words,
plus the local supplement in `scripts/nsfw-supplement.txt`.
