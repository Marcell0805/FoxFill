/**
 * FoxFill service worker — page button registration + quick fill.
 */
/* eslint-disable no-undef */
importScripts(
  "../data/prefs.js",
  "../data/crypto.js",
  "../data/profiles.js",
  "../data/phoneParse.js",
  "../data/dateFormat.js",
  "../data/fitValue.js",
  "../content/compound.js"
);

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

const PAGE_BUTTON_SCRIPT_ID = "foxfill-page-button";
const PAGE_ORIGINS = ["http://*/*", "https://*/*"];
const PAGE_BUTTON_FILE = "content/page-button.js";

const SCAN_FILES = [
  "data/fieldPatterns.js",
  "data/phoneParse.js",
  "data/dateFormat.js",
  "data/fitValue.js",
  "content/matcher.js",
  "content/scanner.js",
];

const FILL_FILES = ["data/phoneParse.js", "data/fitValue.js", "content/filler.js"];

async function hasPageAccess() {
  return chrome.permissions.contains({ origins: PAGE_ORIGINS });
}

/** Serialize registration so parallel startup/storage events can't double-register. */
let pageButtonSyncQueue = Promise.resolve();

function syncPageButtonRegistration() {
  const run = async () => {
    const prefs = await FoxFillPrefs.loadPrefs();
    const allowed = prefs.pageButton && (await hasPageAccess());

    // Always clear first — avoids "Duplicate script ID" races.
    try {
      await chrome.scripting.unregisterContentScripts({
        ids: [PAGE_BUTTON_SCRIPT_ID],
      });
    } catch {
      // Not registered yet.
    }

    if (allowed) {
      try {
        await chrome.scripting.registerContentScripts([
          {
            id: PAGE_BUTTON_SCRIPT_ID,
            js: [PAGE_BUTTON_FILE],
            matches: PAGE_ORIGINS,
            runAt: "document_idle",
            allFrames: false,
            persistAcrossSessions: true,
          },
        ]);
      } catch (err) {
        const msg = String(err?.message || err);
        if (!/duplicate script id/i.test(msg)) throw err;
      }
    }

    return allowed;
  };

  pageButtonSyncQueue = pageButtonSyncQueue.then(run, run);
  return pageButtonSyncQueue;
}

async function injectPageButtonIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: PAGE_ORIGINS });
  for (const tab of tabs) {
    if (tab.id == null) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [PAGE_BUTTON_FILE],
      });
    } catch {
      // Restricted or discarded tabs — ignore.
    }
  }
}

async function removePageButtonFromOpenTabs() {
  const tabs = await chrome.tabs.query({ url: PAGE_ORIGINS });
  for (const tab of tabs) {
    if (tab.id == null) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "FOXFILL_REMOVE_PAGE_BUTTON" });
    } catch {
      // no listener
    }
  }
}

async function loadActiveProfile() {
  const peek = await FoxFillProfiles.peekEncryption();
  if (peek.encrypted) {
    try {
      const store = await FoxFillProfiles.loadStore(PROFILE_KEYS);
      const active = FoxFillProfiles.getActive(store);
      return {
        profile: active?.data || {},
        customFields: FoxFillProfiles.normalizeCustomFields(active?.customFields),
      };
    } catch (err) {
      if (err?.code === "LOCKED") {
        const error = new Error("Profile locked — unlock FoxFill first.");
        error.code = "LOCKED";
        throw error;
      }
      throw err;
    }
  }
  const store = await FoxFillProfiles.loadStore(PROFILE_KEYS);
  const active = FoxFillProfiles.getActive(store);
  return {
    profile: active?.data || {},
    customFields: FoxFillProfiles.normalizeCustomFields(active?.customFields),
  };
}

function customPatternsFromFields(customFields) {
  return (customFields || [])
    .filter((f) => f && f.label && f.value)
    .map((f) => ({
      key: `custom:${f.id}`,
      label: f.label,
      group: "custom",
      custom: true,
      aliases: [f.label, ...(f.aliases || [])],
      value: f.value,
    }));
}

function collectMatchesFromFrames(results, profile) {
  const buckets = new Map();
  for (const entry of results || []) {
    const payload = entry?.result;
    if (!payload || payload.ok !== true || !Array.isArray(payload.matches)) {
      continue;
    }
    const frameId = entry.frameId ?? 0;
    if (!buckets.has(frameId)) buckets.set(frameId, []);
    for (const match of payload.matches) {
      buckets.get(frameId).push({ ...match, frameId });
    }
  }

  const merged = [];
  let globalIndex = 0;
  for (const [frameId, raw] of buckets) {
    let local = raw.map((m, i) => ({ ...m, index: i, frameId }));
    if (typeof FoxFillApplyPhoneCompounds === "function") {
      local = FoxFillApplyPhoneCompounds(local, {
        phone: profile.phone || "",
        country: profile.country || "",
        dateOfBirth: profile.dateOfBirth || "",
      });
    }
    for (const m of local) {
      merged.push({ ...m, index: globalIndex, frameId });
      globalIndex += 1;
    }
  }
  return merged;
}

function resolvedFillValue(match, profile, customFields) {
  if (match.fillValue != null && String(match.fillValue).trim() !== "") {
    return String(match.fillValue).trim();
  }
  if (match.profileKey && String(match.profileKey).startsWith("custom:")) {
    const id = String(match.profileKey).slice("custom:".length);
    const field = (customFields || []).find((f) => f.id === id);
    return field?.value ? String(field.value) : "";
  }
  if (match.profileKey && profile?.[match.profileKey] != null) {
    return String(profile[match.profileKey]).trim();
  }
  return "";
}

