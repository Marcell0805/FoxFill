/**
 * FoxFill UI prefs (local only) — theme, page button, etc.
 */
(function initFoxFillPrefs(global) {
  const KEY = "foxfillPrefs";
  const DEFAULTS = { darkMode: false, pageButton: false };
  const PAGE_ORIGINS = ["http://*/*", "https://*/*"];

  async function loadPrefs() {
    try {
      const bag = await chrome.storage.local.get(KEY);
      const raw = bag[KEY];
      if (!raw || typeof raw !== "object") return { ...DEFAULTS };
      return {
        darkMode: Boolean(raw.darkMode),
        pageButton: Boolean(raw.pageButton),
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
    next.pageButton = Boolean(next.pageButton);
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  }

  function applyTheme(darkMode, doc = document) {
    const on = Boolean(darkMode);
    doc.documentElement.dataset.theme = on ? "dark" : "light";
    doc.body?.classList.toggle("theme-dark", on);
  }

  async function requestPageAccess() {
    // Prefer already-granted host_permissions (local/unpacked). Optional request
    // is a fallback for builds that only declare optional_host_permissions.
    if (await hasPageAccess()) return true;
    try {
      return await chrome.permissions.request({ origins: PAGE_ORIGINS });
    } catch (err) {
      // Older/stricter Chrome builds may reject wildcard optional requests.
      try {
        return await chrome.permissions.request({ origins: ["<all_urls>"] });
      } catch {
        throw err;
      }
    }
  }

  async function hasPageAccess() {
    try {
      if (await chrome.permissions.contains({ origins: PAGE_ORIGINS })) return true;
      return await chrome.permissions.contains({ origins: ["<all_urls>"] });
    } catch {
      return false;
    }
  }

  async function dropPageAccess() {
    // Don't remove required host_permissions — only optional grants.
    try {
      await chrome.permissions.remove({ origins: ["<all_urls>"] });
    } catch {
      // ignore
    }
  }

  async function setPageButtonEnabled(enabled) {
    try {
      if (enabled) {
        const granted = await requestPageAccess();
        if (!granted) {
          await savePrefs({ pageButton: false });
          return {
            ok: false,
            enabled: false,
            error: "Site access was not granted.",
          };
        }
        await savePrefs({ pageButton: true });
        try {
          await chrome.runtime.sendMessage({ type: "FOXFILL_SYNC_PAGE_BUTTON" });
        } catch {
          // SW may still pick up storage change
        }
        return { ok: true, enabled: true };
      }

      await savePrefs({ pageButton: false });
      await dropPageAccess();
      try {
        await chrome.runtime.sendMessage({ type: "FOXFILL_SYNC_PAGE_BUTTON" });
      } catch {
        // ignore
      }
      return { ok: true, enabled: false };
    } catch (err) {
      await savePrefs({ pageButton: false });
      return {
        ok: false,
        enabled: false,
        error:
          err?.message ||
          "Couldn’t request site access. Reload the extension on chrome://extensions and try again.",
      };
    }
  }

  global.FoxFillPrefs = {
    KEY,
    DEFAULTS,
    PAGE_ORIGINS,
    loadPrefs,
    savePrefs,
    applyTheme,
    requestPageAccess,
    hasPageAccess,
    dropPageAccess,
    setPageButtonEnabled,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
