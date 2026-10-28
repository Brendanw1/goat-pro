/** Player hand-off: a plain click shows the card, the profile's PlayerReady hides it; modified clicks never show it. */
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { displayName, PlayerLink, PlayerReady, PlayerTransitionOverlay } from "@/components/ui/player-transition";

const info = { name: "Rodriguez, Blaze", team: "LOU_CAJ", teamName: "Louisiana", pos: "SS" };
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("player hand-off", () => {
  it("shows on a plain click and leaves after the profile mounts", async () => {
    render(<><PlayerTransitionOverlay /><PlayerLink href="/player/1" info={info}>go</PlayerLink></>);
    fireEvent.click(screen.getByText("go"), { button: 0 });
    expect(screen.getByTestId("player-transition").textContent).toContain("Blaze Rodriguez");
    expect(screen.getByTestId("player-transition").textContent).toContain("Louisiana");
    render(<PlayerReady />);
    await wait(450);
    expect(screen.queryByTestId("player-transition")).toBeNull();
  });
  it("leaves quickly when the profile is ready fast (no hold, short fade)", async () => {
    render(<><PlayerTransitionOverlay /><PlayerLink href="/player/1" info={info}>go</PlayerLink></>);
    fireEvent.click(screen.getByText("go"), { button: 0 });
    render(<PlayerReady />);
    await wait(150);                                                              // 0 hold + 110 fade
    expect(screen.queryByTestId("player-transition")).toBeNull();
  });
  it("stays out of the way of a cmd-click (new tab)", () => {
    render(<><PlayerTransitionOverlay /><PlayerLink href="/player/1" info={info}>go</PlayerLink></>);
    fireEvent.click(screen.getByText("go"), { button: 0, metaKey: true });
    expect(screen.queryByTestId("player-transition")).toBeNull();
  });
  it("flips Last, First", () => {
    expect(displayName("Rodriguez, Blaze")).toBe("Blaze Rodriguez");
    expect(displayName("Kolby Branch")).toBe("Kolby Branch");
  });
});
