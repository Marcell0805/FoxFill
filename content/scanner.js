/**
 * Phase 2+: collect field fingerprints for fillable controls.
 * Matching (Phase 3+) runs when FoxFillMatchFields is available in this world.
 * Injected on demand via activeTab + scripting — never runs silently.
 */
(function scanFieldFingerprints() {
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

  const MAX_NEARBY = 80;
  const MAX_PARENT = 60;

  function cleanText(value) {
    if (!value) return "";
    return String(value).replace(/\s+/g, " ").trim();
  }

  function truncate(value, max) {
    const text = cleanText(value);
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}…`;
  }

  function isVisible(el) {
    if (!el || el.disabled) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function labelFromFor(el) {
    if (!el.id) return "";
    const escaped =
      typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(el.id)
        : el.id.replace(/"/g, '\\"');
    const label = document.querySelector(`label[for="${escaped}"]`);
    return label ? cleanText(label.textContent) : "";
  }

  function labelFromWrap(el) {
    const label = el.closest("label");
    if (!label) return "";
    const clone = label.cloneNode(true);
    clone.querySelectorAll("input, textarea, select, button").forEach((node) => {
      node.remove();
    });
    return cleanText(clone.textContent);
  }

  function labelFromAria(el) {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (!labelledBy) return "";
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((node) => cleanText(node.textContent))
      .filter(Boolean);
    return parts.join(" ");
  }

  function looksLikeLabelText(text) {
    const t = cleanText(text);
    if (!t) return false;
    if (t.length < 2 || t.length > 64) return false;
    // Avoid grabbing whole card/section copy
    if ((t.match(/\s+/g) || []).length > 8) return false;
    return true;
  }

  function labelFromProximity(el) {
    const candidates = [];

    function consider(node) {
      if (!node || node === el) return;
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (/^(INPUT|TEXTAREA|SELECT|BUTTON|SCRIPT|STYLE|BR|HR|SVG|IMG)$/i.test(node.tagName)) {
          return;
        }
        if (node.querySelector && node.querySelector("input, textarea, select")) {
          return;
        }
        const text = cleanText(node.textContent);
        if (looksLikeLabelText(text)) candidates.push(text);
      } else if (node.nodeType === Node.TEXT_NODE) {
        const text = cleanText(node.textContent);
        if (looksLikeLabelText(text)) candidates.push(text);
      }
    }

    let sib = el.previousElementSibling;
    for (let i = 0; sib && i < 3; i += 1, sib = sib.previousElementSibling) {
      consider(sib);
    }

    const parent = el.parentElement;
    if (parent) {
      for (const child of parent.childNodes) {
        if (child === el) break;
        consider(child);
      }

      // Common pattern: wrapper > (label-row + input-row)
      const uncle = parent.previousElementSibling;
      consider(uncle);

      // class*=label inside the same field group
      for (const node of parent.querySelectorAll("*")) {
        if (node === el || node.contains(el)) continue;
        const cls = typeof node.className === "string" ? node.className.toLowerCase() : "";
        if (!cls.includes("label") && node.getAttribute("data-label") == null) continue;
        if (el.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) continue;
        consider(node);
      }
    }

    // Prefer the closest short label (last candidate is often nearest preceding).
    if (!candidates.length) return "";
    return candidates[candidates.length - 1];
  }

  function isDialPrefixLabel(text) {
    const raw = String(text || "").trim();
    if (!raw || raw.length > 16) return false;
    if (/^\+\d{1,4}$/.test(raw)) return true;
    if (raw.length <= 12 && /^\+?\d{1,4}$/.test(raw.replace(/\s+/g, ""))) return true;
    if (raw.length <= 12 && /\+\d{1,4}/.test(raw) && !/[a-z]{4,}/i.test(raw)) {
      return true;
    }
    return false;
  }

  function detectStaticDialPrefixFromEl(el) {
    const bits = [];
    const prev = el.previousElementSibling;
    if (prev && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/i.test(prev.tagName)) {
      bits.push(cleanText(prev.textContent));
    }
    const parent = el.parentElement;
    if (parent) {
      for (const child of parent.childNodes) {
        if (child === el) break;
        if (child.nodeType === Node.TEXT_NODE) {
          bits.push(cleanText(child.textContent));
        } else if (
          child.nodeType === Node.ELEMENT_NODE &&
          !child.querySelector("input, textarea, select")
        ) {
          bits.push(cleanText(child.textContent));
        }
      }
    }
    for (const bit of bits) {
      if (!bit) continue;
      if (isDialPrefixLabel(bit)) {
        const dig = String(bit).replace(/\D+/g, "");
        if (dig) return `+${dig}`;
      }
      const m = String(bit).trim().match(/^\+(\d{1,4})\b/);
      if (m) return `+${m[1]}`;
    }
    return "";
  }

  function resolveLabel(el) {
    const candidates = [
      labelFromFor(el),
      labelFromWrap(el),
      labelFromAria(el),
      labelFromProximity(el),
    ].filter(Boolean);

    const preferred = candidates.find((c) => !isDialPrefixLabel(c));
    return preferred || candidates[0] || "";
  }

  function nearbyText(el) {
    const bits = [];

    const prev = el.previousElementSibling;
    if (prev && !/^(INPUT|TEXTAREA|SELECT|BUTTON|SCRIPT|STYLE)$/i.test(prev.tagName)) {
      bits.push(cleanText(prev.textContent));
    }

    const parent = el.parentElement;
    if (parent) {
      for (const child of parent.childNodes) {
        if (child === el) break;
        if (child.nodeType === Node.TEXT_NODE) {
          bits.push(cleanText(child.textContent));
        } else if (
          child.nodeType === Node.ELEMENT_NODE &&
          /^(SPAN|DIV|P|STRONG|B|LABEL|LEGEND|SMALL)$/i.test(child.tagName)
        ) {
          if (!child.querySelector("input, textarea, select")) {
            bits.push(cleanText(child.textContent));
          }
        }
      }

      const uncle = parent.previousElementSibling;
      if (
        uncle &&
        !uncle.querySelector("input, textarea, select") &&
        looksLikeLabelText(uncle.textContent)
      ) {
        bits.push(cleanText(uncle.textContent));
      }
    }

    const fieldset = el.closest("fieldset");
    if (fieldset) {
      const legend = fieldset.querySelector(":scope > legend");
      if (legend) bits.push(cleanText(legend.textContent));
    }

    return truncate(bits.filter(Boolean).join(" "), MAX_NEARBY);
  }

  function parentContext(el) {
    const parent = el.parentElement;
    if (!parent) return "";
    const tag = parent.tagName.toLowerCase();
    const id = parent.id ? `#${parent.id}` : "";
    const className =
      typeof parent.className === "string" && parent.className.trim()
        ? `.${parent.className.trim().split(/\s+/).slice(0, 2).join(".")}`
        : "";
    return truncate(`${tag}${id}${className}`, MAX_PARENT);
  }

  function hasExistingValue(el) {
    if (el instanceof HTMLSelectElement) {
      return Boolean(el.value && el.value.trim());
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return Boolean(el.value && el.value.trim());
    }
    return false;
  }

  function extractHeadingText(node) {
    if (!node) return "";
    if (/^H[1-6]$/i.test(node.tagName) || node.tagName === "LEGEND") {
      return cleanText(node.textContent);
    }
    const inner = node.querySelector?.(
      "h1, h2, h3, h4, h5, h6, legend, .form-header-group, .header-text, [class*='section-title']"
    );
    if (inner) {
      const t = cleanText(inner.textContent);
      if (t && t.length <= 100) return t;
    }
    const cls = `${node.className || ""} ${node.getAttribute?.("data-type") || ""}`;
    if (/header|section|control_head/i.test(cls)) {
      const t = cleanText(node.textContent);
      if (t && t.length >= 3 && t.length <= 100) return t;
    }
    return "";
  }

  /**
   * Nearest preceding section title in document order (works for Jotform-style
   * header rows where the <h2> sits inside a previous sibling).
   */
  function sectionHeading(el) {
    const candidates = document.querySelectorAll(
      "h1, h2, h3, h4, h5, h6, legend, [data-type='control_head'], .form-header-group, .form-section, .form-section-header"
    );

    let best = "";
    for (const node of candidates) {
      if (!node || node === el || node.contains(el)) continue;
      const pos = el.compareDocumentPosition(node);
      if (!(pos & Node.DOCUMENT_POSITION_PRECEDING)) continue;
      const text = extractHeadingText(node) || cleanText(node.textContent);
      if (text && text.length <= 100) best = text;
    }

    // Fallback: walk previous siblings / ancestors for embedded headings.
    if (!best) {
      let node = el;
      for (let depth = 0; depth < 12 && node && node !== document.body; depth += 1) {
        let sib = node.previousElementSibling;
        let steps = 0;
        while (sib && steps < 20) {
          const text = extractHeadingText(sib);
          if (text) {
            best = text;
            break;
          }
          sib = sib.previousElementSibling;
          steps += 1;
        }
        if (best) break;
        if (node.tagName === "FIELDSET") {
          const legend = node.querySelector(":scope > legend");
          if (legend) best = cleanText(legend.textContent);
        }
        node = node.parentElement;
      }
    }

    return truncate(best, 120);
  }

  function fingerprint(el) {
    const tag = el.tagName.toUpperCase();
    let type = "";
    if (el instanceof HTMLInputElement) {
      type = (el.type || "text").toLowerCase();
    } else if (el instanceof HTMLTextAreaElement) {
      type = "textarea";
    } else if (el instanceof HTMLSelectElement) {
      type = "select";
    }

    const fp = {
      tag,
      type,
      id: el.id || "",
      name: el.getAttribute("name") || "",
      placeholder: el.getAttribute("placeholder") || "",
      autocomplete: (el.getAttribute("autocomplete") || "").trim().toLowerCase(),
      ariaLabel: (el.getAttribute("aria-label") || "").trim(),
      label: resolveLabel(el),
      nearbyText: nearbyText(el),
      staticDialPrefix: detectStaticDialPrefixFromEl(el),
      parentContext: parentContext(el),
      sectionHeading: sectionHeading(el),
      hasValue: hasExistingValue(el),
      maxLength: (() => {
        const attr = el.getAttribute("maxlength");
        if (attr != null && attr !== "") return Number(attr);
        if (typeof el.maxLength === "number" && el.maxLength > 0 && el.maxLength < 500000) {
          return el.maxLength;
        }
        return null;
      })(),
      minLength: (() => {
        const attr = el.getAttribute("minlength");
        return attr != null && attr !== "" ? Number(attr) : null;
      })(),
      pattern: el.getAttribute("pattern") || "",
      inputMode: el.getAttribute("inputmode") || "",
      mask:
        el.getAttribute("data-mask") ||
        el.getAttribute("mask") ||
        el.getAttribute("data-inputmask") ||
        el.getAttribute("data-mask-value") ||
        "",
    };

    if (el instanceof HTMLSelectElement) {
      fp.options = Array.from(el.options)
        .slice(0, 500)
        .map((opt) => ({
          value: opt.value || "",
          text: cleanText(opt.textContent),
        }));
    }

    return fp;
  }

  const nodes = document.querySelectorAll("input, textarea, select");
  const fields = [];
  let ordinal = 0;

  for (const el of nodes) {
    if (el instanceof HTMLInputElement) {
      const type = (el.type || "text").toLowerCase();
      if (SKIP_INPUT_TYPES.has(type)) continue;
    }
    if (!isVisible(el)) continue;
    const fp = fingerprint(el);
    fp.ordinal = ordinal;
    fields.push(fp);
    ordinal += 1;
  }

  let matches =
    typeof globalThis.FoxFillMatchFields === "function"
      ? globalThis.FoxFillMatchFields(fields)
      : fields.map((fp, index) => ({
          index,
          fingerprint: fp,
          status: "unmatched",
          profileKey: null,
          profileLabel: null,
          method: null,
          reason: "matcher unavailable",
          ambiguousWith: [],
        }));

  // Compound phone groups need the profile; popup applies that stage.
  // Still log raw matches here for debugging.
  console.groupCollapsed(
    `[FoxFill] ${fields.length} field fingerprint${fields.length === 1 ? "" : "s"}`
  );
  console.table(
    matches.map((m) => ({
      type: m.fingerprint.type,
      label: m.fingerprint.label,
      section: m.fingerprint.sectionHeading || "",
      status: m.status,
      profile: m.profileKey || "",
      method: m.method || "",
      reason: m.reason || "",
      options: Array.isArray(m.fingerprint.options)
        ? m.fingerprint.options.length
        : 0,
    }))
  );
  console.log("Full matches:", matches);
  console.groupEnd();

  return {
    ok: true,
    fieldCount: fields.length,
    fields,
    matches,
    scannedAt: new Date().toISOString(),
  };
})();