function isWillFill(match) {
  return match.status === "will_fill" || match.status === "matched";
}

async function fillFromPageButton(tabId) {
  if (tabId == null) {
    return { ok: false, error: "No active tab." };
  }

  const prefs = await FoxFillPrefs.loadPrefs();
  if (!prefs.pageButton) {
    return { ok: false, error: "Page fill button is turned off in settings." };
  }
  if (!(await hasPageAccess())) {
    return { ok: false, error: "Site access isn’t granted. Enable it in FoxFill settings." };
  }

  let profileBag;
  try {
    profileBag = await loadActiveProfile();
  } catch (err) {
    return { ok: false, error: err?.message || "Couldn’t load profile." };
  }

  const { profile, customFields } = profileBag;
  const customPatterns =
    typeof FoxFillProfiles.customPatternsFromFields === "function"
      ? FoxFillProfiles.customPatternsFromFields(customFields)
      : customPatternsFromFields(customFields);

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: SCAN_FILES.slice(0, -1),
  });

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (patterns) => {
      const bag = globalThis.FoxFillFieldPatterns;
      if (!bag || !Array.isArray(bag.fields)) return;
      bag.fields = bag.fields.filter((f) => !f.custom);
      if (Array.isArray(patterns) && patterns.length) {
        bag.fields.push(...patterns);
      }
    },
    args: [
      customPatterns.map((p) => ({
        key: p.key,
        label: p.label,
        group: "custom",
        custom: true,
        aliases: p.aliases,
      })),
    ],
  });

  // Custom field values are resolved in the service worker via profileForFill.
  const profileForFill = { ...profile };
  for (const f of customFields || []) {
    profileForFill[`custom:${f.id}`] = f.value || "";
  }

  const scanResults = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content/scanner.js"],
  });

  const matches = collectMatchesFromFrames(scanResults, profileForFill);
  const fillable = matches.filter(
    (m) => isWillFill(m) && resolvedFillValue(m, profileForFill, customFields)
  );

  if (!fillable.length) {
    return {
      ok: true,
      filled: 0,
      message: "No confident matches on this page.",
    };
  }

  const phoneParsed =
    typeof FoxFillPhoneParse !== "undefined"
      ? FoxFillPhoneParse.parsePhone(profile.phone || "", profile.country || "")
      : null;

  const fills = fillable.map((m) => {
    const value = resolvedFillValue(m, profileForFill, customFields);
    const hints = {};
    if (m.profileKey === "phoneCountryCode" || m.compound?.role === "dial") {
      if (phoneParsed?.dialDigits) hints.dialDigits = phoneParsed.dialDigits;
      if (profile.country) hints.country = profile.country;
    }
    if (Array.isArray(m.fillCandidates) && m.fillCandidates.length) {
      hints.candidates = m.fillCandidates;
    }
    return {
      profileKey: m.profileKey,
      value,
      fingerprint: m.fingerprint,
      allowOverwrite: false,
      hints,
      frameId: m.frameId ?? 0,
      phoneParsed:
        m.profileKey === "phone" || String(m.fillMode || "").startsWith("phone")
          ? phoneParsed
          : null,
    };
  });

  const byFrame = new Map();
  for (const item of fills) {
    const fid = item.frameId ?? 0;
    if (!byFrame.has(fid)) byFrame.set(fid, []);
    byFrame.get(fid).push(item);
  }

  let filled = 0;
  for (const [frameId, frameFills] of byFrame) {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: FILL_FILES,
    });
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (payload) => {
        if (typeof globalThis.FoxFillFillFields !== "function") {
          return { ok: false, error: "filler unavailable" };
        }
        return globalThis.FoxFillFillFields(payload);
      },
      args: [{ fills: frameFills }],
    });
    const outcome = results?.[0]?.result;
    if (outcome?.ok) filled += outcome.filled || 0;
  }

  return { ok: true, filled, matched: fillable.length };
}

chrome.runtime.onInstalled.addListener(() => {
  void syncPageButtonRegistration();
});

chrome.runtime.onStartup.addListener(() => {
  void syncPageButtonRegistration();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[FoxFillPrefs.KEY]) return;
  void (async () => {
    const allowed = await syncPageButtonRegistration();
    if (allowed) await injectPageButtonIntoOpenTabs();
    else await removePageButtonFromOpenTabs();
  })();
});

chrome.permissions.onAdded.addListener(() => {
  void syncPageButtonRegistration().then((allowed) => {
    if (allowed) return injectPageButtonIntoOpenTabs();
  });
});

chrome.permissions.onRemoved.addListener(() => {
  void syncPageButtonRegistration().then(() => removePageButtonFromOpenTabs());
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "FOXFILL_SYNC_PAGE_BUTTON") {
    syncPageButtonRegistration()
      .then(async (allowed) => {
        if (allowed) await injectPageButtonIntoOpenTabs();
        else await removePageButtonFromOpenTabs();
        return { ok: true, allowed };
      })
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  if (message?.type === "FOXFILL_PAGE_BUTTON_FILL") {
    const tabId = sender.tab?.id;
    fillFromPageButton(tabId)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  return false;
});

void syncPageButtonRegistration();
