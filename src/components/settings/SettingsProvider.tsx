"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { applyAppearance, DEFAULT_SETTINGS, parseSettings, parseStoredSettings, SETTINGS_KEY, type Settings } from "@/lib/settings";

type Ctx = { settings: Settings; update: (patch: Partial<Settings>) => void; reset: () => void };

// Outside a provider (unit tests of leaf components) the hook just yields the defaults.
const SettingsContext = createContext<Ctx>({ settings: DEFAULT_SETTINGS, update: () => {}, reset: () => {} });

// A tiny external store over localStorage. `memory` is what reads fall back to when storage cannot be read at all.
// When a write fails (quota) but reads still work, `unsaved` holds the change for the rest of the visit; it is
// dropped as soon as storage moves on (another tab wrote, or a later write succeeds), so a blip is never permanent.
let memory: Settings = DEFAULT_SETTINGS;
let unsaved: Settings | null = null;
let unsavedBase: string | null = null; // the stored value when the write failed
let cachedRaw: string | null | undefined;
let cached: Settings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();

function getSnapshot(): Settings {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SETTINGS_KEY);
  } catch {
    return memory; // unreadable right now; try again on the next read
  }
  if (unsaved) {
    if (raw === unsavedBase) return unsaved;
    unsaved = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parseStoredSettings(raw);
    memory = cached;
  }
  return cached;
}

const getServerSnapshot = () => DEFAULT_SETTINGS;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SETTINGS_KEY) cb(); // null = storage cleared
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function write(next: Settings): void {
  memory = next;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    unsaved = null;
  } catch {
    unsaved = next;
    try {
      unsavedBase = window.localStorage.getItem(SETTINGS_KEY);
    } catch {
      unsavedBase = null;
    }
  }
  listeners.forEach((cb) => cb());
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // The inline script in <head> already set these before paint; this keeps them in step with later changes, and
  // re-applies them after React's dev-mode remount resets <html>.
  useLayoutEffect(() => {
    applyAppearance(settings, document.documentElement);
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => write(parseSettings({ ...getSnapshot(), ...patch })), []);
  const reset = useCallback(() => write(DEFAULT_SETTINGS), []);
  const value = useMemo(() => ({ settings, update, reset }), [settings, update, reset]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  return useContext(SettingsContext);
}
