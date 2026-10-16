import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_FRAME,
  SITE_FRAME_ROW_KEY,
  frameBackgroundCss,
  frameModeFor,
  parseSiteFrame,
  siteFrameSchema,
} from './siteFrame.js';
import { templateKeySchema } from './layout.js';

describe('site frame', () => {
  it('defaults to full width — the core look; frame modes are for themes and admins', () => {
    expect(DEFAULT_SITE_FRAME.mode).toBe('full');
    expect(DEFAULT_SITE_FRAME.overrides).toEqual({});
  });

  it('parses to the same JSON whatever order the keys arrived in', () => {
    // Pending status is a stringify; a frame read back from jsonb must not differ.
    const a = parseSiteFrame({ radius: 4, mode: 'boxed' });
    const b = parseSiteFrame({ mode: 'boxed', radius: 4 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('falls back to the default for something that is not a frame', () => {
    expect(parseSiteFrame({ mode: 'sideways' })).toEqual(DEFAULT_SITE_FRAME);
    expect(parseSiteFrame(null)).toEqual(DEFAULT_SITE_FRAME);
  });

  it('drops an override for a page that no longer exists instead of resetting the frame', () => {
    // `page.detail` went with custom pages. One stale key used to fail the whole
    // record and quietly put every setting back to its default.
    const frame = parseSiteFrame({ mode: 'boxed', overrides: { 'page.detail': 'flush', home: 'framed' } });
    expect(frame.mode).toBe('boxed');
    expect(frame.overrides).toEqual({ home: 'framed' });
  });

  it('a page override wins; everything else wears the site default', () => {
    const f = siteFrameSchema.parse({ mode: 'boxed', overrides: { home: 'overlap' } });
    expect(frameModeFor(f, 'home')).toBe('overlap');
    expect(frameModeFor(f, 'members')).toBe('boxed');
    expect(frameModeFor(f, 'forum.index')).toBe('boxed');
    expect(frameModeFor(f, null)).toBe('boxed');
  });

  it('refuses a colour that could escape the gradient', () => {
    expect(siteFrameSchema.safeParse({ background: { color: 'red;background:url(x)' } }).success).toBe(false);
    expect(siteFrameSchema.safeParse({ background: { stops: ['#000', 'var(--c-accent)'] } }).success).toBe(true);
  });

  it('builds the background: flat, linear, radial, and an image over the gradient', () => {
    // Flat, from the palette.
    expect(frameBackgroundCss(DEFAULT_SITE_FRAME.background)).toBe('linear-gradient(var(--c-bg-hover), var(--c-bg-hover))');
    const bg = { ...DEFAULT_SITE_FRAME.background, type: 'gradient' as const, stops: ['#14162a', '#5865f2'], angle: 150 };
    expect(frameBackgroundCss({ ...bg, type: 'color', color: '#123' })).toBe('linear-gradient(#123, #123)');
    expect(frameBackgroundCss(bg)).toBe('linear-gradient(150deg, #14162a 0%, #5865f2 100%)');
    expect(frameBackgroundCss({ ...bg, radial: true, stops: ['#a', '#b', '#c'] as string[] }))
      .toBe('radial-gradient(circle at center, #a 0%, #b 50%, #c 100%)');
    expect(frameBackgroundCss({ ...bg, type: 'image' }, '/uploads/a "b".png'))
      .toBe('url("/uploads/a \\"b\\".png"), linear-gradient(150deg, #14162a 0%, #5865f2 100%)');
  });

  it('is stored under a key no template can ever have', () => {
    expect(templateKeySchema.safeParse(SITE_FRAME_ROW_KEY).success).toBe(false);
  });
});
