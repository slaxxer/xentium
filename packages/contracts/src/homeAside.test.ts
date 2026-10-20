/**
 * Home is LEFT · FEED · RIGHT. Its old `aside` region rendered as a fourth rail beside
 * the three columns; anything in it now joins the right rail.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUTS, foldHomeAside, parseLayoutDocument, regionsFor, type BlockNode, type LayoutDocument } from './layout.js';

const shout: BlockNode = { id: 'sb', type: 'shoutbox.box', props: {} };
const withAside = (aside: BlockNode[]): LayoutDocument => ({
  ...DEFAULT_LAYOUTS.home,
  regions: { ...DEFAULT_LAYOUTS.home.regions, aside },
});
const rail = (doc: LayoutDocument) =>
  doc.regions.main!.find((n) => n.type === 'columns')!.children!.at(-1)!;

describe('home has three columns and no aside', () => {
  it('declares only main', () => {
    expect(regionsFor('home')).toEqual(['main']);
    expect(Object.keys(DEFAULT_LAYOUTS.home.regions)).toEqual(['main']);
  });

  it('moves aside blocks to the end of the right rail, unchanged', () => {
    const out = foldHomeAside(withAside([shout]));
    expect(out.regions.aside).toBeUndefined();
    expect(rail(out).id).toBe('h-rightcol');
    expect(rail(out).children!.at(-1)).toEqual(shout);
    // The rail's own blocks are still there, in order, before it.
    expect(rail(out).children!.slice(0, -1)).toEqual(rail(DEFAULT_LAYOUTS.home).children);
  });

  it('drops an empty aside and leaves a document without one alone', () => {
    expect(foldHomeAside(withAside([])).regions).toEqual({ main: DEFAULT_LAYOUTS.home.regions.main });
    const plain = { ...DEFAULT_LAYOUTS.home };
    expect(foldHomeAside(plain)).toBe(plain);
  });

  it('falls back to the end of main when there is no columns block', () => {
    const doc: LayoutDocument = { ...DEFAULT_LAYOUTS.home, regions: { main: [{ id: 'f', type: 'homeFeed', props: {} }], aside: [shout] } };
    expect(foldHomeAside(doc).regions).toEqual({ main: [{ id: 'f', type: 'homeFeed', props: {} }, shout] });
  });

  it('only touches home', () => {
    const other = { ...DEFAULT_LAYOUTS['article.index'] };
    expect(foldHomeAside(other)).toBe(other);
  });

  it('is applied when a stored document is parsed', () => {
    const { document, usedDefault } = parseLayoutDocument('home', withAside([shout]));
    expect(usedDefault).toBe(false);
    expect(document.regions.aside).toBeUndefined();
    expect(rail(document).children!.at(-1)!.id).toBe('sb');
  });
});
