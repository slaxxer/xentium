import { describe, expect, it } from 'vitest';
import {
  blockNodeSchema,
  collectAssetRefs,
  edgeArtSchema,
  inSeason,
  rewriteAssetRefs,
  validateBlockTree,
  type BlockNode,
} from './layout.js';

const at = (md: string) => new Date(`2026-${md}T12:00:00`);

describe('edge art', () => {
  it('fills the defaults an editor would otherwise have to write', () => {
    const e = edgeArtSchema.parse({ shape: 'drips' });
    expect(e).toMatchObject({ direction: 'out', height: 32, mirror: false, colors: ['var(--c-accent)'] });
    expect(e.season).toBeUndefined();
  });

  it('refuses what could escape the style it is drawn with, or run off the page', () => {
    expect(edgeArtSchema.safeParse({ shape: 'wave', colors: ['red;background:url(x)'] }).success).toBe(false);
    expect(edgeArtSchema.safeParse({ shape: 'wave', colors: ['#000', '#111', '#222'] }).success).toBe(false);
    expect(edgeArtSchema.safeParse({ shape: 'wave', height: 500 }).success).toBe(false);
    expect(edgeArtSchema.safeParse({ shape: 'wave', season: { from: '13-01', to: '01-01' } }).success).toBe(false);
  });

  it('is in season between its dates every year, across the new year too', () => {
    const halloween = { from: '10-01', to: '11-01' };
    expect(inSeason(halloween, at('10-31'))).toBe(true);
    expect(inSeason(halloween, at('11-01'))).toBe(true);
    expect(inSeason(halloween, at('11-02'))).toBe(false);
    const winter = { from: '12-20', to: '01-06' };
    expect(inSeason(winter, at('12-31'))).toBe(true);
    expect(inSeason(winter, at('01-03'))).toBe(true);
    expect(inSeason(winter, at('02-01'))).toBe(false);
    expect(inSeason(undefined, at('06-01'))).toBe(true);
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
