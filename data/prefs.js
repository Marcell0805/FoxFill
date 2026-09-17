/**
 * FoxFill UI prefs (local only) — theme, etc.
 */
(function initFoxFillPrefs(global) {
  const KEY = "foxfillPrefs";
  const DEFAULTS = { darkMode: false };

  async function loadPrefs() {
    try {
      const bag = await chrome.storage.local.get(KEY);
      const raw = bag[KEY];
      if (!raw || typeof raw !== "object") return { ...DEFAULTS };
      return {
        darkMode: Boolean(raw.darkMode),
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  async function savePrefs(partial) {
    const current = await loadPrefs();
    const next = {
      ...current,
      ...(partial && typeof partial === "object" ? partial : {}),
    };
    next.darkMode = Boolean(next.darkMode);
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  }

  function applyTheme(darkMode, doc = document) {
    const on = Boolean(darkMode);
    doc.documentElement.dataset.theme = on ? "dark" : "light";
    doc.body?.classList.toggle("theme-dark", on);
  }

  global.FoxFillPrefs = {
    KEY,
    DEFAULTS,
    loadPrefs,
    savePrefs,
    applyTheme,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
