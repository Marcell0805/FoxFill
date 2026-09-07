/**
 * FoxFill popup — Phase 8: multi-profile + review polish.
 */

const scanBtn = document.getElementById("scanBtn");
const fillBtn = document.getElementById("fillBtn");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const errorEl = document.getElementById("error");
const reviewEl = document.getElementById("review");
const emptyStateEl = document.getElementById("emptyState");
const profileNudgeEl = document.getElementById("profileNudge");
const nudgePersonalBtn = document.getElementById("nudgePersonal");
const profileSelect = document.getElementById("profileSelect");
const profileNewBtn = document.getElementById("profileNewBtn");
const profileRenameBtn = document.getElementById("profileRenameBtn");
const profileDeleteBtn = document.getElementById("profileDeleteBtn");
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

/** @type {object|null} */
let profileStore = null;

/** @type {object[]|null} */
let lastMatches = null;

/** @type {number|null} */
let lastTabId = null;

/** @type {Set<number>} */
let selectedIndexes = new Set();

function emptyProfile() {
  return Object.fromEntries(PROFILE_KEYS.map((key) => [key, ""]));
}

function activeProfileName() {
  const active = FoxFillProfiles?.getActive?.(profileStore);
  return active?.name || "Personal";
}

function setError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.classList.remove("is-success", "is-empty", "is-error");
  if (kind) statusEl.classList.add(kind);
}

function profileFilledCount() {
  return PROFILE_KEYS.filter((key) => String(profile[key] || "").trim()).length;
}

function isProfileThin() {
  return profileFilledCount() < 2;
}

function showEmptyState(show, title, body) {
  if (!emptyStateEl) return;
  emptyStateEl.hidden = !show;
  if (show) {
    const titleEl = emptyStateEl.querySelector(".empty-title");
    const bodyEl = emptyStateEl.querySelector(".empty-body");
    if (titleEl) {
      titleEl.textContent = title || "Ready when you are";
    }
    if (bodyEl) {
      bodyEl.textContent =
        body ||
        "Pick a profile above, save Personal and Address details, open a form page, then hit Scan Form.";
    }
  }
}

function updateProfileNudge() {
  if (!profileNudgeEl) return;
  profileNudgeEl.hidden = !isProfileThin() || !lastMatches;
}

function restrictedPageMessage(url) {
  const u = String(url || "");
  if (u.startsWith("chrome://") || u.startsWith("edge://") || u.startsWith("about:")) {
    return "This is a browser page. Open a normal website with a form, then scan.";
  }
  if (u.startsWith("chrome-extension://") || u.startsWith("devtools://")) {
    return "FoxFill can’t scan extension or DevTools pages.";
  }
  if (
    u.startsWith("https://chrome.google.com/webstore") ||
    u.startsWith("https://chromewebstore.google.com")
  ) {
    return "Chrome Web Store pages can’t be scanned. Open your form site instead.";
  }
  if (u.startsWith("file:")) {
    return "Local files sometimes block scripts. If scan fails, host the page or use a normal http(s) site.";
  }
  return "FoxFill can’t scan this page. Open a normal website and try again.";
}

function activateTab(id) {
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".panel");
  tabs.forEach((t) => {
    const active = t.dataset.tab === id;
    t.classList.toggle("is-active", active);
    t.setAttribute("aria-selected", active ? "true" : "false");
  });
  panels.forEach((panel) => {
    const active = panel.dataset.panel === id;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
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
    fillBtn.classList.remove("is-ready");
    fillBtn.textContent = "Fill Fields";
    return;
  }
  fillBtn.hidden = false;
  fillBtn.disabled = false;
  fillBtn.classList.add("is-ready");
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

function displayTitle(match) {
  const fp = match.fingerprint || {};
  const clue = primaryClue(fp);
  // Prefer profile field name over example placeholders once matched.
  if (
    match.profileLabel &&
    (/^(e\.?g\.?|example|sample)\b/i.test(clue) || clue === "(no clues)")
  ) {
    return match.profileLabel;
  }
  return clue;
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
    const fitBit = match.fitted
      ? match.fingerprint?.maxLength != null
        ? ` · fits maxlen ${match.fingerprint.maxLength}`
        : " · fitted"
      : "";
    return {
      pill: "Will fill",
      pillClass: "pill-matched",
      detail: `${label}${compoundBit}${fitBit}`,
      fillValue: match.fillLabel || fillVal || "(empty in profile)",
    };
  }
  if (match.status === "needs_review") {
    const keyBit = match.profileLabel || match.profileKey || "Possible match";
    const reason = match.reason || "Needs review";
    const shortReason =
      reason.length > 72 ? `${reason.slice(0, 69)}…` : reason;
    return {
      pill: "Check",
      pillClass: "pill-review",
      detail: `${keyBit} · ${shortReason}`,
      fillValue: match.fillLabel || fillVal || "",
    };
  }
  return {
    pill: "Not matched",
    pillClass: "pill-none",
    detail: match.reason || "No confident match",
    fillValue: "",
  };
}

