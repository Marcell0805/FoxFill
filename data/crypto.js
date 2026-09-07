/**
 * FoxFill passphrase encryption (AES-GCM + PBKDF2).
 * Optional email recovery unlocks the same vault when the recovery email matches.
 */
(function initFoxFillCrypto(global) {
  const SESSION_KEY = "foxfillSession";
  const ITERATIONS = 250000;

  function bytesToBase64(bytes) {
    let binary = "";
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i += 1) binary += String.fromCharCode(arr[i]);
    return btoa(binary);
  }

  function base64ToBytes(b64) {
    const binary = atob(String(b64 || ""));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }

  function normalizeEmail(email) {
    return String(email || "")
      .trim()
      .toLowerCase();
  }

  function isEncryptedEnvelope(value) {
    return Boolean(
      value &&
        value.encrypted === true &&
        value.ciphertext &&
        value.salt &&
        value.iv
    );
  }

  function hasEmailRecovery(envelope) {
    return Boolean(
      isEncryptedEnvelope(envelope) &&
        envelope.recovery &&
        envelope.recovery.emailHash &&
        envelope.recovery.ciphertext &&
        envelope.recovery.salt &&
        envelope.recovery.iv
    );
  }

  async function deriveKey(secret, saltBytes) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(String(secret || "")),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltBytes,
        iterations: ITERATIONS,
        hash: "SHA-256",
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function hashEmail(email) {
    const normalized = normalizeEmail(email);
    if (!normalized || !normalized.includes("@")) {
      throw new Error("Enter a valid recovery email");
    }
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`foxfill-recovery:${normalized}`)
    );
    return bytesToBase64(new Uint8Array(digest));
  }

  async function encryptBytes(plaintext, secret) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(secret, salt);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plaintext
    );
    return {
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    };
  }

  async function decryptBytes(parts, secret) {
    const salt = base64ToBytes(parts.salt);
    const iv = base64ToBytes(parts.iv);
    const key = await deriveKey(secret, salt);
    const cipherBytes = base64ToBytes(parts.ciphertext);
    try {
      return await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        cipherBytes
      );
    } catch {
      throw new Error("Wrong passphrase");
    }
  }

  /**
   * @param {object} store
   * @param {string} passphrase
   * @param {string} [recoveryEmail] profile email used for recovery unlock
   * @param {object} [previousEnvelope] keep existing recovery if re-saving
   */
  async function encryptStore(store, passphrase, recoveryEmail, previousEnvelope) {
    const plaintext = new TextEncoder().encode(JSON.stringify(store));
    const main = await encryptBytes(plaintext, passphrase);

    const envelope = {
      version: 3,
      encrypted: true,
      kdf: "PBKDF2-SHA256",
      iterations: ITERATIONS,
      salt: main.salt,
      iv: main.iv,
      ciphertext: main.ciphertext,
    };

    const email = normalizeEmail(recoveryEmail);
    if (email) {
      const recovery = await encryptBytes(plaintext, email);
      envelope.recovery = {
        emailHash: await hashEmail(email),
        salt: recovery.salt,
        iv: recovery.iv,
        ciphertext: recovery.ciphertext,
      };
    } else if (previousEnvelope?.recovery) {
      // Re-save with passphrase only — preserve prior recovery pack by
      // re-encrypting recovery from freshly decrypted... not available here.
      // Caller should pass recoveryEmail when possible.
      envelope.recovery = previousEnvelope.recovery;
    }

    return envelope;
  }

  async function decryptStore(envelope, passphrase) {
    if (!isEncryptedEnvelope(envelope)) {
      throw new Error("Not an encrypted store");
    }
    const plainBuf = await decryptBytes(
      {
        salt: envelope.salt,
        iv: envelope.iv,
        ciphertext: envelope.ciphertext,
      },
      passphrase
    );
    return JSON.parse(new TextDecoder().decode(plainBuf));
  }

  async function decryptStoreWithEmail(envelope, email) {
    if (!hasEmailRecovery(envelope)) {
      throw new Error("Email recovery is not set up for this vault");
    }
    const normalized = normalizeEmail(email);
    const emailHash = await hashEmail(normalized);
    if (emailHash !== envelope.recovery.emailHash) {
      throw new Error("Email does not match recovery email");
    }
    let plainBuf;
    try {
      plainBuf = await decryptBytes(envelope.recovery, normalized);
    } catch {
      throw new Error("Email does not match recovery email");
    }
    return JSON.parse(new TextDecoder().decode(plainBuf));
  }

  async function saveSessionUnlocked(store, passphrase) {
    if (!chrome?.storage?.session) return;
    const prev = await loadSessionVault();
    await chrome.storage.session.set({
      [SESSION_KEY]: {
        unlockedAt: new Date().toISOString(),
        store,
        passphrase:
          passphrase != null ? String(passphrase) : prev?.passphrase || "",
      },
    });
  }

  async function loadSessionVault() {
    if (!chrome?.storage?.session) return null;
    const bag = await chrome.storage.session.get(SESSION_KEY);
    return bag[SESSION_KEY] || null;
  }

  async function loadSessionUnlocked() {
    const vault = await loadSessionVault();
    return vault?.store || null;
  }

  async function loadSessionPassphrase() {
    const vault = await loadSessionVault();
    return vault?.passphrase || "";
  }

  async function clearSessionUnlocked() {
    if (!chrome?.storage?.session) return;
    await chrome.storage.session.remove(SESSION_KEY);
  }

  global.FoxFillCrypto = {
    SESSION_KEY,
    normalizeEmail,
    isEncryptedEnvelope,
    hasEmailRecovery,
    hashEmail,
    encryptStore,
    decryptStore,
    decryptStoreWithEmail,
    saveSessionUnlocked,
    loadSessionUnlocked,
    loadSessionPassphrase,
    loadSessionVault,
    clearSessionUnlocked,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
