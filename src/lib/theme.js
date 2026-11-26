/** Day/night theme: OS default, persisted manual override, shared face classes. */
import { get, writable } from 'svelte/store';

const THEME_KEY = 'byom:theme';

export const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
};

export function isTheme(value) {
  return value === THEMES.LIGHT || value === THEMES.DARK;
}

export function resolveTheme(stored, prefersDark) {
  if (isTheme(stored)) return stored;
  return prefersDark ? THEMES.DARK : THEMES.LIGHT;
}

export function nextTheme(theme) {
  return theme === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK;
}

function readStored() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function systemPrefersDark() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function apply(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.remove('face--barbuz', 'face--leo');
  root.classList.add(theme === THEMES.DARK ? 'face--barbuz' : 'face--leo');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', theme === THEMES.DARK ? '#0a0e17' : '#faf8f3');
  }
}

function persist(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable */
  }
}

const state = writable(resolveTheme(readStored(), systemPrefersDark()));
let initialized = false;

export const theme = {
  subscribe: state.subscribe,
  init() {
    if (initialized) return;
    initialized = true;
    const current = resolveTheme(readStored(), systemPrefersDark());
    state.set(current);
    apply(current);

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      media.addEventListener?.('change', (event) => {
        if (readStored()) return;
        const next = event.matches ? THEMES.DARK : THEMES.LIGHT;
        state.set(next);
        apply(next);
      });
    }
  },
  set(value) {
    if (!isTheme(value)) return;
    state.set(value);
    apply(value);
    persist(value);
  },
  toggle() {
    this.set(nextTheme(get(state)));
  },
};
