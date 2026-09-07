/**
 * FoxFill full settings page (local only).
 */
(function initOptionsPage() {
  const PROFILE_KEYS = [
    "title",
    "firstName",
    "lastName",
    "idNumber",
    "passportNumber",
    "email",
    "phone",
    "dateOfBirth",
    "residenceType",
    "addressLine1",
    "addressLine2",
    "suburb",
    "city",
    "province",
    "postalCode",
    "country",
  ];

  const personalForm = document.getElementById("personalForm");
  const addressForm = document.getElementById("addressForm");
  const profileSelect = document.getElementById("profileSelect");
  const profileNewBtn = document.getElementById("profileNewBtn");
  const profileRenameBtn = document.getElementById("profileRenameBtn");
  const profileDeleteBtn = document.getElementById("profileDeleteBtn");
  const customFieldList = document.getElementById("customFieldList");
  const customFieldForm = document.getElementById("customFieldForm");
  const saveAllBtn = document.getElementById("saveAllBtn");
  const saveStatus = document.getElementById("saveStatus");
  const unlockGate = document.getElementById("unlockGate");
  const unlockPassphrase = document.getElementById("unlockPassphrase");
  const unlockBtn = document.getElementById("unlockBtn");
  const unlockError = document.getElementById("unlockError");
  const unlockRecoveryEmail = document.getElementById("unlockRecoveryEmail");
  const recoverBtn = document.getElementById("recoverBtn");
  const encryptionStatus = document.getElementById("encryptionStatus");
  const encryptionOffControls = document.getElementById("encryptionOffControls");
  const encryptionOnControls = document.getElementById("encryptionOnControls");
  const enablePassphrase = document.getElementById("enablePassphrase");
  const enablePassphrase2 = document.getElementById("enablePassphrase2");
  const enableRecoveryEmail = document.getElementById("enableRecoveryEmail");
  const enableEncryptionBtn = document.getElementById("enableEncryptionBtn");
  const disableEncryptionBtn = document.getElementById("disableEncryptionBtn");
  const lockNowBtn = document.getElementById("lockNowBtn");
  const encryptionError = document.getElementById("encryptionError");

  /** @type {Record<string, string>} */
  let profile = emptyProfile();
  /** @type {Array<{id:string,label:string,aliases:string[],value:string}>} */
  let customFields = [];
  /** @type {object|null} */
  let profileStore = null;
  let vaultLocked = false;
  let saveTimer = 0;

  function emptyProfile() {
    return Object.fromEntries(PROFILE_KEYS.map((key) => [key, ""]));
  }

  function setUnlockError(message) {
    if (!unlockError) return;
    unlockError.hidden = !message;
    unlockError.textContent = message || "";
  }

  function setEncryptionError(message) {
    if (!encryptionError) return;
    encryptionError.hidden = !message;
    encryptionError.textContent = message || "";
  }

  function flashSaved() {
    if (!saveStatus) return;
    saveStatus.hidden = false;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveStatus.hidden = true;
    }, 1600);
  }

  function setLockedUi(locked) {
    vaultLocked = locked;
    document.body.classList.toggle("is-locked", locked);
    if (unlockGate) unlockGate.hidden = !locked;
    if (!locked) setUnlockError("");
  }

  function readFormIntoProfile(form) {
    if (!form) return;
    const data = new FormData(form);
    for (const [key, value] of data.entries()) {
      if (PROFILE_KEYS.includes(key)) {
        profile[key] = String(value || "");
      }
    }
  }

  function writeProfileIntoForms() {
    for (const form of [personalForm, addressForm]) {
      if (!form) continue;
      for (const el of form.elements) {
        if (!el.name || !PROFILE_KEYS.includes(el.name)) continue;
        el.value = profile[el.name] || "";
      }
    }
  }

  function syncActiveIntoStore() {
    if (!profileStore || typeof FoxFillProfiles === "undefined") return;
    readFormIntoProfile(personalForm);
    readFormIntoProfile(addressForm);
    FoxFillProfiles.upsertActiveData(
      profileStore,
      profile,
      PROFILE_KEYS,
      customFields
    );
  }

  async function persistStore(extraOpts) {
    if (!profileStore) return;
    await FoxFillProfiles.saveStore(profileStore, extraOpts);
    flashSaved();
  }

  function applyActiveProfileToUi() {
    const active = FoxFillProfiles.getActive(profileStore);
    profile = { ...emptyProfile(), ...(active?.data || {}) };
    customFields = FoxFillProfiles.normalizeCustomFields(
      active?.customFields || []
    );
    writeProfileIntoForms();
    renderCustomFields();
    updateEncryptionUi();
  }

  function renderProfileSelect() {
    if (!profileSelect || !profileStore) return;
    const list = FoxFillProfiles.listProfiles(profileStore);
    profileSelect.innerHTML = "";
    for (const p of list) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === profileStore.activeProfileId) opt.selected = true;
      profileSelect.appendChild(opt);
    }
  }

  function renderCustomFields() {
    if (!customFieldList) return;
    customFieldList.innerHTML = "";
    if (!customFields.length) {
      const empty = document.createElement("li");
      empty.className = "custom-item";
      empty.textContent = "No custom fields yet.";
      customFieldList.appendChild(empty);
      return;
    }
    for (const cf of customFields) {
      const li = document.createElement("li");
      li.className = "custom-item";
      li.dataset.id = cf.id;

      const label = document.createElement("div");
      label.className = "custom-item-label";
      label.textContent = cf.label;

      const aliases = document.createElement("input");
      aliases.type = "text";
      aliases.value = (cf.aliases || []).join(", ");
      aliases.placeholder = "Aliases, comma-separated";
      aliases.addEventListener("change", () => {
        cf.aliases = aliases.value
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean);
      });

      const value = document.createElement("input");
      value.type = "text";
      value.value = cf.value || "";
      value.placeholder = "Value";
      value.addEventListener("change", () => {
        cf.value = value.value;
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn-ghost danger";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        void removeCustomField(cf.id);
      });

      li.append(label, aliases, value, remove);
      customFieldList.appendChild(li);
    }
  }

  async function removeCustomField(id) {
    customFields = customFields.filter((cf) => cf.id !== id);
    renderCustomFields();
    syncActiveIntoStore();
    await persistStore();
  }

  async function addCustomField(event) {
    event.preventDefault();
    if (!customFieldForm) return;
    const data = new FormData(customFieldForm);
    const label = String(data.get("label") || "").trim();
    if (!label) return;
    const aliases = String(data.get("aliases") || "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const value = String(data.get("value") || "").trim();
    const id =
      globalThis.crypto?.randomUUID?.() ||
      `cf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    customFields.push({ id, label, aliases, value });
    customFieldForm.reset();
    renderCustomFields();
    syncActiveIntoStore();
    await persistStore();
  }

  function updateEncryptionUi() {
    const on = Boolean(profileStore?.encryptionEnabled);
    if (encryptionStatus) {
      encryptionStatus.textContent = on
        ? "Encryption is on. Profiles stay on this device, locked between sessions until you unlock."
        : "Profiles are stored locally without a passphrase.";
    }
    if (encryptionOffControls) encryptionOffControls.hidden = on;
    if (encryptionOnControls) encryptionOnControls.hidden = !on;
  }

  async function unlockVault() {
    const passphrase = unlockPassphrase?.value || "";
    if (!passphrase) {
      setUnlockError("Enter your passphrase.");
      return;
    }
    try {
      profileStore = await FoxFillProfiles.loadStore(PROFILE_KEYS, {
        passphrase,
      });
      setLockedUi(false);
      if (unlockPassphrase) unlockPassphrase.value = "";
      applyActiveProfileToUi();
      renderProfileSelect();
    } catch {
      setUnlockError("Wrong passphrase.");
    }
  }

  async function recoverWithEmail() {
    const email = unlockRecoveryEmail?.value || "";
    if (!email.trim()) {
      setUnlockError("Enter the recovery email.");
      return;
    }
    try {
      profileStore = await FoxFillProfiles.loadStore(PROFILE_KEYS, {
        recoveryEmail: email,
      });
      setLockedUi(false);
      applyActiveProfileToUi();
      renderProfileSelect();

      const next = window.prompt(
        "Recovery worked. Set a new passphrase (min 6 characters):"
      );
      if (next && next.length >= 6) {
        const confirmNext = window.prompt("Confirm new passphrase:");
        if (confirmNext === next) {
          profileStore.encryptionEnabled = true;
          await FoxFillProfiles.saveStore(profileStore, {
            passphrase: next,
            recoveryEmail:
              profile.email || FoxFillCrypto.normalizeEmail(email),
          });
        } else {
          profileStore.encryptionEnabled = false;
          await FoxFillProfiles.saveStore(profileStore);
        }
      } else {
        profileStore.encryptionEnabled = false;
        await FoxFillProfiles.saveStore(profileStore);
      }
      updateEncryptionUi();
      if (unlockRecoveryEmail) unlockRecoveryEmail.value = "";
    } catch (err) {
      setUnlockError(err?.message || "Recovery failed.");
    }
  }

  async function enableEncryption() {
    setEncryptionError("");
    const a = enablePassphrase?.value || "";
    const b = enablePassphrase2?.value || "";
    readFormIntoProfile(personalForm);
    readFormIntoProfile(addressForm);
    const recovery =
      enableRecoveryEmail?.value?.trim() || profile.email || "";
    if (a.length < 6) {
      setEncryptionError("Use at least 6 characters.");
      return;
    }
    if (a !== b) {
      setEncryptionError("Passphrases don’t match.");
      return;
    }
    if (!recovery || !recovery.includes("@")) {
      setEncryptionError("Add a recovery email before enabling encryption.");
      return;
    }
    syncActiveIntoStore();
    profileStore.encryptionEnabled = true;
    try {
      await FoxFillProfiles.saveStore(profileStore, {
        passphrase: a,
        recoveryEmail: recovery,
      });
      if (enablePassphrase) enablePassphrase.value = "";
      if (enablePassphrase2) enablePassphrase2.value = "";
      updateEncryptionUi();
      flashSaved();
    } catch (err) {
      profileStore.encryptionEnabled = false;
      setEncryptionError(err?.message || "Couldn’t enable encryption.");
    }
  }

  async function disableEncryption() {
    setEncryptionError("");
    const passphrase = window.prompt(
      "Enter your passphrase to turn off encryption"
    );
    if (passphrase == null) return;
    try {
      const peek = await FoxFillProfiles.peekEncryption();
      if (peek.encrypted) {
        await FoxFillCrypto.decryptStore(peek.envelope, passphrase);
      }
      syncActiveIntoStore();
      profileStore.encryptionEnabled = false;
      await FoxFillProfiles.saveStore(profileStore);
      await FoxFillCrypto.clearSessionUnlocked();
      updateEncryptionUi();
      flashSaved();
    } catch {
      setEncryptionError("Wrong passphrase — encryption stays on.");
    }
  }

  async function lockNow() {
    syncActiveIntoStore();
    try {
      await persistStore();
    } catch {
      // still lock
    }
    await FoxFillCrypto.clearSessionUnlocked();
    setLockedUi(true);
  }

  async function saveAll() {
    setEncryptionError("");
    syncActiveIntoStore();
    try {
      await persistStore();
    } catch (err) {
      setEncryptionError(err?.message || "Couldn’t save.");
    }
  }

  async function onProfileChange() {
    syncActiveIntoStore();
    try {
      await persistStore();
    } catch {
      // continue switch
    }
    FoxFillProfiles.setActive(profileStore, profileSelect.value);
    applyActiveProfileToUi();
    await persistStore();
  }

  async function onNewProfile() {
    const name = window.prompt("Name for the new profile:", "Work");
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const copy = window.confirm(
      "Copy details from the current profile into the new one?"
    );
    syncActiveIntoStore();
    FoxFillProfiles.addProfile(profileStore, trimmed, PROFILE_KEYS, copy);
    applyActiveProfileToUi();
    renderProfileSelect();
    await persistStore();
  }

  async function onRenameProfile() {
    const active = FoxFillProfiles.getActive(profileStore);
    if (!active) return;
    const name = window.prompt("Rename profile:", active.name);
    if (name == null) return;
    FoxFillProfiles.renameProfile(profileStore, active.id, name);
    renderProfileSelect();
    await persistStore();
  }

  async function onDeleteProfile() {
    const active = FoxFillProfiles.getActive(profileStore);
    if (!active) return;
    const ok = window.confirm(
      `Delete profile “${active.name}”? This cannot be undone.`
    );
    if (!ok) return;
    const result = FoxFillProfiles.deleteProfile(profileStore, active.id);
    if (!result.ok) {
      window.alert("You need at least one profile.");
      return;
    }
    applyActiveProfileToUi();
    renderProfileSelect();
    await persistStore();
  }

  function setupPasswordToggles() {
    document.querySelectorAll(".pw-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-pw-target");
        const input = id ? document.getElementById(id) : null;
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.textContent = show ? "Hide" : "Show";
      });
    });
  }

  function bindEvents() {
    setupPasswordToggles();
    saveAllBtn?.addEventListener("click", () => {
      void saveAll();
    });
    profileSelect?.addEventListener("change", () => {
      void onProfileChange();
    });
    profileNewBtn?.addEventListener("click", () => {
      void onNewProfile();
    });
    profileRenameBtn?.addEventListener("click", () => {
      void onRenameProfile();
    });
    profileDeleteBtn?.addEventListener("click", () => {
      void onDeleteProfile();
    });
    customFieldForm?.addEventListener("submit", (event) => {
      void addCustomField(event);
    });
    unlockBtn?.addEventListener("click", () => {
      void unlockVault();
    });
    unlockPassphrase?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void unlockVault();
    });
    recoverBtn?.addEventListener("click", () => {
      void recoverWithEmail();
    });
    unlockRecoveryEmail?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void recoverWithEmail();
    });
    enableEncryptionBtn?.addEventListener("click", () => {
      void enableEncryption();
    });
    disableEncryptionBtn?.addEventListener("click", () => {
      void disableEncryption();
    });
    lockNowBtn?.addEventListener("click", () => {
      void lockNow();
    });
  }

  async function init() {
    bindEvents();
    try {
      const peek = await FoxFillProfiles.peekEncryption();
      if (peek.encrypted) {
        try {
          profileStore = await FoxFillProfiles.loadStore(PROFILE_KEYS);
          setLockedUi(false);
        } catch (err) {
          if (err?.code === "LOCKED") {
            setLockedUi(true);
            return;
          }
          throw err;
        }
      } else {
        profileStore = await FoxFillProfiles.loadStore(PROFILE_KEYS);
        setLockedUi(false);
      }
      applyActiveProfileToUi();
      renderProfileSelect();
    } catch (err) {
      setUnlockError(err?.message || "Couldn’t load settings.");
      setLockedUi(true);
    }
  }

  void init();
})();
