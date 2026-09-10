import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NetworkEvidence } from "./NetworkEvidence";

afterEach(cleanup);
describe("Structured address display", () => {
  it("renders only the approved structured address fields and keeps public addresses masked", () => {
    render(<NetworkEvidence evidence={{
      privateIpv4: ["10.0.1.4"], privateCidrs: ["10.0.1.0/24"], publicIpv4Masked: ["203.0.*.*"], truncated: true
    }} />);
    expect(screen.getByText("10.0.1.4")).toBeInTheDocument();
    expect(screen.getByText("10.0.1.0/24")).toBeInTheDocument();
    expect(screen.getByText("203.0.*.*")).toBeInTheDocument();
    expect(screen.getByText(/表示は全件ではありません/)).toBeInTheDocument();
    expect(screen.getByText(/通信の許可・疎通・安全性/)).toBeInTheDocument();
  });
  it("distinguishes missing collection from a collected field with no public values", () => {
    const { rerender } = render(<NetworkEvidence />);
    expect(screen.getByText(/アドレス情報は未収集/)).toBeInTheDocument();
    rerender(<NetworkEvidence evidence={{ privateIpv4: [], privateCidrs: [], publicIpv4Masked: [], truncated: false }} />);
    expect(screen.queryByText(/アドレス情報は未収集/)).not.toBeInTheDocument();
    expect(screen.getAllByText("今回の公開値なし")).toHaveLength(3);
  });
});
