// @vitest-environment jsdom
/**
 * The theme's icon size (`--icon-scale`) reaches SITE icons only: they wear `xt-ico`,
 * the admin panel's never do, and a caller's own class is kept beside it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { faStar } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "./Icon";
import { IconScope } from "../lib/iconScope";

afterEach(cleanup);

describe("icon size", () => {
  it("marks a site icon for the theme's icon size, keeping the caller's class", () => {
    const { container } = render(<FontAwesomeIcon icon={faStar} className="mine" />);
    const svg = container.querySelector("svg")!;
    expect(svg.classList.contains("xt-ico")).toBe(true);
    expect(svg.classList.contains("mine")).toBe(true);
  });

  it("leaves admin-panel icons alone", () => {
    const { container } = render(<IconScope value="acp"><FontAwesomeIcon icon={faStar} /></IconScope>);
    expect(container.querySelector("svg")!.classList.contains("xt-ico")).toBe(false);
  });
});
