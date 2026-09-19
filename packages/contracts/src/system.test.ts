import { describe, expect, it } from 'vitest';
import { SYSTEM_REQUIREMENTS, checkVersion, compareVersions, displayVersion } from './system.js';

describe('compareVersions', () => {
  it('compares numerically, not as strings', () => {
    expect(compareVersions('22.12.0', '22.9.1')).toBe(1);
    expect(compareVersions('9.0.0', '10.0.0')).toBe(-1);
  });

  it('treats a missing patch as zero', () => {
    expect(compareVersions('17.0', '17.0.0')).toBe(0);
    expect(compareVersions('17', '17.0.0')).toBe(0);
  });

  it('reads what node, npm, Postgres and Redis actually report', () => {
    expect(compareVersions('v24.1.0', '22.12.0')).toBe(1);      // process.version
    expect(compareVersions('24.0.0-rc.1', '24.0.0')).toBe(0);   // prerelease tail ignored
    expect(compareVersions('16.4', '14.0')).toBe(1);            // SELECT version() → "16.4"
    expect(compareVersions('7.2.4', '6.0')).toBe(1);            // INFO server
  });
});

describe('checkVersion', () => {
  it('refuses below the minimum', () => {
    // The drift this module exists to stop: the wizard used to accept Node 20.
    expect(checkVersion('20.18.0', SYSTEM_REQUIREMENTS.node)).toBe('fail');
    expect(checkVersion('22.11.0', SYSTEM_REQUIREMENTS.node)).toBe('fail');
  });

  it('warns between the minimum and the recommendation', () => {
    expect(checkVersion('22.12.0', SYSTEM_REQUIREMENTS.node)).toBe('warn');
    expect(checkVersion('14.9', SYSTEM_REQUIREMENTS.postgres)).toBe('warn');
  });

  it('passes at or above the recommendation, and when there is none', () => {
    expect(checkVersion('24.1.0', SYSTEM_REQUIREMENTS.node)).toBe('ok');
    expect(checkVersion('17.2', SYSTEM_REQUIREMENTS.postgres)).toBe('ok');
    expect(checkVersion('7.2.4', SYSTEM_REQUIREMENTS.redis)).toBe('ok');
  });
});

describe('displayVersion', () => {
  it('drops trailing zeros for people', () => {
    expect(displayVersion('22.12.0')).toBe('22.12');
    expect(displayVersion('17.0')).toBe('17');
    expect(displayVersion('6.0')).toBe('6');
  });
});
