import { describe, expect, it } from 'vitest';
import { THEMES, isTheme, nextTheme, resolveTheme } from './theme.js';

describe('theme resolution', () => {
  it('accepts only the two theme names', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('system')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  it('lets an explicit choice outrank the system preference', () => {
    expect(resolveTheme('light', true)).toBe(THEMES.LIGHT);
    expect(resolveTheme('dark', false)).toBe(THEMES.DARK);
  });

  it('follows the system preference without a saved choice', () => {
    expect(resolveTheme(null, true)).toBe(THEMES.DARK);
    expect(resolveTheme(null, false)).toBe(THEMES.LIGHT);
  });

  it('toggles in both directions', () => {
    expect(nextTheme(THEMES.LIGHT)).toBe(THEMES.DARK);
    expect(nextTheme(THEMES.DARK)).toBe(THEMES.LIGHT);
  });
});
