import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import {
  getBrowserStorage,
  parseTheme,
  persistTheme,
  type Theme
} from "../lib/theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(
    () => parseTheme(document.documentElement.getAttribute("data-theme")) ?? "light"
  );
  const nextTheme: Theme = theme === "light" ? "dark" : "light";

  function toggleTheme() {
    document.documentElement.setAttribute("data-theme", nextTheme);
    persistTheme(getBrowserStorage(), nextTheme);
    setTheme(nextTheme);
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={`${nextTheme === "dark" ? "ダーク" : "ライト"}表示に切り替え`}
    >
      {theme === "light" ? (
        <Sun size={17} aria-hidden="true" />
      ) : (
        <Moon size={17} aria-hidden="true" />
      )}
      <span>{theme === "light" ? "ライト" : "ダーク"}</span>
    </button>
  );
}