function createFieldItem(match, options) {
  const { selectable, checked, disabled } = options;
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
      `Include ${displayTitle(match)} when filling`
    );
    input.addEventListener("change", () => {
      if (input.checked) selectedIndexes.add(match.index);
      else selectedIndexes.delete(match.index);
      updateFillButton();
      if (lastMatches) updateSummary(lastMatches);
    });

    const title = document.createElement("span");
    title.className = "field-title";
    title.textContent = displayTitle(match);

    label.append(input, title);
    top.append(label);
  } else {
    const title = document.createElement("span");
    title.className = "field-title";
    title.textContent = displayTitle(match);
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

  if (meta.fillValue) {
    const valueEl = document.createElement("div");
    valueEl.className = "field-value";
    valueEl.textContent = meta.fillValue;
    valueEl.title = meta.fillValue;
    li.append(valueEl);
  }

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
  updateProfileNudge();
  showEmptyState(false);
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
  updateProfileNudge();
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
  if (typeof FoxFillProfiles === "undefined") {
    profile = emptyProfile();
    return;
  }
  profileStore = await FoxFillProfiles.loadStore(PROFILE_KEYS);
  const active = FoxFillProfiles.getActive(profileStore);
  profile = { ...emptyProfile(), ...(active?.data || {}) };
  renderProfileSelect();
  fillFormsFromProfile();
  updateProfileNudge();
  if (lastMatches) {
    refreshMatchesForActiveProfile();
  }
}

function renderProfileSelect() {
  if (!profileSelect || !profileStore || typeof FoxFillProfiles === "undefined") {
    return;
  }
  const list = FoxFillProfiles.listProfiles(profileStore);
  const activeId = profileStore.activeProfileId;
  profileSelect.innerHTML = "";
  for (const p of list) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === activeId) opt.selected = true;
    profileSelect.append(opt);
  }
  if (profileDeleteBtn) {
    profileDeleteBtn.disabled = list.length <= 1;
  }
}

function applyActiveProfileToUi() {
  const active = FoxFillProfiles.getActive(profileStore);
  profile = { ...emptyProfile(), ...(active?.data || {}) };
  fillFormsFromProfile();
  updateProfileNudge();
  refreshMatchesForActiveProfile();
}

function refreshMatchesForActiveProfile() {
  if (!lastMatches) return;
  // Re-run compounds per frame using current profile values.
  const byFrame = new Map();
  for (const m of lastMatches) {
    const fid = m.frameId ?? 0;
    if (!byFrame.has(fid)) byFrame.set(fid, []);
    byFrame.get(fid).push(m);
  }
  const rebuilt = [];
  let globalIndex = 0;
  for (const [frameId, raw] of byFrame) {
    let local = raw.map((m, i) => ({
      ...m,
      index: i,
      frameId,
      compound: undefined,
      fillMode: undefined,
      fillValue: m.profileKey === "phone" ? undefined : m.fillValue,
    }));
    if (typeof FoxFillApplyPhoneCompounds === "function") {
      local = FoxFillApplyPhoneCompounds(local, {
        phone: profile.phone || "",
        country: profile.country || "",
        dateOfBirth: profile.dateOfBirth || "",
      });
    }
    const localToGlobal = new Map();
    for (const m of local) {
      localToGlobal.set(m.index, globalIndex);
      rebuilt.push({
        ...m,
        index: globalIndex,
        frameId,
        localIndex: m.index,
      });
      globalIndex += 1;
    }
    for (const m of rebuilt) {
      if (m.frameId !== frameId) continue;
      if (m.compound && m.compound.pairedIndex != null) {
        const mapped = localToGlobal.get(m.compound.pairedIndex);
        if (mapped != null) {
          m.compound = { ...m.compound, pairedIndex: mapped };
        }
      }
    }
  }
  lastMatches = rebuilt;
  renderMatches(lastMatches);
}

