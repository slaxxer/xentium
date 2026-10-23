import { describe, expect, it } from 'vitest';
import {
  blockNodeSchema,
  collectAssetRefs,
  edgeArtSchema,
  rewriteAssetRefs,
  validateBlockTree,
  type BlockNode,
} from './layout.js';

describe('edge art', () => {
  it('fills the defaults an editor would otherwise have to write', () => {
    const e = edgeArtSchema.parse({ shape: 'drips' });
    expect(e).toMatchObject({ direction: 'out', height: 32, mirror: false, colors: ['var(--c-accent)'] });
    expect(e.ext).toBeUndefined();
  });

  it('refuses what could escape the style it is drawn with, or run off the page', () => {
    expect(edgeArtSchema.safeParse({ shape: 'wave', colors: ['red;background:url(x)'] }).success).toBe(false);
    expect(edgeArtSchema.safeParse({ shape: 'wave', colors: ['#000', '#111', '#222'] }).success).toBe(false);
    expect(edgeArtSchema.safeParse({ shape: 'wave', height: 500 }).success).toBe(false);
  });

  it("hands an old document's season to the fx namespace, and core keeps none", () => {
    const old = edgeArtSchema.parse({ shape: 'drips', season: { from: '10-01', to: '11-01' }, ext: { fx: { glow: true } } });
    expect(old).not.toHaveProperty('season');
    expect(old.ext).toEqual({ fx: { glow: true, season: { from: '10-01', to: '11-01' } } });
    // Already moved: the plugin's own dates win, the stale copy is dropped.
    const both = edgeArtSchema.parse({ shape: 'drips', season: { from: '01-01', to: '01-02' }, ext: { fx: { season: { from: '12-01', to: '12-31' } } } });
    expect(both.ext).toEqual({ fx: { season: { from: '12-01', to: '12-31' } } });
    expect(edgeArtSchema.parse(old)).toEqual(old);
  });

  it('rides the node, and its image travels with a theme like any asset', () => {
    const node: BlockNode = blockNodeSchema.parse({
      id: 'a', type: 'navbar', props: {},
      edges: { bottom: { shape: 'image', image: 'layouts/drip.png' } },
    });
    const doc = { regions: { header: [node] } };
    expect(collectAssetRefs(doc)).toEqual(['layouts/drip.png']);
    rewriteAssetRefs(doc, (ref) => (ref === 'layouts/drip.png' ? 'assets/drip.png' : undefined));
    expect(doc.regions.header[0]!.edges?.bottom?.image).toBe('assets/drip.png');
  });
});

describe('the composed header', () => {
  it('may hold children now — the logo and the action group', () => {
    const header: BlockNode = {
      id: 'h', type: 'header', props: {},
      children: [{ id: 'l', type: 'logo', props: {} }, { id: 'u', type: 'userMenu', props: {} }],
    };
    expect(validateBlockTree({ header: [header] })).toEqual([]);
  });
});
