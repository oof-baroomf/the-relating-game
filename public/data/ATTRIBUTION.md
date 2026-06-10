# Data Attribution

`dictionary.txt` is generated from the ENABLE word list, fetched from
https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt. ENABLE is
widely distributed as a public-domain Scrabble-like word-game dictionary.

`endpoints.json` is generated from dictionary words across parts of speech. The
generator excludes the 400,000 highest-frequency words from
https://github.com/possibly-wrong/word-frequency before writing the endpoint
pool, so daily/random start and target words cannot come from that common-word
set. The frequency list is derived from Google Books Ngrams and sorted by
decreasing 2020 frequency.

`embeddings.json` is generated from `wink-embeddings-small-en-50d`, an MIT
licensed package of 50-dimensional English word embeddings derived from GloVe.

`subword.json` is generated locally from the cached embedding space using
fastText-style character n-grams, so uncached dictionary words can be embedded
without loading a large model at request time.
