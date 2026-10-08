import sys, json, osmium

KINDS = ("viewpoint", "peak", "attraction")

def kind_of(tags):
    if tags.get("tourism") == "viewpoint": return "viewpoint"
    if tags.get("natural") == "peak": return "peak"
    if tags.get("tourism") == "attraction": return "attraction"
    return None

src, out = sys.argv[1], sys.argv[2]
n = {k: 0 for k in KINDS}
with open(out, "w") as f:
    fp = osmium.FileProcessor(src, osmium.osm.NODE | osmium.osm.WAY).with_locations().with_filter(osmium.filter.TagFilter(("tourism", "viewpoint"), ("tourism", "attraction"), ("natural", "peak")))
    for o in fp:
        tags = {t.k: t.v for t in o.tags}
        kind = kind_of(tags)
        if not kind: continue
        name = (tags.get("name") or "").strip()
        if kind == "peak" and not name: continue
        if o.is_node():
            lat, lng, t = o.location.lat, o.location.lon, "node"
        else:
            pts = [(nd.lat, nd.lon) for nd in o.nodes if nd.location.valid()]
            if not pts: continue
            lat = sum(p[0] for p in pts) / len(pts); lng = sum(p[1] for p in pts) / len(pts); t = "way"
        n[kind] += 1
        f.write(json.dumps([t, o.id, name, kind, round(lat, 5), round(lng, 5)], ensure_ascii=False) + "\n")
print(json.dumps(n))
