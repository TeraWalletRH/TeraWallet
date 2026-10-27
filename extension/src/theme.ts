// The look: System (follows the computer), Light, Dark or Black (true black,
// for OLED screens). Loaded as a plain script in each page's <head>, before
// anything paints, so a page never flashes the wrong colours. The choice is
// kept in this extension's own localStorage, which every extension page
// shares, and the `storage` event carries a change to the pages already open.
// popup.css holds the colours for each.

export const THEMES = ["system", "light", "dark", "black"] as const;
export type Theme = (typeof THEMES)[number];
const KEY = "tera-theme";

export function currentTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY) as Theme | null;
    return saved && THEMES.includes(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: Theme = currentTheme()) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // No storage: the choice lasts until the page closes.
  }
  applyTheme(theme);
}

applyTheme();
addEventListener("storage", (event) => {
  if (event.key === KEY) applyTheme();
});
