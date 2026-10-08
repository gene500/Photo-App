#!/bin/zsh
# Rebuilds data/places/*.jsonl (viewpoints, named peaks, attractions for the 50 states + DC) from OpenStreetMap.
# Downloads one state's extract at a time from Geofabrik (170 MB to 1.3 GB each, about 1 hour and 10 GB in all),
# filters it with scripts/extract-places.py (needs `uv`), and deletes the download. Then load the result with
#   node scripts/import-places.mjs data/places --replace
cd "$(dirname "$0")/.."
mkdir -p data/places data/.tmp
for st in alabama alaska arizona arkansas california colorado connecticut delaware district-of-columbia florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada new-hampshire new-jersey new-mexico new-york north-carolina north-dakota ohio oklahoma oregon pennsylvania rhode-island south-carolina south-dakota tennessee texas utah vermont virginia washington west-virginia wisconsin wyoming; do
  echo "$st"
  curl -sfL -o data/.tmp/$st.pbf https://download.geofabrik.de/north-america/us/$st-latest.osm.pbf \
    && uv run --with osmium python scripts/extract-places.py data/.tmp/$st.pbf data/places/$st.jsonl >/dev/null
  rm -f data/.tmp/$st.pbf
done
