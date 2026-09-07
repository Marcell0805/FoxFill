/**
 * FoxFill popup — Phase 6: grouped review UI with include toggles.
 */

const STORAGE_KEY = "foxfillProfile";

const scanBtn = document.getElementById("scanBtn");
const fillBtn = document.getElementById("fillBtn");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const errorEl = document.getElementById("error");
const reviewEl = document.getElementById("review");
const listWill = document.getElementById("listWill");
const listReview = document.getElementById("listReview");
const listUnmatched = document.getElementById("listUnmatched");
const countWill = document.getElementById("countWill");
const countReview = document.getElementById("countReview");
const countUnmatched = document.getElementById("countUnmatched");
const toggleUnmatched = document.getElementById("toggleUnmatched");
const personalForm = document.getElementById("personalForm");
const addressForm = document.getElementById("addressForm");
const personalSaveMsg = document.getElementById("personalSaveMsg");
const addressSaveMsg = document.getElementById("addressSaveMsg");

const PROFILE_KEYS = [
  "title",
  "firstName",
  "lastName",
  "idNumber",
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

const RESTRICTED_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "devtools://",
  "https://chrome.google.com/webstore",
  "https://chromewebstore.google.com",
];

/** @type {Record<string, string>} */
let profile = emptyProfile();

/** @type {object[]|null} */
let lastMatches = null;

/** @type {number|null} */
let lastTabId = null;

/** @type {Set<number>} */
let selectedIndexes = new Set();

function emptyProfile() {
  return Object.fromEntries(PROFILE_KEYS.map((key) => [key, ""]));
}

function setError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.classList.remove("is-success", "is-empty");
  if (kind) statusEl.classList.add(kind);
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function isWillFill(match) {
  return match.status === "will_fill" || match.status === "matched";
}

function resolvedFillValue(match) {
  if (match.fillValue != null && String(match.fillValue).trim() !== "") {
    return String(match.fillValue).trim();
  }
  if (match.profileKey === "phoneCountryCode") return "";
  if (match.profileKey && profile[match.profileKey]) {
    return String(profile[match.profileKey] || "").trim();
  }
  return "";
}

function canInclude(match) {
  return Boolean(resolvedFillValue(match));
}

function selectedFillable() {
  return (lastMatches || []).filter(
    (m) => selectedIndexes.has(m.index) && canInclude(m)
  );
}

function updateFillButton() {
  const fillable = selectedFillable();
  const count = fillable.length;
  if (count === 0) {
    fillBtn.hidden = true;
    fillBtn.disabled = true;
    fillBtn.textContent = "Fill Fields";
    return;
  }
  fillBtn.hidden = false;
  fillBtn.disabled = false;
  fillBtn.textContent = `Fill ${count} Field${count === 1 ? "" : "s"}`;
}

function updateSummary(matches) {
  const will = matches.filter((m) => isWillFill(m)).length;
  const review = matches.filter((m) => m.status === "needs_review").length;
  const unmatched = matches.filter(
    (m) => !isWillFill(m) && m.status !== "needs_review"
  ).length;
  const selected = selectedFillable().length;

  summaryEl.hidden = false;
  summaryEl.innerHTML = "";

  const chips = [
    { label: `${will} ready`, className: "chip-ready" },
    { label: `${review} review`, className: "chip-review" },
    { label: `${unmatched} unmatched`, className: "chip-none" },
    { label: `${selected} selected`, className: "chip-selected" },
  ];

  for (const chip of chips) {
    const span = document.createElement("span");
    span.className = `chip ${chip.className}`;
    span.textContent = chip.label;
    summaryEl.append(span);
  }
}

