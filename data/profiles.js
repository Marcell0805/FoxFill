/**
 * FoxFill multi-profile store (local only).
 * Supports custom fields + optional passphrase encryption at rest.
 */
(function initFoxFillProfiles(global) {
  const LEGACY_KEY = "foxfillProfile";
  const STORE_KEY = "foxfillStore";
  const STORE_VERSION = 2;

  function uid(prefix) {
    const id =
      global.crypto?.randomUUID?.() ||
      `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    return prefix ? `${prefix}_${id}` : id;
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

  function normalizeCustomFields(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const label = String(item.label || "").trim();
        if (!label) return null;
        const aliases = Array.isArray(item.aliases)
          ? item.aliases.map((a) => String(a || "").trim()).filter(Boolean)
          : String(item.aliases || "")
              .split(",")
              .map((a) => a.trim())
              .filter(Boolean);
        return {
          id: String(item.id || uid("cf")),
          label,
          aliases,
          value: String(item.value || ""),
        };
      })
      .filter(Boolean);
  }

  function createProfile(name, data, keys, customFields) {
    const now = new Date().toISOString();
    return {
      id: uid("p"),
      name: String(name || "Personal").trim() || "Personal",
      createdAt: now,
      updatedAt: now,
      data: normalizeData(data, keys),
      customFields: normalizeCustomFields(customFields),
    };
  }

  function defaultStore(keys) {
    const profile = createProfile("Personal", emptyData(keys), keys, []);
    return {
      version: STORE_VERSION,
      encryptionEnabled: false,
      activeProfileId: profile.id,
      profiles: { [profile.id]: profile },
    };
  }

  function normalizeStore(store, keys) {
    if (!store || typeof store !== "object") return defaultStore(keys);
    const next = {
      version: STORE_VERSION,
      encryptionEnabled: Boolean(store.encryptionEnabled),
      activeProfileId: store.activeProfileId || null,
      profiles: {},
    };
    for (const id of Object.keys(store.profiles || {})) {
      const p = store.profiles[id];
      next.profiles[id] = {
        id: p.id || id,
        name: String(p.name || "Personal"),
        createdAt: p.createdAt || new Date().toISOString(),
        updatedAt: p.updatedAt || new Date().toISOString(),
        data: normalizeData(p.data, keys),
        customFields: normalizeCustomFields(p.customFields),
      };
    }
    if (!next.profiles[next.activeProfileId]) {
      const first = listProfiles(next)[0];
      next.activeProfileId = first ? first.id : null;
    }
    if (!next.activeProfileId) return defaultStore(keys);
    return next;
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
    return chrome.storage.local.get([STORE_KEY, LEGACY_KEY]);
  }

  async function peekEncryption() {
    const bag = await readRaw();
    const crypto = global.FoxFillCrypto;
    if (crypto?.isEncryptedEnvelope?.(bag[STORE_KEY])) {
      return { encrypted: true, envelope: bag[STORE_KEY] };
    }
    return { encrypted: false, envelope: null, raw: bag };
  }

  async function loadStore(keys, options) {
    const opts = options || {};
    const bag = await readRaw();
    const crypto = global.FoxFillCrypto;

    if (crypto?.isEncryptedEnvelope?.(bag[STORE_KEY])) {
      if (opts.passphrase) {
        const decrypted = await crypto.decryptStore(
          bag[STORE_KEY],
          opts.passphrase
        );
        const store = normalizeStore(decrypted, keys);
        store.encryptionEnabled = true;
        await crypto.saveSessionUnlocked(store, opts.passphrase);
        return store;
      }
      if (opts.recoveryEmail) {
        const decrypted = await crypto.decryptStoreWithEmail(
          bag[STORE_KEY],
          opts.recoveryEmail
        );
        const store = normalizeStore(decrypted, keys);
        store.encryptionEnabled = true;
        await crypto.saveSessionUnlocked(store, "");
        return store;
      }
      const sessionStore = await crypto.loadSessionUnlocked();
      if (sessionStore) {
        const store = normalizeStore(sessionStore, keys);
        store.encryptionEnabled = true;
        return store;
      }
      const err = new Error("locked");
      err.code = "LOCKED";
      throw err;
    }

    if (bag[STORE_KEY]?.profiles && bag[STORE_KEY].activeProfileId) {
      return normalizeStore(bag[STORE_KEY], keys);
    }

    if (bag[LEGACY_KEY] && typeof bag[LEGACY_KEY] === "object") {
      const profile = createProfile("Personal", bag[LEGACY_KEY], keys, []);
      const store = {
        version: STORE_VERSION,
        encryptionEnabled: false,
        activeProfileId: profile.id,
        profiles: { [profile.id]: profile },
      };
      await chrome.storage.local.set({ [STORE_KEY]: store });
      await chrome.storage.local.remove(LEGACY_KEY);
      return store;
    }

    return defaultStore(keys);
  }

  async function saveStore(store, options) {
    const opts = options || {};
    const crypto = global.FoxFillCrypto;
    const payload = {
      ...store,
      version: STORE_VERSION,
    };

    if (store.encryptionEnabled) {
      const passphrase =
        opts.passphrase ||
        opts.sessionPassphrase ||
        (await crypto.loadSessionPassphrase?.()) ||
        "";
      if (!passphrase) {
        const err = new Error("Passphrase required to save encrypted store");
        err.code = "NEED_PASSPHRASE";
        throw err;
      }
      const bag = await readRaw();
      const previous = crypto.isEncryptedEnvelope?.(bag[STORE_KEY])
        ? bag[STORE_KEY]
        : null;
      const recoveryEmail =
        opts.recoveryEmail ||
        getActive(payload)?.data?.email ||
        "";
      const envelope = await crypto.encryptStore(
        payload,
        passphrase,
        recoveryEmail,
        previous
      );
      await chrome.storage.local.set({ [STORE_KEY]: envelope });
      await crypto.saveSessionUnlocked(payload, passphrase);
      return;
    }

    await chrome.storage.local.set({ [STORE_KEY]: payload });
    if (crypto?.clearSessionUnlocked) await crypto.clearSessionUnlocked();
  }

  function setActive(store, profileId) {
    if (!store.profiles[profileId]) return store;
    store.activeProfileId = profileId;
    return store;
  }

  function upsertActiveData(store, data, keys, customFields) {
    const active = getActive(store);
    if (!active) return store;
    active.data = normalizeData(data, keys);
    if (customFields !== undefined) {
      active.customFields = normalizeCustomFields(customFields);
    }
    active.updatedAt = new Date().toISOString();
    store.profiles[active.id] = active;
    return store;
  }

  function addProfile(store, name, keys, copyFromActive) {
    const source = copyFromActive ? getActive(store) : null;
    const profile = createProfile(
      name,
      source?.data || emptyData(keys),
      keys,
      copyFromActive ? source?.customFields || [] : []
    );
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

  function deleteProfile(store, profileId) {
    const ids = Object.keys(store.profiles || {});
    if (ids.length <= 1) return { ok: false, reason: "last" };
    if (!store.profiles[profileId]) return { ok: false, reason: "missing" };
    delete store.profiles[profileId];
    if (store.activeProfileId === profileId) {
      store.activeProfileId = listProfiles(store)[0].id;
    }
    return { ok: true, active: getActive(store) };
  }

  function customPatternsFromFields(customFields) {
    return normalizeCustomFields(customFields).map((cf) => ({
      key: `custom:${cf.id}`,
      label: cf.label,
      group: "custom",
      custom: true,
      autocomplete: [],
      aliases: Array.from(
        new Set([cf.label, ...(cf.aliases || [])].map((a) => String(a).trim()).filter(Boolean))
      ),
    }));
  }

  global.FoxFillProfiles = {
    LEGACY_KEY,
    STORE_KEY,
    emptyData,
    normalizeData,
    normalizeCustomFields,
    createProfile,
    defaultStore,
    normalizeStore,
    listProfiles,
    getActive,
    peekEncryption,
    loadStore,
    saveStore,
    setActive,
    upsertActiveData,
    addProfile,
    renameProfile,
    deleteProfile,
    customPatternsFromFields,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
