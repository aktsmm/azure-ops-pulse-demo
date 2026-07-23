export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "azure-ops-pulse-theme";

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export function parseTheme(value: string | null | undefined): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

export function readSavedTheme(storage: ThemeStorage | null): Theme | null {
  if (!storage) return null;
  try {
    return parseTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function resolveInitialTheme(search: string, storage: ThemeStorage | null): Theme {
  const explicit = parseTheme(new URLSearchParams(search).get("scoutTheme"));
  return explicit ?? readSavedTheme(storage) ?? "light";
}

export function persistTheme(storage: ThemeStorage | null, theme: Theme): void {
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The applied theme still works when storage is blocked or full.
  }
}

export function getBrowserStorage(): ThemeStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
