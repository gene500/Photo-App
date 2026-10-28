import type mapboxgl from "mapbox-gl";
import type { LngLat } from "@/lib/types";

export const ZOOM_FIT_LABEL = "Zoom to fit all stops";
/** Four corner brackets (the "fit to screen" symbol), drawn in currentColor so dark mode follows the text colour. */
export const ZOOM_FIT_SVG =
  '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/></svg>';

/** Every stop plus the route line, in the order the one fit helper takes them. */
export function fitTargets(stops: { lat: number; lng: number }[], routeGeometry: LngLat[] | null | undefined): LngLat[] {
  return [...stops.map((s): LngLat => [s.lng, s.lat]), ...(routeGeometry ?? [])];
}

/**
 * A Mapbox control holding one round-cornered button, added after the attribution control so it stacks directly under the
 * (i) in the same corner. `setVisible(false)` hides it (no stops); `onFit` does the work.
 */
export class ZoomFitControl implements mapboxgl.IControl {
  private container: HTMLDivElement | null = null;
  private visible = true;
  constructor(private onFit: () => void) {}
  onAdd(): HTMLElement {
    const el = document.createElement("div");
    el.className = "mapboxgl-ctrl zoom-fit-ctrl";
    el.hidden = !this.visible;
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", ZOOM_FIT_LABEL);
    b.title = ZOOM_FIT_LABEL;
    b.innerHTML = ZOOM_FIT_SVG;
    b.addEventListener("click", (e) => { e.stopPropagation(); this.onFit(); });
    el.appendChild(b);
    this.container = el;
    return el;
  }
  onRemove(): void {
    this.container?.remove();
    this.container = null;
  }
  setVisible(v: boolean): void {
    this.visible = v;
    if (this.container) this.container.hidden = !v;
  }
}