function primaryClue(field) {
  const isDialPrefix = (text) => {
    const raw = String(text || "").trim();
    if (!raw || raw.length > 16) return false;
    return /^\+\d{1,4}$/.test(raw) || (/^\+?\d{1,4}$/.test(raw) && raw.length <= 5);
  };
  const candidates = [
    field.label,
    field.ariaLabel,
    field.placeholder,
    field.name,
    field.id,
    field.autocomplete,
  ].filter(Boolean);
  const preferred = candidates.find((c) => !isDialPrefix(c));
  return preferred || candidates[0] || "(no clues)";
}

function statusMeta(match) {
  const fillVal = resolvedFillValue(match);
  const compoundBit =
    match.compound?.type === "phone"
      ? match.compound.role === "dial"
        ? " · dial companion"
        : match.fillMode === "phone_national"
          ? " · national"
          : match.fillMode === "phone_full"
            ? " · full"
            : ""
      : "";

  if (isWillFill(match)) {
    const label = match.profileLabel || match.profileKey || "Profile";
    const valueBit = fillVal
      ? ` · ${match.fillLabel || fillVal}`
      : " · (empty in profile)";
    const fitBit = match.fitted
      ? match.fingerprint?.maxLength != null
        ? ` · fits maxlen ${match.fingerprint.maxLength}`
        : " · fitted"
      : "";
    return {
      pill: "Will fill",
      pillClass: "pill-matched",
      detail: `${label}${valueBit}${compoundBit}${fitBit}`,
    };
  }
  if (match.status === "needs_review") {
    const keyBit =
      match.profileLabel || match.profileKey
        ? `${match.profileLabel || match.profileKey} · `
        : "";
    return {
      pill: "Check",
      pillClass: "pill-review",
      detail: `${keyBit}${match.reason || "Needs review"}`,
    };
  }
  return {
    pill: "Not matched",
    pillClass: "pill-none",
    detail: match.reason || "No confident match",
  };
}

function createFieldItem(match, options) {
  const { selectable, checked, disabled } = options;
  const fp = match.fingerprint;
  const meta = statusMeta(match);

  const li = document.createElement("li");
  li.className = "field-item";
  if (disabled) li.classList.add("is-disabled");

  const top = document.createElement("div");
  top.className = "field-top";

  if (selectable) {
    const label = document.createElement("label");
    label.className = "field-select";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(checked);
    input.disabled = Boolean(disabled);
    input.dataset.index = String(match.index);
    input.setAttribute(
      "aria-label",
      `Include ${primaryClue(fp)} when filling`
    );
    input.addEventListener("change", () => {
      if (input.checked) selectedIndexes.add(match.index);
      else selectedIndexes.delete(match.index);
      updateFillButton();
      if (lastMatches) updateSummary(lastMatches);
    });

    const title = document.createElement("span");
    title.className = "field-title";
    title.textContent = primaryClue(fp);

    label.append(input, title);
    top.append(label);
  } else {
    const title = document.createElement("span");
    title.className = "field-title";
    title.textContent = primaryClue(fp);
    top.append(title);
  }

  const pill = document.createElement("span");
  pill.className = `pill ${meta.pillClass}`;
  pill.textContent = meta.pill;
  top.append(pill);

  const detail = document.createElement("div");
  detail.className = "field-meta";
  detail.textContent = meta.detail;

  li.append(top, detail);
  return li;
}

function resetUnmatchedCollapse() {
  listUnmatched.hidden = true;
  listUnmatched.classList.add("is-collapsed");
  toggleUnmatched.setAttribute("aria-expanded", "false");
}

