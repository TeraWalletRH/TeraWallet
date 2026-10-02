import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ThemeManager,
  getStoredTheme,
  setStoredTheme,
  getEffectiveTheme,
  THEME_STORAGE_KEY,
} from '../../public/tera/wallet/theme.js';

// Mock localStorage for Node test environment
class MockLocalStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

// Mock MediaQueryList for system theme changes
class MockMediaQueryList {
  constructor(matches = false) {
    this.matches = matches;
    this.listeners = new Set();
  }
  addEventListener(event, listener) {
    if (event === 'change') this.listeners.add(listener);
  }
  removeEventListener(event, listener) {
    if (event === 'change') this.listeners.delete(listener);
  }
  dispatch(matches) {
    this.matches = matches;
    const event = { matches };
    for (const l of this.listeners) l(event);
  }
}

test('Theme calculation logic', async (t) => {
  await t.test('getEffectiveTheme returns system preference when setting is system', () => {
    assert.equal(getEffectiveTheme('system', true), 'dark');
    assert.equal(getEffectiveTheme('system', false), 'light');
  });

  await t.test('getEffectiveTheme respects explicit light/dark overrides', () => {
    assert.equal(getEffectiveTheme('dark', false), 'dark');
    assert.equal(getEffectiveTheme('light', true), 'light');
  });
});

test('ThemeManager storage persistence', async (t) => {
  globalThis.localStorage = new MockLocalStorage();

  await t.test('defaults to system when no value stored', () => {
    assert.equal(getStoredTheme(), 'system');
  });

  await t.test('persists explicit theme setting', () => {
    setStoredTheme('dark');
    assert.equal(getStoredTheme(), 'dark');
    setStoredTheme('light');
    assert.equal(getStoredTheme(), 'light');
    setStoredTheme('system');
    assert.equal(getStoredTheme(), 'system');
  });
});

test('ThemeManager live event listening and DOM updates', async (t) => {
  globalThis.localStorage = new MockLocalStorage();
  const mockMedia = new MockMediaQueryList(false);

  // Mock document element class list
  const classList = new Set();
  const attributes = new Map();
  const mockDoc = {
    documentElement: {
      classList: {
        add: (c) => classList.add(c),
        remove: (c) => classList.delete(c),
        contains: (c) => classList.has(c),
      },
      setAttribute: (k, v) => attributes.set(k, v),
    },
  };

  const manager = new ThemeManager({ mediaQuery: mockMedia });

  await t.test('initial effective theme is light when system is light', () => {
    assert.equal(manager.getEffective(), 'light');
    manager.applyToDocument(mockDoc);
    assert.equal(classList.has('dark'), false);
    assert.equal(attributes.get('data-theme'), 'light');
  });

  await t.test('notifies subscribers on live system change when setting is system', () => {
    let notifiedEffective = null;
    manager.subscribe((effective) => {
      notifiedEffective = effective;
    });

    mockMedia.dispatch(true); // OS switched to Dark
    assert.equal(notifiedEffective, 'dark');
    assert.equal(manager.getEffective(), 'dark');

    manager.applyToDocument(mockDoc);
    assert.equal(classList.has('dark'), true);
    assert.equal(attributes.get('data-theme'), 'dark');
  });

  await t.test('overrides system preference when explicit dark is set', () => {
    manager.setSetting('dark');
    assert.equal(manager.getEffective(), 'dark');
    assert.equal(localStorage.getItem(THEME_STORAGE_KEY), 'dark');

    mockMedia.dispatch(false); // OS switched to Light
    assert.equal(manager.getEffective(), 'dark'); // remains dark
  });

  await t.test('overrides system preference when explicit light is set', () => {
    manager.setSetting('light');
    assert.equal(manager.getEffective(), 'light');
    assert.equal(localStorage.getItem(THEME_STORAGE_KEY), 'light');

    mockMedia.dispatch(true); // OS switched to Dark
    assert.equal(manager.getEffective(), 'light'); // remains light
  });

  manager.destroy();
});
