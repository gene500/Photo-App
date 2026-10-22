#!/bin/zsh
# Like build-places-intl.sh, for South Korea and Japan (by Geofabrik region). Writes data/places-asia/*.jsonl, kept apart from
# the other files so loading them (node scripts/import-places.mjs data/places-asia, no --replace) never rewrites other rows.
# One extract at a time, each deleted after use: never more than one .pbf on disk.
cd "$(dirname "$0")/.."
mkdir -p data/places-asia data/.tmp
for r in south-korea japan/hokkaido japan/tohoku japan/kanto japan/chubu japan/kansai japan/chugoku japan/shikoku japan/kyushu; do
  name=${r:t}
  echo "$name"
  curl -sfL --retry 3 -o data/.tmp/$name.pbf https://download.geofabrik.de/asia/$r-latest.osm.pbf \
    && uv run --with osmium python scripts/extract-places.py data/.tmp/$name.pbf data/places-asia/$name.jsonl >/dev/null
  rm -f data/.tmp/$name.pbf
done
echo done