function renderMatches(matches) {
  listWill.innerHTML = "";
  listReview.innerHTML = "";
  listUnmatched.innerHTML = "";

  const will = [];
  const review = [];
  const unmatched = [];

  for (const match of matches) {
    if (isWillFill(match)) will.push(match);
    else if (match.status === "needs_review") review.push(match);
    else unmatched.push(match);
  }

  selectedIndexes = new Set(
    will.filter((m) => canInclude(m)).map((m) => m.index)
  );

  for (const match of will) {
    const includable = canInclude(match);
    listWill.append(
      createFieldItem(match, {
        selectable: true,
        checked: includable,
        disabled: !includable,
      })
    );
  }

  for (const match of review) {
    const includable = canInclude(match);
    listReview.append(
      createFieldItem(match, {
        selectable: includable,
        checked: false,
        disabled: !includable,
      })
    );
  }

  for (const match of unmatched) {
    listUnmatched.append(
      createFieldItem(match, {
        selectable: false,
        checked: false,
        disabled: false,
      })
    );
  }

  countWill.textContent = String(will.length);
  countReview.textContent = String(review.length);
  countUnmatched.textContent = String(unmatched.length);

  const groupWill = reviewEl.querySelector('[data-group="will_fill"]');
  const groupReview = reviewEl.querySelector('[data-group="needs_review"]');
  const groupUnmatched = reviewEl.querySelector('[data-group="unmatched"]');

  groupWill.hidden = will.length === 0;
  groupReview.hidden = review.length === 0;
  groupUnmatched.hidden = unmatched.length === 0;

  reviewEl.hidden = matches.length === 0;
  resetUnmatchedCollapse();
  updateSummary(matches);
  updateFillButton();
}

function clearReview() {
  reviewEl.hidden = true;
  summaryEl.hidden = true;
  summaryEl.innerHTML = "";
  listWill.innerHTML = "";
  listReview.innerHTML = "";
  listUnmatched.innerHTML = "";
  selectedIndexes = new Set();
  updateFillButton();
}

function normalizeDob(value) {
  if (!value) return "";
  if (typeof FoxFillDateFormat !== "undefined" && FoxFillDateFormat.toIso) {
    return FoxFillDateFormat.toIso(value) || "";
  }
  return String(value).trim();
}

const dobHidden = document.getElementById("dateOfBirth");
const dobDayBtn = document.getElementById("dobDayBtn");
const dobMonthBtn = document.getElementById("dobMonthBtn");
const dobYearBtn = document.getElementById("dobYearBtn");
const dobDayMenu = document.getElementById("dobDayMenu");
const dobMonthMenu = document.getElementById("dobMonthMenu");
const dobYearMenu = document.getElementById("dobYearMenu");

const MONTHS = [
  ["01", "January"],
  ["02", "February"],
  ["03", "March"],
  ["04", "April"],
  ["05", "May"],
  ["06", "June"],
  ["07", "July"],
  ["08", "August"],
  ["09", "September"],
  ["10", "October"],
  ["11", "November"],
  ["12", "December"],
];

const dobState = { day: "", month: "", year: "" };

function daysInMonth(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m) return 31;
  return new Date(y, m, 0).getDate();
}

function setDobButtonLabel(btn, value, placeholder) {
  const label = btn.querySelector(".dob-dd-label");
  label.textContent = value || placeholder;
  label.classList.toggle("is-placeholder", !value);
}

function closeAllDobMenus() {
  for (const root of document.querySelectorAll(".dob-dd")) {
    root.classList.remove("is-open");
    const btn = root.querySelector(".dob-dd-btn");
    const menu = root.querySelector(".dob-dd-menu");
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (menu) menu.hidden = true;
  }
}

