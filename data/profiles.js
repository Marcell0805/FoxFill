/**
 * FoxFill multi-profile store (local only).
 * Migrates legacy flat `foxfillProfile` into named profiles.
 */
(function initFoxFillProfiles(global) {
  const LEGACY_KEY = "foxfillProfile";
  const STORE_KEY = "foxfillStore";
  const STORE_VERSION = 1;

  function uid() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function emptyData(keys) {
    return Object.fromEntries((keys || []).map((key) => [key, ""]));
  }

  function normalizeData(raw, keys) {
    const base = emptyData(keys);
    if (!raw || typeof raw !== "object") return base;
    for (const key of keys) {
      if (raw[key] != null) base[key] = String(raw[key]);
    }
    return base;
  }

  function createProfile(name, data, keys) {
    const now = new Date().toISOString();
    return {
      id: uid(),
      name: String(name || "Personal").trim() || "Personal",
      createdAt: now,
      updatedAt: now,
      data: normalizeData(data, keys),
    };
  }

  function defaultStore(keys) {
    const profile = createProfile("Personal", emptyData(keys), keys);
    return {
      version: STORE_VERSION,
      activeProfileId: profile.id,
      profiles: { [profile.id]: profile },
    };
  }

  function listProfiles(store) {
    return Object.values(store.profiles || {}).sort((a, b) =>
      String(a.name).localeCompare(String(b.name))
    );
  }

  function getActive(store) {
    if (!store) return null;
    const id = store.activeProfileId;
    return store.profiles?.[id] || listProfiles(store)[0] || null;
  }

  async function readRaw() {
    const bag = await chrome.storage.local.get([STORE_KEY, LEGACY_KEY]);
    return bag;
  }

  async function loadStore(keys) {
    const bag = await readRaw();
    if (bag[STORE_KEY]?.profiles && bag[STORE_KEY].activeProfileId) {
      const store = bag[STORE_KEY];
      // Ensure every profile has normalized data keys
      for (const id of Object.keys(store.profiles)) {
        store.profiles[id].data = normalizeData(store.profiles[id].data, keys);
      }
      if (!store.profiles[store.activeProfileId]) {
        const first = listProfiles(store)[0];
        store.activeProfileId = first ? first.id : null;
      }
      if (!store.activeProfileId) {
        return defaultStore(keys);
      }
      return store;
    }

    // Migrate legacy single profile
    if (bag[LEGACY_KEY] && typeof bag[LEGACY_KEY] === "object") {
      const profile = createProfile("Personal", bag[LEGACY_KEY], keys);
      const store = {
        version: STORE_VERSION,
        activeProfileId: profile.id,
        profiles: { [profile.id]: profile },
      };
      await chrome.storage.local.set({ [STORE_KEY]: store });
      await chrome.storage.local.remove(LEGACY_KEY);
      return store;
    }

    return defaultStore(keys);
  }

  async function saveStore(store) {
    await chrome.storage.local.set({ [STORE_KEY]: store });
  }

  function setActive(store, profileId) {
    if (!store.profiles[profileId]) return store;
    store.activeProfileId = profileId;
    return store;
  }

  function upsertActiveData(store, data, keys) {
    const active = getActive(store);
    if (!active) return store;
    active.data = normalizeData(data, keys);
    active.updatedAt = new Date().toISOString();
    store.profiles[active.id] = active;
    return store;
  }

  function addProfile(store, name, keys, copyFromActive) {
    const source = copyFromActive ? getActive(store)?.data : null;
    const profile = createProfile(name, source || emptyData(keys), keys);
    store.profiles[profile.id] = profile;
    store.activeProfileId = profile.id;
    return profile;
  }

  function renameProfile(store, profileId, name) {
    const p = store.profiles[profileId];
    if (!p) return null;
    p.name = String(name || "").trim() || p.name;
    p.updatedAt = new Date().toISOString();
    return p;
  }

  function deleteProfile(store, profileId, keys) {
    const ids = Object.keys(store.profiles || {});
    if (ids.length <= 1) return { ok: false, reason: "last" };
    if (!store.profiles[profileId]) return { ok: false, reason: "missing" };
    delete store.profiles[profileId];
    if (store.activeProfileId === profileId) {
      store.activeProfileId = listProfiles(store)[0].id;
    }
    return { ok: true, active: getActive(store) };
  }

  global.FoxFillProfiles = {
    LEGACY_KEY,
    STORE_KEY,
    emptyData,
    normalizeData,
    createProfile,
    defaultStore,
    listProfiles,
    getActive,
    loadStore,
    saveStore,
    setActive,
    upsertActiveData,
    addProfile,
    renameProfile,
    deleteProfile,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
