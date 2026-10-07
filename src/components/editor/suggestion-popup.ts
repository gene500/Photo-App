import type { PlacePhoto, Suggestion } from "@/lib/types";

// Built with DOM APIs only (textContent / setAttribute, never innerHTML): place names come from OpenStreetMap.
// Shared by the Mapbox popup and the offline map preview, so both look and behave the same.

export const POPUP_PHOTO_WIDTH = 220;
export const POPUP_PHOTO_HEIGHT = 140;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Popup body for a suggestion dot: a skeleton while the photo loads, then the photo (or nothing at all when
 * there is none / it fails to load), the name, the kind, and a plain-text Wikipedia credit.
 */
export function createSuggestionPopupContent(
  s: Pick<Suggestion, "name" | "kind">,
  loadPhoto: () => Promise<PlacePhoto | null>,
): HTMLElement {
  const root = el("div", "suggestion-popup-body w-[220px] overflow-hidden rounded-xl bg-surface text-foreground");
  root.setAttribute("role", "tooltip");
  root.dataset.testid = "suggestion-popup";

  const slot = el("div", "h-[140px] w-full animate-pulse bg-hover");
  slot.dataset.testid = "suggestion-popup-skeleton";
  root.append(slot);

  const text = el("div", "px-3 py-2");
  const name = el("p", "truncate text-sm font-medium", s.name);
  name.dataset.testid = "suggestion-popup-name";
  const meta = el("p", "text-xs text-muted", capitalize(s.kind));
  text.append(name, meta);
  root.append(text);

  let visual: HTMLElement = slot; // the skeleton, then the photo
  let credit: HTMLElement | null = null;
  const dropPhoto = () => {
    visual.remove();
    credit?.remove();
  };

  void loadPhoto().then(
    (photo) => {
      if (!photo) return dropPhoto();
      const img = el("img", "block h-[140px] w-full object-cover");
      img.width = POPUP_PHOTO_WIDTH;
      img.height = POPUP_PHOTO_HEIGHT;
      img.alt = s.name;
      img.loading = "eager";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", dropPhoto);
      img.src = photo.url;
      slot.replaceWith(img);
      visual = img;
      credit = el("p", "text-[10px] text-muted", `Photo: ${photo.credit}`);
      meta.after(credit);
    },
    dropPhoto,
  );
  return root;
}