async function persistStore() {
  if (!profileStore || typeof FoxFillProfiles === "undefined") return;
  await FoxFillProfiles.saveStore(profileStore);
}

async function saveProfile(fromForm, msgEl) {
  readFormIntoProfile(fromForm);
  readFormIntoProfile(
    fromForm === personalForm ? addressForm : personalForm
  );
  if (profileStore && typeof FoxFillProfiles !== "undefined") {
    FoxFillProfiles.upsertActiveData(profileStore, profile, PROFILE_KEYS);
    await persistStore();
  }
  msgEl.hidden = false;
  window.setTimeout(() => {
    msgEl.hidden = true;
  }, 1600);
  updateProfileNudge();
  refreshMatchesForActiveProfile();
}

async function switchProfile(profileId) {
  if (!profileStore || typeof FoxFillProfiles === "undefined") return;
  // Keep unsaved form edits on the outgoing profile
  readFormIntoProfile(personalForm);
  readFormIntoProfile(addressForm);
  FoxFillProfiles.upsertActiveData(profileStore, profile, PROFILE_KEYS);
  FoxFillProfiles.setActive(profileStore, profileId);
  await persistStore();
  applyActiveProfileToUi();
  renderProfileSelect();
  setStatus(`Switched to “${activeProfileName()}”.`, "is-success");
}

async function createProfile() {
  if (!profileStore || typeof FoxFillProfiles === "undefined") return;
  const name = window.prompt("Name for the new profile", "Work");
  if (name == null) return;
  const trimmed = String(name).trim();
  if (!trimmed) return;

  readFormIntoProfile(personalForm);
  readFormIntoProfile(addressForm);
  FoxFillProfiles.upsertActiveData(profileStore, profile, PROFILE_KEYS);

  const copy = window.confirm(
    `Copy details from “${activeProfileName()}” into the new profile?\n\nOK = copy · Cancel = start blank`
  );
  FoxFillProfiles.addProfile(profileStore, trimmed, PROFILE_KEYS, copy);
  await persistStore();
  applyActiveProfileToUi();
  renderProfileSelect();
  setStatus(`Created “${trimmed}”.`, "is-success");
  activateTab("personal");
}

async function renameActiveProfile() {
  if (!profileStore || typeof FoxFillProfiles === "undefined") return;
  const active = FoxFillProfiles.getActive(profileStore);
  if (!active) return;
  const name = window.prompt("Rename profile", active.name);
  if (name == null) return;
  const trimmed = String(name).trim();
  if (!trimmed) return;
  FoxFillProfiles.renameProfile(profileStore, active.id, trimmed);
  await persistStore();
  renderProfileSelect();
  setStatus(`Renamed to “${trimmed}”.`, "is-success");
}

async function deleteActiveProfile() {
  if (!profileStore || typeof FoxFillProfiles === "undefined") return;
  const active = FoxFillProfiles.getActive(profileStore);
  if (!active) return;
  const list = FoxFillProfiles.listProfiles(profileStore);
  if (list.length <= 1) {
    setError("You need at least one profile.");
    return;
  }
  const ok = window.confirm(
    `Delete profile “${active.name}”? This can’t be undone.`
  );
  if (!ok) return;
  const result = FoxFillProfiles.deleteProfile(
    profileStore,
    active.id,
    PROFILE_KEYS
  );
  if (!result.ok) {
    setError("Couldn’t delete that profile.");
    return;
  }
  await persistStore();
  applyActiveProfileToUi();
  renderProfileSelect();
  setStatus(`Deleted. Now using “${activeProfileName()}”.`, "is-success");
}

function setupProfileControls() {
  if (profileSelect) {
    profileSelect.addEventListener("change", () => {
      void switchProfile(profileSelect.value);
    });
  }
  if (profileNewBtn) {
    profileNewBtn.addEventListener("click", () => {
      void createProfile();
    });
  }
  if (profileRenameBtn) {
    profileRenameBtn.addEventListener("click", () => {
      void renameActiveProfile();
    });
  }
  if (profileDeleteBtn) {
    profileDeleteBtn.addEventListener("click", () => {
      void deleteActiveProfile();
    });
  }
}