function openDobMenu(root) {
  closeAllDobMenus();
  const btn = root.querySelector(".dob-dd-btn");
  const menu = root.querySelector(".dob-dd-menu");
  root.classList.add("is-open");
  btn.setAttribute("aria-expanded", "true");
  menu.hidden = false;
  const active = menu.querySelector(".is-active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

function fillDobMenu(menu, items, selected, onPick) {
  menu.innerHTML = "";
  for (const [value, text] of items) {
    const li = document.createElement("li");
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "dob-dd-option";
    opt.setAttribute("role", "option");
    opt.dataset.value = value;
    opt.textContent = text;
    if (value && value === selected) opt.classList.add("is-active");
    opt.addEventListener("click", (event) => {
      event.preventDefault();
      onPick(value, text);
      closeAllDobMenus();
    });
    li.append(opt);
    menu.append(li);
  }
}

function rebuildDobDayMenu() {
  const max = daysInMonth(dobState.year, dobState.month);
  if (dobState.day && Number(dobState.day) > max) {
    dobState.day = "";
  }
  const items = [["", "Day"]];
  for (let d = 1; d <= max; d += 1) {
    const v = String(d).padStart(2, "0");
    items.push([v, String(d)]);
  }
  fillDobMenu(dobDayMenu, items, dobState.day, (value, text) => {
    dobState.day = value;
    setDobButtonLabel(dobDayBtn, value ? text : "", "Day");
    syncDobHiddenFromSelects();
  });
  setDobButtonLabel(
    dobDayBtn,
    dobState.day ? String(Number(dobState.day)) : "",
    "Day"
  );
}

function rebuildDobMonthMenu() {
  const items = [["", "Month"], ...MONTHS];
  fillDobMenu(dobMonthMenu, items, dobState.month, (value, text) => {
    dobState.month = value;
    setDobButtonLabel(dobMonthBtn, value ? text : "", "Month");
    rebuildDobDayMenu();
    syncDobHiddenFromSelects();
  });
  const monthLabel = MONTHS.find(([v]) => v === dobState.month)?.[1] || "";
  setDobButtonLabel(dobMonthBtn, monthLabel, "Month");
}

function rebuildDobYearMenu() {
  const thisYear = new Date().getFullYear();
  const items = [["", "Year"]];
  for (let y = thisYear; y >= 1920; y -= 1) {
    items.push([String(y), String(y)]);
  }
  fillDobMenu(dobYearMenu, items, dobState.year, (value, text) => {
    dobState.year = value;
    setDobButtonLabel(dobYearBtn, value ? text : "", "Year");
    rebuildDobDayMenu();
    syncDobHiddenFromSelects();
  });
  setDobButtonLabel(dobYearBtn, dobState.year, "Year");
}

function syncDobHiddenFromSelects() {
  const { year: y, month: m, day: d } = dobState;
  dobHidden.value = y && m && d ? `${y}-${m}-${d}` : "";
}

function setDobSelectsFromIso(iso) {
  const value = normalizeDob(iso);
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    dobState.year = "";
    dobState.month = "";
    dobState.day = "";
    rebuildDobYearMenu();
    rebuildDobMonthMenu();
    rebuildDobDayMenu();
    dobHidden.value = "";
    return;
  }
  const [y, m, d] = value.split("-");
  dobState.year = y;
  dobState.month = m;
  dobState.day = d;
  rebuildDobYearMenu();
  rebuildDobMonthMenu();
  rebuildDobDayMenu();
  syncDobHiddenFromSelects();
}

function populateDobSelects() {
  rebuildDobYearMenu();
  rebuildDobMonthMenu();
  rebuildDobDayMenu();

  const map = [
    [dobDayBtn, dobDayMenu],
    [dobMonthBtn, dobMonthMenu],
    [dobYearBtn, dobYearMenu],
  ];
  for (const [btn, menu] of map) {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      const root = btn.closest(".dob-dd");
      const open = root.classList.contains("is-open");
      if (open) closeAllDobMenus();
      else openDobMenu(root);
    });
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".dob-dd")) closeAllDobMenus();
  });
}

function fillFormsFromProfile() {
  for (const form of [personalForm, addressForm]) {
    for (const el of form.elements) {
      if (!el.name || !PROFILE_KEYS.includes(el.name)) continue;
      if (el.name === "dateOfBirth") continue;
      el.value = profile[el.name] || "";
    }
  }
  setDobSelectsFromIso(profile.dateOfBirth || "");
}

