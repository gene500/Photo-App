import { describe, expect, it } from "vitest";
import alertsFixture from "../../tests/fixtures/nps-alerts.json";
import parksFixture from "../../tests/fixtures/nps-parks.json";
import { classifyAlert, nearestPark, parseNpsAlerts, parseNpsParks, shortText } from "./nps-alerts";

describe("NPS parsing", () => {
  it("keeps only parks with a code, a name and real coordinates", () => {
    const parks = parseNpsParks(parksFixture);
    expect(parks.map((p) => p.parkCode)).toEqual(["yose", "seki"]);
    expect(parks[0]!.lat).toBeCloseTo(37.8488);
    expect(parseNpsParks(null)).toEqual([]);
    expect(parseNpsParks({ data: "x" })).toEqual([]);
  });
  it("keeps alerts with a title and park code", () => {
    expect(parseNpsAlerts(alertsFixture)).toHaveLength(5);
    expect(parseNpsAlerts({})).toEqual([]);
  });
  it("finds the nearest park only within the radius", () => {
    const parks = parseNpsParks(parksFixture);
    expect(nearestPark(parks, 37.91, -119.26)?.parkCode).toBe("yose");
    expect(nearestPark(parks, 40, -100)).toBeNull();
  });
});

describe("classifyAlert", () => {
  const alerts = parseNpsAlerts(alertsFixture);
  it("reports park closures, road or trail closure wording in cautions, and ignores the rest", () => {
    expect(alerts.map(classifyAlert)).toEqual(["closed", "alert", null, null, "alert"]);
  });
  it("does not treat a closure-worded title with an unrelated category as an alert", () => {
    expect(classifyAlert({ parkCode: "x", title: "Road closed", category: "Other" })).toBeNull();
  });
  it("shortens long text", () => {
    expect(shortText("a".repeat(300)).length).toBe(110);
  });
});
