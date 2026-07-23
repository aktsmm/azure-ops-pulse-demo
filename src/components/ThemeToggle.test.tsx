import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.clear();
  });

  it("switches theme accessibly and persists the selection", () => {
    render(<ThemeToggle />);
    const toggle = screen.getByRole("button", { name: "ダーク表示に切り替え" });

    fireEvent.click(toggle);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("button", { name: "ライト表示に切り替え" })).toBeVisible();
    expect(localStorage.getItem("azure-ops-pulse-theme")).toBe("dark");
  });
});