function readFormIntoProfile(form) {
  if (form === personalForm) {
    syncDobHiddenFromSelects();
  }
  for (const el of form.elements) {
    if (el.name && PROFILE_KEYS.includes(el.name)) {
      let value = String(el.value || "").trim();
      if (el.name === "dateOfBirth") value = normalizeDob(value);
      profile[el.name] = value;
    }
  }
}

populateDobSelects();

async function loadProfile() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  profile = { ...emptyProfile(), ...(stored[STORAGE_KEY] || {}) };
  fillFormsFromProfile();
  if (lastMatches) {
    renderMatches(lastMatches);
  }
}

async function saveProfile(fromForm, msgEl) {
  readFormIntoProfile(fromForm);
  readFormIntoProfile(
    fromForm === personalForm ? addressForm : personalForm
  );
  await chrome.storage.local.set({ [STORAGE_KEY]: profile });
  msgEl.hidden = false;
  window.setTimeout(() => {
    msgEl.hidden = true;
  }, 1600);
  if (lastMatches) {
    if (typeof FoxFillApplyPhoneCompounds === "function") {
      lastMatches = FoxFillApplyPhoneCompounds(lastMatches, {
        phone: profile.phone || "",
        country: profile.country || "",
        dateOfBirth: profile.dateOfBirth || "",
      });
    }
    renderMatches(lastMatches);
  }
}

function setupTabs() {
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".panel");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const id = tab.dataset.tab;
      tabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      });
      panels.forEach((panel) => {
        const active = panel.dataset.panel === id;
        panel.classList.toggle("is-active", active);
        panel.hidden = !active;
      });
    });
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function scanActiveTab() {
  setError("");
  setStatus("Scanning this page…");
  clearReview();
  lastMatches = null;
  lastTabId = null;
  scanBtn.disabled = true;

  try {
    const tab = await getActiveTab();
    if (!tab || tab.id == null) {
      setStatus("Open a webpage with a form, then scan.");
      setError("No active tab found.");
      return;
    }

    if (isRestrictedUrl(tab.url || "")) {
      setStatus("Open a webpage with a form, then scan.");
      setError(
        "FoxFill can’t scan this page. Open a normal website and try again."
      );
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        "data/fieldPatterns.js",
        "data/phoneParse.js",
        "data/dateFormat.js",
        "data/fitValue.js",
        "content/matcher.js",
        "content/scanner.js",
      ],
    });

    const payload = results?.[0]?.result;
    if (!payload || payload.ok !== true || !Array.isArray(payload.matches)) {
      setStatus("Open a webpage with a form, then scan.");
      setError("Scan failed. Reload the page and try again.");
      return;
    }

    let matches = payload.matches;
    if (typeof FoxFillApplyPhoneCompounds === "function") {
      matches = FoxFillApplyPhoneCompounds(matches, {
        phone: profile.phone || "",
        country: profile.country || "",
        dateOfBirth: profile.dateOfBirth || "",
      });
    }

    lastMatches = matches;
    lastTabId = tab.id;

    const count = matches.length;
    const willFill = matches.filter((m) => isWillFill(m)).length;
    const review = matches.filter((m) => m.status === "needs_review").length;

    console.groupCollapsed(`[FoxFill] Review — ${count} fields`);
    console.table(
      matches.map((m) => ({
        label: primaryClue(m.fingerprint),
        status: m.status,
        profile: m.profileKey || "",
        fill: resolvedFillValue(m),
        mode: m.fillMode || m.compound?.scenario || "",
        score: m.score || 0,
      }))
    );
    console.log("Full matches:", matches);
    console.groupEnd();

    if (count === 0) {
      setStatus("No fillable fields found on this page.", "is-empty");
      return;
    }

    setStatus(
      `Form detected — ${count} fields. Review what will be filled.`,
      "is-success"
    );
    renderMatches(matches);

    if (willFill === 0 && review === 0) {
      setStatus(
        `Form detected — ${count} fields, none matched confidently.`,
        "is-empty"
      );
    }
  } catch (err) {
    console.error("FoxFill scan error:", err);
    setStatus("Open a webpage with a form, then scan.");
    setError(
      "Could not access this tab. Reload the page, then click Scan Form again."
    );
  } finally {
    scanBtn.disabled = false;
  }
}

