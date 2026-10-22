#!/bin/zsh
# Like build-places.sh, for Canada (by province/territory) and Mexico. Writes data/places-intl/*.jsonl, kept apart from
# the US files so loading them (node scripts/import-places.mjs data/places-intl, no --replace) never rewrites the US rows.
cd "$(dirname "$0")/.."
mkdir -p data/places-intl data/.tmp
for r in canada/alberta canada/british-columbia canada/manitoba canada/new-brunswick canada/newfoundland-and-labrador canada/northwest-territories canada/nova-scotia canada/nunavut canada/ontario canada/prince-edward-island canada/quebec canada/saskatchewan canada/yukon mexico; do
  name=${r:t}
  echo "$name"
  curl -sfL -o data/.tmp/$name.pbf https://download.geofabrik.de/north-america/$r-latest.osm.pbf \
    && uv run --with osmium python scripts/extract-places.py data/.tmp/$name.pbf data/places-intl/$name.jsonl >/dev/null
  rm -f data/.tmp/$name.pbf
done
echo done