function setupTabs() {
  const tabs = document.querySelectorAll(".tab");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activateTab(tab.dataset.tab);
    });
  });

  if (nudgePersonalBtn) {
    nudgePersonalBtn.addEventListener("click", () => activateTab("personal"));
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

/**
 * Merge scan results from every frame (Discovery quote forms live in iframes).
 * Phone compounds are applied per-frame so dial companions stay paired.
 */
function collectMatchesFromFrames(results) {
  const buckets = new Map();
  let framesScanned = 0;
  let framesWithFields = 0;

  for (const entry of results || []) {
    framesScanned += 1;
    const payload = entry?.result;
    if (!payload || payload.ok !== true || !Array.isArray(payload.matches)) {
      continue;
    }
    const frameId = entry.frameId ?? 0;
    if (payload.matches.length) framesWithFields += 1;
    if (!buckets.has(frameId)) buckets.set(frameId, []);
    for (const match of payload.matches) {
      buckets.get(frameId).push({
        ...match,
        frameId,
        frameHref: payload.frame?.href || "",
      });
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

    const localToGlobal = new Map();
    for (const m of local) {
      localToGlobal.set(m.index, globalIndex);
      merged.push({
        ...m,
        index: globalIndex,
        frameId,
        localIndex: m.index,
      });
      globalIndex += 1;
    }

    for (const m of merged) {
      if (m.frameId !== frameId) continue;
      if (m.compound && m.compound.pairedIndex != null) {
        const mapped = localToGlobal.get(m.compound.pairedIndex);
        if (mapped != null) {
          m.compound = { ...m.compound, pairedIndex: mapped };
        }
      }
    }
  }

  return { matches: merged, framesScanned, framesWithFields };
}

async function scanActiveTab() {
  setError("");
  setStatus("Scanning this page…");
  clearReview();
  showEmptyState(false);
  lastMatches = null;
  lastTabId = null;
  scanBtn.disabled = true;

  try {
    const tab = await getActiveTab();
    if (!tab || tab.id == null) {
      setStatus("No active tab to scan.", "is-error");
      setError("Open a webpage in this window, then try Scan Form again.");
      showEmptyState(true);
      return;
    }

    if (isRestrictedUrl(tab.url || "")) {
      setStatus("This page can’t be scanned.", "is-error");
      setError(restrictedPageMessage(tab.url || ""));
      showEmptyState(true);
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: [
        "data/fieldPatterns.js",
        "data/phoneParse.js",
        "data/dateFormat.js",
        "data/fitValue.js",
        "content/matcher.js",
        "content/scanner.js",
      ],
    });

    const collected = collectMatchesFromFrames(results);
    let matches = collected.matches;

    if (!results?.length) {
      setStatus("Scan didn’t return fields.", "is-error");
      setError("Reload the webpage, then click Scan Form again.");
      showEmptyState(true);
      return;
    }

    lastMatches = matches;
    lastTabId = tab.id;

    const count = matches.length;
    const willFill = matches.filter((m) => isWillFill(m)).length;
    const review = matches.filter((m) => m.status === "needs_review").length;

    console.groupCollapsed(
      `[FoxFill] Review — ${count} fields across ${collected.framesWithFields}/${collected.framesScanned} frames`
    );
    console.table(
      matches.map((m) => ({
        label: primaryClue(m.fingerprint),
        status: m.status,
        profile: m.profileKey || "",
        fill: resolvedFillValue(m),
        mode: m.fillMode || m.compound?.scenario || "",
        frame: m.frameId,
        score: m.score || 0,
      }))
    );
    console.log("Full matches:", matches);
    console.groupEnd();

    if (count === 0) {
      setStatus("No fillable fields on this page.", "is-empty");
      setError("");
      showEmptyState(
        true,
        "Nothing to fill here",
        collected.framesScanned > 1
          ? "Scanned nested frames too, but found no usable inputs. The form may still be loading — wait a second and scan again."
          : "No text inputs found. If the form is inside a login wall or still loading, wait and scan again."
      );
      return;
    }

    renderMatches(matches);

    if (willFill === 0 && review === 0) {
      setStatus(
        `Found ${count} fields, but none matched your profile confidently.`,
        "is-empty"
      );
    } else if (willFill === 0 && review > 0) {
      setStatus(
        `Found ${count} fields — ${review} need a quick check before filling.`,
        "is-empty"
      );
    } else {
      const frameBit =
        collected.framesWithFields > 1
          ? ` across ${collected.framesWithFields} frames`
          : "";
      setStatus(
        `Ready — ${willFill} matched${review ? `, ${review} to review` : ""}${frameBit}.`,
        "is-success"
      );
    }

    if (isProfileThin()) {
      updateProfileNudge();
    }
  } catch (err) {
    console.error("FoxFill scan error:", err);
    setStatus("Couldn’t reach this tab.", "is-error");
    setError(
      "Reload the webpage, open FoxFill again, then click Scan Form."
    );
    showEmptyState(true);
  } finally {
    scanBtn.disabled = false;
  }
}

async function fillActiveTab() {
  setError("");
  fillBtn.classList.remove("is-ready");
  const fillable = selectedFillable();
  if (!fillable.length) {
    setStatus("Nothing selected.", "is-empty");
    setError("Tick fields under Ready or Needs review, then try Fill again.");
    return;
  }

  fillBtn.disabled = true;
  scanBtn.disabled = true;
  setStatus(`Filling ${fillable.length} field${fillable.length === 1 ? "" : "s"}…`);

  try {
    const tab = await getActiveTab();
    if (!tab || tab.id == null) {
      setStatus("No active tab.", "is-error");
      setError("Keep the form page open in this window, then fill again.");
      return;
    }

    if (lastTabId != null && tab.id !== lastTabId) {
      setStatus("Tab changed since scan.", "is-error");
      setError("Scan this page again, then fill.");
      updateFillButton();
      return;
    }

    if (isRestrictedUrl(tab.url || "")) {
      setStatus("This page can’t be filled.", "is-error");
      setError(restrictedPageMessage(tab.url || ""));
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
        frameId: m.frameId ?? 0,
        phoneParsed:
          m.profileKey === "phone" || m.fillMode?.startsWith?.("phone")
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
    let already = 0;
    let skipped = 0;
    const allFillResults = [];

    for (const [frameId, frameFills] of byFrame) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frameId] },
        files: [
          "data/phoneParse.js",
          "data/fitValue.js",
          "content/filler.js",
        ],
      });

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frameId] },
        func: (payload) => {
          if (typeof globalThis.FoxFillFillFields !== "function") {
            return { ok: false, error: "filler unavailable" };
          }
          return globalThis.FoxFillFillFields(payload);
        },
        args: [{ fills: frameFills }],
      });

      const outcome = results?.[0]?.result;
      if (!outcome || outcome.ok !== true) {
        setStatus("Fill didn’t complete.", "is-error");
        setError(
          outcome?.error ||
            "Reload the webpage, scan again, then fill. If the form is in an iframe, wait for it to finish loading."
        );
        return;
      }

      filled += outcome.filled || 0;
      already += outcome.already || 0;
      skipped += outcome.skipped || 0;
      if (Array.isArray(outcome.results)) {
        allFillResults.push(...outcome.results);
      }
    }

    console.groupCollapsed("[FoxFill] Fill outcome");
    console.table(allFillResults);
    console.groupEnd();

    const parts = [];
    if (filled) parts.push(`${filled} filled`);
    if (already) parts.push(`${already} already set`);
    if (skipped) parts.push(`${skipped} skipped`);
    const kind =
      filled > 0
        ? "is-success"
        : skipped > 0 && !already
          ? "is-empty"
          : "is-success";
    setStatus(
      parts.length ? `Done — ${parts.join(", ")}.` : "Fill finished.",
      kind
    );
    if (skipped > 0) {
      setError(
        "Some fields already had values and were left alone. Clear them on the page if you want FoxFill to overwrite."
      );
    }
  } catch (err) {
    console.error("FoxFill fill error:", err);
    setStatus("Couldn’t fill this tab.", "is-error");
    setError(
      "Reload the webpage, scan again, then fill."
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
setupProfileControls();
updateFillButton();
void loadProfile();
