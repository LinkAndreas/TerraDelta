"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { I18nContext, translate, type Lang } from "@/lib/i18n";
import { ThemeContext, type Theme } from "@/lib/theme";

const LANG_STORE = "orthophoto-diff:lang";
const THEME_STORE = "orthophoto-diff:theme";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("de");
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const sl = localStorage.getItem(LANG_STORE);
    if (sl === "en" || sl === "de") setLangState(sl);
    const st = localStorage.getItem(THEME_STORE);
    if (st === "dark" || st === "light") setThemeState(st);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("lang", lang);
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem(LANG_STORE, l);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem(THEME_STORE, t);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((cur) => {
      const next = cur === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_STORE, next);
      return next;
    });
  }, []);

  const i18n = useMemo(
    () => ({ lang, setLang, t: (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate(lang, key, vars) }),
    [lang, setLang],
  );

  const themeCtx = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);

  return (
    <I18nContext.Provider value={i18n}>
      <ThemeContext.Provider value={themeCtx}>{children}</ThemeContext.Provider>
    </I18nContext.Provider>
  );
}
