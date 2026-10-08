import { describe, expect, it } from "vitest";
import { applyAppearance, DEFAULT_SETTINGS, parseSettings, parseStoredSettings, SETTINGS_INIT_SCRIPT, SETTINGS_KEY } from "./settings";

describe("parseSettings", () => {
  it("returns defaults for missing and non-object input", () => {
    for (const v of [undefined, null, 5, "x", [], true]) expect(parseSettings(v)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
  });
  it("keeps valid fields and defaults the corrupt ones", () => {
    expect(parseSettings({ theme: "dark", textSize: "huge", distanceUnit: "mi", timeFormat: 24, reduceMotion: "yes", mapStyle: "standard", suggestionLightPref: "any" })).toEqual({
      ...DEFAULT_SETTINGS, theme: "dark", distanceUnit: "mi", mapStyle: "standard", suggestionLightPref: "any",
    });
  });
  it("clamps and rounds the dwell minutes", () => {
    expect(parseSettings({ defaultDwellMinutes: 9999 }).defaultDwellMinutes).toBe(480);
    expect(parseSettings({ defaultDwellMinutes: -5 }).defaultDwellMinutes).toBe(0);
    expect(parseSettings({ defaultDwellMinutes: 12.6 }).defaultDwellMinutes).toBe(13);
    expect(parseSettings({ defaultDwellMinutes: NaN }).defaultDwellMinutes).toBe(30);
    expect(parseSettings({ defaultDwellMinutes: "45" }).defaultDwellMinutes).toBe(30);
  });
  it("ignores unknown keys and prototype tricks", () => {
    const out = parseSettings(JSON.parse('{"__proto__":{"theme":"dark"},"extra":1}'));
    expect(out).toEqual(DEFAULT_SETTINGS);
    expect(Object.keys(out)).not.toContain("extra");
  });
});

describe("parseStoredSettings", () => {
  it("falls back on null and invalid JSON", () => {
    expect(parseStoredSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings("{not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings('{"textSize":"large"}').textSize).toBe("large");
  });
});

function fakeEl() {
  const attrs = new Map<string, string>();
  return { attrs, setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) };
}

describe("applyAppearance", () => {
  it("sets attributes for explicit values and removes them for defaults", () => {
    const el = fakeEl();
    applyAppearance({ theme: "dark", textSize: "xlarge", reduceMotion: true }, el);
    expect(Object.fromEntries(el.attrs)).toEqual({ "data-theme": "dark", "data-text-size": "xlarge", "data-reduce-motion": "true" });
    applyAppearance({ theme: "system", textSize: "default", reduceMotion: false }, el);
    expect(el.attrs.size).toBe(0);
  });
});

describe("SETTINGS_INIT_SCRIPT", () => {
  const run = (stored: string | null | "throw") => {
    const el = fakeEl();
    const localStorage = { getItem: (k: string) => { if (stored === "throw") throw new Error("blocked"); return k === SETTINGS_KEY ? stored : null; } };
    new Function("document", "localStorage", SETTINGS_INIT_SCRIPT)({ documentElement: el }, localStorage);
    return Object.fromEntries(el.attrs);
  };
  it("applies the stored appearance like applyAppearance does", () => {
    expect(run(JSON.stringify({ theme: "light", textSize: "large", reduceMotion: true }))).toEqual({ "data-theme": "light", "data-text-size": "large", "data-reduce-motion": "true" });
  });
  it("ignores system/default values, junk, and blocked storage without throwing", () => {
    expect(run(JSON.stringify({ theme: "system", textSize: "default" }))).toEqual({});
    expect(run(JSON.stringify({ theme: "<script>", textSize: 3 }))).toEqual({});
    expect(run("{bad")).toEqual({});
    expect(run(null)).toEqual({});
    expect(run("throw")).toEqual({});
  });
  it("is a constant string with no interpolation hazards", () => {
    expect(typeof SETTINGS_INIT_SCRIPT).toBe("string");
    expect(SETTINGS_INIT_SCRIPT).not.toContain("${");
  });
});
