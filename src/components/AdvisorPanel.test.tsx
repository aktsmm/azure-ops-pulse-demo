import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdvisorPanel } from "./AdvisorPanel";
afterEach(cleanup);

describe("Advisor panel", () => {
  it("distinguishes missing data from zero recommendations", () => {
    render(<AdvisorPanel />);
    expect(screen.getByText("Advisor の推奨事項は未収集です")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("0 件");
  });
  it("defaults to security and allows inspection of all categories", () => {
    render(<AdvisorPanel availability="available" recommendations={[
      { category: "Security", impact: "High", count: 4 },
      { category: "Cost", impact: "Low", count: 7 }
    ]} />);
    expect(screen.getByText("11 件")).toBeInTheDocument();
    expect(document.querySelectorAll(".recommendation-row")).toHaveLength(1);
    expect(screen.getByText("該当する推奨事項 4 件")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Advisor カテゴリ" }), { target: { value: "all" } });
    expect(document.querySelectorAll(".recommendation-row")).toHaveLength(2);
  });
  it("labels partial zero results without claiming a secure estate", () => {
    render(<AdvisorPanel availability="partial" recommendations={[{ category: "Cost", impact: "High", count: 2 }]} />);
    expect(screen.getByText("一部収集")).toBeInTheDocument();
    expect(screen.getByText(/安全性の保証ではなく/)).toBeInTheDocument();
  });
});
