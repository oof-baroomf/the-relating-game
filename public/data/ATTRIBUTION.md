# Data Attribution

`dictionary.txt` is generated from the ENABLE word list, fetched from
https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt. ENABLE is
widely distributed as a public-domain Scrabble-like word-game dictionary.

`endpoints.json` is generated from cached dictionary words across parts of
speech. The generator excludes the highest-frequency cached words before writing
the endpoint pool, so daily/random start and target words cannot come from the
most common part of the cached vocabulary.

`embeddings.json` is generated from `wink-embeddings-small-en-50d`, an MIT
licensed package of 50-dimensional English word embeddings derived from GloVe.

`subword.json` is generated locally from the cached embedding space using
fastText-style character n-grams, so uncached dictionary words can be embedded
without loading a large model at request time.
