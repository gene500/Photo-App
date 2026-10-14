// @vitest-environment jsdom
import { renderToString } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMounted } from "./use-mounted";

function Probe() {
  return <p data-testid="m">{useMounted() ? "client" : "server"}</p>;
}

describe("useMounted", () => {
  it("is false when rendered on the server", () => {
    expect(renderToString(<Probe />)).toContain("server");
  });
  it("is true on the client", () => {
    render(<Probe />);
    expect(screen.getByTestId("m").textContent).toBe("client");
  });
});
