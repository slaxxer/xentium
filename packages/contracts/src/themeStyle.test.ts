import { describe, expect, it } from 'vitest';
import { CORNER_PRESETS, GLOW_PRESETS, cornerModeOf, patchFor, themeManifestSchema, wears } from './index.js';

describe('theme style', () => {
  it('reads an untouched site as rounded, glow off', () => {
    expect(cornerModeOf({})).toBe('rounded');
    expect(wears(GLOW_PRESETS.off, {})).toBe(true);
  });

  it('recognises each corner mode from its tokens', () => {
    expect(cornerModeOf({ ...CORNER_PRESETS.chamfered })).toBe('chamfered');
    expect(cornerModeOf({ ...CORNER_PRESETS.sharp })).toBe('sharp');
    expect(cornerModeOf({ '--radius-lg': '4px' })).toBeNull();
  });

  it('clears rather than freezes a value the theme already ships', () => {
    const shipped = { ...CORNER_PRESETS.chamfered };
    expect(Object.values(patchFor(CORNER_PRESETS.chamfered, shipped)).every((v) => v === null)).toBe(true);
    // Rounded over a chamfered theme must be WRITTEN, or the theme's cut shows through.
    expect(patchFor(CORNER_PRESETS.rounded, shipped)['--clip-card']).toBe('none');
    // Rounded on Core is the stock look: nothing to write.
    expect(Object.values(patchFor(CORNER_PRESETS.rounded, {})).every((v) => v === null)).toBe(true);
  });

  it('accepts colourways in a theme manifest', () => {
    const m = themeManifestSchema.parse({
      id: 'respawn', name: 'Respawn', version: '1.0.0', vendor: 'Xentium', minXentiumVersion: '1.0',
      colourways: [{ id: 'toxin', name: 'Toxin', tokens: { '--c-accent': '#3be38a' } }],
    });
    expect(m.colourways?.[0]?.name).toBe('Toxin');
    expect(() => themeManifestSchema.parse({ ...m, colourways: [{ id: 'x', name: 'X', tokens: { '--a': 'red;}' } }] })).toThrow();
  });
});
