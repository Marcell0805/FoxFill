/**
 * Phase 5: safe form filling with framework-compatible events.
 * Never submits forms. Never fills passwords. Skips non-empty fields
 * unless allowOverwrite is true.
 */
(function initFoxFillFiller(global) {
  const SKIP_INPUT_TYPES = new Set([
    "hidden",
    "password",
    "submit",
    "button",
    "reset",
    "image",
    "file",
    "checkbox",
    "radio",
    "range",
    "color",
  ]);

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function isVisible(el) {
    if (!el || el.disabled) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function currentValue(el) {
    if (el instanceof HTMLSelectElement) return String(el.value || "").trim();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return String(el.value || "").trim();
    }
    return "";
  }

  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;

    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function dispatchFillEvents(el) {
    el.dispatchEvent(new Event("focus", { bubbles: true }));
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertReplacementText",
        data: el.value,
      })
    );
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function optionMatch(select, desired, hints) {
    const want = normalize(desired);
    const dialDigits =
      hints?.dialDigits ||
      (String(desired || "").match(/\+?(\d{1,4})/) || [])[1] ||
      "";
    const countryHint = hints?.country || "";

    if (Array.isArray(select.options) && (dialDigits || countryHint)) {
      const parse = global.FoxFillPhoneParse;
      if (parse?.findBestDialOption) {
        const options = Array.from(select.options).map((opt) => ({
          value: opt.value || "",
          text: String(opt.textContent || "").replace(/\s+/g, " ").trim(),
        }));
        const best = parse.findBestDialOption(options, dialDigits, countryHint);
        if (best) return best.value;
      }
    }

    if (!want) return null;

    for (const opt of Array.from(select.options)) {
      if (normalize(opt.value) === want) return opt.value;
    }
    for (const opt of Array.from(select.options)) {
      if (normalize(opt.textContent) === want) return opt.value;
    }

    // Dial-code aware fallback: +27 / 27 inside option text
    if (dialDigits) {
      for (const opt of Array.from(select.options)) {
        const text = String(opt.textContent || "");
        const val = String(opt.value || "");
        if (
          text.includes(`+${dialDigits}`) ||
          val === dialDigits ||
          val === `+${dialDigits}` ||
          new RegExp(`(?:^|\\D)${dialDigits}(?:\\D|$)`).test(val)
        ) {
          return opt.value;
        }
      }
    }

    for (const opt of Array.from(select.options)) {
      const text = normalize(opt.textContent);
      const val = normalize(opt.value);
      if (text.includes(want) || want.includes(text) || val.includes(want)) {
        return opt.value;
      }
    }
    return null;
  }

  function applyValue(el, value, hints) {
    if (el instanceof HTMLSelectElement) {
      const matched = optionMatch(el, value, hints);
      if (matched == null) {
        return { ok: false, reason: "no matching option" };
      }
      setNativeValue(el, matched);
      dispatchFillEvents(el);
      return { ok: true, reason: "filled select" };
    }

    setNativeValue(el, value);
    dispatchFillEvents(el);
    return { ok: true, reason: "filled" };
  }

  function candidates() {
    return Array.from(document.querySelectorAll("input, textarea, select")).filter(
      (el) => {
        if (el instanceof HTMLInputElement) {
          const type = (el.type || "text").toLowerCase();
          if (SKIP_INPUT_TYPES.has(type)) return false;
        }
        return isVisible(el);
      }
    );
  }

  function scoreElement(el, fingerprint) {
    let score = 0;
    const fp = fingerprint || {};

    if (fp.id && el.id && el.id === fp.id) score += 100;
    if (fp.name && el.getAttribute("name") === fp.name) score += 80;

    const tag = (el.tagName || "").toUpperCase();
    if (fp.tag && tag === String(fp.tag).toUpperCase()) score += 10;

    let type = "";
    if (el instanceof HTMLInputElement) type = (el.type || "text").toLowerCase();
    else if (el instanceof HTMLTextAreaElement) type = "textarea";
    else if (el instanceof HTMLSelectElement) type = "select";
    if (fp.type && type === String(fp.type).toLowerCase()) score += 10;

    if (
      fp.autocomplete &&
      normalize(el.getAttribute("autocomplete")) === normalize(fp.autocomplete)
    ) {
      score += 20;
    }

    if (fp.placeholder && el.getAttribute("placeholder") === fp.placeholder) {
      score += 15;
    }

    return score;
  }

  function findElement(fingerprint, used) {
    const list = candidates().filter((el) => !used.has(el));
    if (!list.length) return null;

    let best = null;
    let bestScore = 0;
    for (const el of list) {
      const s = scoreElement(el, fingerprint);
      if (s > bestScore) {
        bestScore = s;
        best = el;
      }
    }

    // Require a solid identity match (id or name) to avoid wrong fills.
    if (!best || bestScore < 80) return null;
    return best;
  }

  /**
   * @param {{ fills: Array<{ value: string, fingerprint: object, allowOverwrite?: boolean, profileKey?: string }> }} payload
   */
  function fillFields(payload) {
    const fills = Array.isArray(payload?.fills) ? payload.fills : [];
    const used = new Set();
    const results = [];

    for (const item of fills) {
      const value = String(item.value || "").trim();
      const fingerprint = item.fingerprint || {};
      const allowOverwrite = Boolean(item.allowOverwrite);

      if (!value) {
        results.push({
          ok: false,
          profileKey: item.profileKey || null,
          reason: "empty profile value",
        });
        continue;
      }

      const el = findElement(fingerprint, used);
      if (!el) {
        results.push({
          ok: false,
          profileKey: item.profileKey || null,
          reason: "element not found",
        });
        continue;
      }

      used.add(el);

      const live = global.FoxFillConstraintsFromElement
        ? global.FoxFillConstraintsFromElement(el)
        : {};
      const mergedFp = {
        ...fingerprint,
        maxLength: live.maxLength ?? fingerprint.maxLength,
        minLength: live.minLength ?? fingerprint.minLength,
        pattern: live.pattern || fingerprint.pattern,
        mask: live.mask || fingerprint.mask,
        inputMode: live.inputMode || fingerprint.inputMode,
        placeholder: live.placeholder || fingerprint.placeholder,
      };

      let nextValue = value;
      if (typeof global.FoxFillFitValue === "function") {
        nextValue = global.FoxFillFitValue(value, mergedFp, {
          profileKey: item.profileKey || null,
          phoneParsed: item.phoneParsed || null,
        });
      }

      const existing = currentValue(el);
      if (existing && existing !== nextValue && !allowOverwrite) {
        results.push({
          ok: false,
          profileKey: item.profileKey || null,
          reason: "skipped existing value",
        });
        continue;
      }

      if (existing && existing === nextValue) {
        results.push({
          ok: true,
          profileKey: item.profileKey || null,
          reason: "already filled",
        });
        continue;
      }

      const applied = applyValue(el, nextValue, item.hints || null);
      results.push({
        ok: applied.ok,
        profileKey: item.profileKey || null,
        reason:
          applied.ok && nextValue !== value
            ? `${applied.reason} (fitted ${value} → ${nextValue})`
            : applied.reason,
        filledValue: nextValue,
      });
    }

    const filled = results.filter((r) => r.ok && r.reason !== "already filled").length;
    const already = results.filter((r) => r.reason === "already filled").length;
    const skipped = results.filter((r) => !r.ok).length;

    console.groupCollapsed(
      `[FoxFill] Fill complete — ${filled} filled, ${already} already set, ${skipped} skipped`
    );
    console.table(results);
    console.groupEnd();

    return {
      ok: true,
      filled,
      already,
      skipped,
      results,
    };
  }

  global.FoxFillFillFields = fillFields;
})(typeof globalThis !== "undefined" ? globalThis : self);
