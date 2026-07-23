import { describe, expect, it, vi } from "vitest";
import {
  parseTheme,
  persistTheme,
  readSavedTheme,
  resolveInitialTheme,
  THEME_STORAGE_KEY
} from "./theme";

describe("theme preference", () => {
  it("uses explicit query before saved preference", () => {
    const storage = {
      getItem: vi.fn(() => "dark"),
      setItem: vi.fn()
    };

    expect(resolveInitialTheme("?scoutTheme=light", storage)).toBe("light");
  });

  it("uses a valid saved preference and otherwise defaults to light", () => {
    const storage = {
      getItem: vi.fn(() => "dark"),
      setItem: vi.fn()
    };
    expect(resolveInitialTheme("", storage)).toBe("dark");
    storage.getItem.mockReturnValue("sepia");
    expect(resolveInitialTheme("", storage)).toBe("light");
    expect(parseTheme("sepia")).toBeNull();
  });

  it("stays safe when local storage is unavailable", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("blocked");
      })
    };

    expect(readSavedTheme(storage)).toBeNull();
    expect(resolveInitialTheme("", storage)).toBe("light");
    expect(() => persistTheme(storage, "dark")).not.toThrow();
    expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "dark");
  });
});
