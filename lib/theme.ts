"use client";

import { createContext, useContext } from "react";

export type Theme = "dark" | "light";

export interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const ThemeContext = createContext<ThemeCtx>({
  theme: "dark",
  setTheme: () => {},
  toggle: () => {},
});

export const useTheme = () => useContext(ThemeContext);
