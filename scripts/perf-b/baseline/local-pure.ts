import { haversineMeters } from "@/lib/geo";
export type PlaceRow = { id: string; name: string; kind: string; lat: number; lng: number };
const KIND_TAGS: Record<string, Record<string, string>> = {
  viewpoint: { tourism: "viewpoint" },
  peak: { natural: "peak" },
  attraction: { tourism: "attraction" },
};
export function toElements(rows: PlaceRow[]): unknown[] {
  return rows.flatMap((r) => {
    const [type, id] = r.id.split("/");
    const tags = KIND_TAGS[r.kind];
    if (!tags || !type || !Number.isFinite(Number(id))) return [];
    return [{ type, id: Number(id), lat: r.lat, lon: r.lng, tags: r.name ? { ...tags, name: r.name } : { ...tags } }];
  });
}
export const filterCircle = (rows: PlaceRow[], lat: number, lng: number, radiusKm: number) =>
  rows.filter((r) => haversineMeters({ lat, lng }, r) <= radiusKm * 1000);
