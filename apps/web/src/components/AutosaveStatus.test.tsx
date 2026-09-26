// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AutosaveStatus, SaveChipHost } from "./AutosaveStatus";
import { useAnySaving } from "../hooks/useAutosave";

function PageChip() {
  return <span data-testid="page">{useAnySaving() ? "saving" : "saved"}</span>;
}

describe("AutosaveStatus", () => {
  it("draws its own chip on a page that has none", () => {
    const { container } = render(<AutosaveStatus saving={false} />);
    expect(container.querySelector(".savechip")).not.toBeNull();
  });

  it("inside a host, draws nothing and reports to the page's chip instead", () => {
    const { container, getByTestId, rerender } = render(
      <><PageChip /><SaveChipHost><AutosaveStatus saving={true} /></SaveChipHost></>,
    );
    expect(container.querySelector(".savechip")).toBeNull();
    expect(getByTestId("page").textContent).toBe("saving");
    rerender(<><PageChip /><SaveChipHost><AutosaveStatus saving={false} /></SaveChipHost></>);
    expect(getByTestId("page").textContent).toBe("saved");
  });
});
