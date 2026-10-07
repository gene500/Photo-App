import { describe, expect, it } from "vitest";
import { fileTitleToName, nameScore, namesMatch } from "./photo-match";

describe("namesMatch", () => {
  it("matches the same place spelled differently", () => {
    expect(namesMatch("Griffith Observatory", "Griffith Observatory")).toBe(true);
    expect(namesMatch("Half Dome", "Half Dome from Glacier Point")).toBe(true); // every distinctive word of the place
    expect(namesMatch("Café du Monde", "Cafe du Monde")).toBe(true);
    expect(namesMatch("Mount Whitney", "Mt. Whitney")).toBe(true);
  });

  it("does not match places that only share a type word or differ in type (review findings)", () => {
    expect(namesMatch("Eagle Peak", "Eagle Rock")).toBe(false);
    expect(namesMatch("Sunset Beach", "Huntington Beach Pier")).toBe(false);
    expect(namesMatch("Yosemite Falls", "Yosemite Valley")).toBe(false);
    expect(namesMatch("Bixby Creek Bridge", "Bixby Beach")).toBe(false);
    expect(namesMatch("Lake Tahoe", "Lake Mead")).toBe(false);
  });

  it("requires half of the larger name, unless the whole place name is contained", () => {
    expect(namesMatch("Alpha Beta Gamma Delta", "Alpha Beta Gamma Delta Epsilon")).toBe(true);
    expect(namesMatch("Alpha Beta", "Alpha Zulu Yankee Xray")).toBe(false);
    expect(namesMatch("Alpha Beta Gamma", "Alpha Zulu Yankee Xray")).toBe(false);
  });

  it("never matches names with no distinctive words", () => {
    expect(namesMatch("Viewpoint", "Scenic Overlook")).toBe(false);
    expect(namesMatch("Peak", "Peak")).toBe(false);
    expect(nameScore("Scenic Vista", "Griffith Observatory")).toBe(0);
  });

  it("ignores file numbering and extensions when scoring file names", () => {
    expect(namesMatch("Griffith Observatory", fileTitleToName("File:Griffith Observatory 2010 4 - panoramio.jpg"))).toBe(true);
    expect(fileTitleToName("File:Half Dome (Unsplash).jpg")).toBe("Half Dome (Unsplash)");
  });
});