async function fillActiveTab() {
  setError("");
  const fillable = selectedFillable();
  if (!fillable.length) {
    setError("Nothing selected to fill. Tick fields in the review list.");
    return;
  }

  fillBtn.disabled = true;
  scanBtn.disabled = true;
  setStatus(`Filling ${fillable.length} field${fillable.length === 1 ? "" : "s"}…`);

  try {
    const tab = await getActiveTab();
    if (!tab || tab.id == null) {
      setError("No active tab found.");
      return;
    }

    if (lastTabId != null && tab.id !== lastTabId) {
      setError("Active tab changed. Scan this page again before filling.");
      updateFillButton();
      return;
    }

    if (isRestrictedUrl(tab.url || "")) {
      setError("FoxFill can’t fill this page.");
      return;
    }

    const phoneParsed =
      typeof FoxFillPhoneParse !== "undefined"
        ? FoxFillPhoneParse.parsePhone(
            profile.phone || "",
            profile.country || ""
          )
        : null;

    const fills = fillable.map((m) => {
      const value = resolvedFillValue(m);
      const hints = {};
      if (m.profileKey === "phoneCountryCode" || m.compound?.role === "dial") {
        if (phoneParsed?.dialDigits) hints.dialDigits = phoneParsed.dialDigits;
        if (profile.country) hints.country = profile.country;
      }
      return {
        profileKey: m.profileKey,
        value,
        fingerprint: m.fingerprint,
        allowOverwrite: false,
        hints,
        phoneParsed:
          m.profileKey === "phone" || m.fillMode?.startsWith?.("phone")
            ? phoneParsed
            : null,
      };
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        "data/phoneParse.js",
        "data/fitValue.js",
        "content/filler.js",
      ],
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (payload) => {
        if (typeof globalThis.FoxFillFillFields !== "function") {
          return { ok: false, error: "filler unavailable" };
        }
        return globalThis.FoxFillFillFields(payload);
      },
      args: [{ fills }],
    });

    const outcome = results?.[0]?.result;
    if (!outcome || outcome.ok !== true) {
      setError(outcome?.error || "Fill failed. Reload the page and scan again.");
      return;
    }

    console.groupCollapsed("[FoxFill] Fill outcome");
    console.table(outcome.results || []);
    console.groupEnd();

    const parts = [];
    if (outcome.filled) parts.push(`${outcome.filled} filled`);
    if (outcome.already) parts.push(`${outcome.already} already set`);
    if (outcome.skipped) parts.push(`${outcome.skipped} skipped`);
    setStatus(
      parts.length ? `Done — ${parts.join(", ")}.` : "Fill finished.",
      "is-success"
    );
  } catch (err) {
    console.error("FoxFill fill error:", err);
    setError(
      "Could not fill this tab. Reload the page, scan again, then fill."
    );
  } finally {
    scanBtn.disabled = false;
    updateFillButton();
  }
}

scanBtn.addEventListener("click", () => {
  void scanActiveTab();
});

fillBtn.addEventListener("click", () => {
  void fillActiveTab();
});

toggleUnmatched.addEventListener("click", () => {
  const open = toggleUnmatched.getAttribute("aria-expanded") === "true";
  const next = !open;
  toggleUnmatched.setAttribute("aria-expanded", next ? "true" : "false");
  listUnmatched.hidden = !next;
  listUnmatched.classList.toggle("is-collapsed", !next);
});

personalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveProfile(personalForm, personalSaveMsg);
});

addressForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveProfile(addressForm, addressSaveMsg);
});

setupTabs();
updateFillButton();
void loadProfile();
