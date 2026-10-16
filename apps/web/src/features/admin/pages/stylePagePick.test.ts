/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { pickOnPage } from "./stylePagePick";

function page(html: string) {
  document.body.innerHTML = html;
  return (sel: string) => document.querySelector(sel)!;
}

describe("click-to-style on a real page", () => {
  it("a button in the footer is the Button, scoped to the footer", () => {
    const q = page(`<footer class="xt-foot"><div><button class="btn-primary"><span id="t">Go</span></button></div></footer>`);
    expect(pickOnPage(q("#t"))).toEqual(["button", "footer"]);
  });

  it("the nearest scope wins: a card inside an accent section inside main", () => {
    const q = page(`<main class="app-main"><div class="xt-v--accent"><div class="xt-card"><p id="p">x</p></div></div></main>`);
    expect(pickOnPage(q("#p"))).toEqual(["card", "variant.accent"]);
  });

  it("bare region space selects the region itself", () => {
    const q = page(`<main class="app-main"><p id="p">x</p></main>`);
    expect(pickOnPage(q("#p"))).toEqual(["content", "global"]);
  });

  it("a variant with nothing more specific picks Card in that variant", () => {
    const q = page(`<div class="xt-v--muted"><p id="p">x</p></div>`);
    expect(pickOnPage(q("#p"))).toEqual(["card", "variant.muted"]);
  });

  it("the header dropdown is the Menu and the pill is the User menu, both global", () => {
    const q = page(`<nav class="pub-nav"><div class="xt-header__actions"><span id="pill">me</span><div class="xt-pop"><a id="item">Settings</a></div></div></nav>`);
    expect(pickOnPage(q("#item"))).toEqual(["menu", "global"]);
    expect(pickOnPage(q("#pill"))).toEqual(["usermenu", "global"]);
  });

  it("the search box inside the pill is a Field, not the User menu", () => {
    const q = page(`<nav class="pub-nav"><div class="xt-header__actions"><input id="s" /></div></nav>`);
    expect(pickOnPage(q("#s"))).toEqual(["field", "navbar"]);
  });

  it("a field is a Field in its region", () => {
    const q = page(`<nav class="pub-nav"><input id="s" /></nav>`);
    expect(pickOnPage(q("#s"))).toEqual(["field", "navbar"]);
  });

  it("outside every scope: the palette", () => {
    const q = page(`<div><p id="p">x</p></div>`);
    expect(pickOnPage(q("#p"))).toEqual(["palette", "global"]);
  });
});
