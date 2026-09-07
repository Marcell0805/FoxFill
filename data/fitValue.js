/**
 * Fit fill values to field constraints (maxLength, pattern, masks).
 * Deterministic — no AI.
 */
(function initFoxFillFitValue(global) {
  function digitsOnly(value) {
    return String(value || "").replace(/\D+/g, "");
  }

  function toInt(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /**
   * Count input-mask slots. Must NOT treat example placeholders like
   * "e.g. 9503310092088" as masks — literal 0/9 in examples used to
   * invent a fake length of 6 and truncate SA IDs to the last 6 digits.
   */
  function maskSlotCount(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;

    // Example / sample placeholders are not masks.
    if (/^(e\.?g\.?|example|sample|ex)\b/i.test(raw)) return null;
    if (/\be\.?g\.\b/i.test(raw) && /\d{6,}/.test(raw)) return null;

    // Underscore / hash / X templates: __________ or ___-___-____
    const unders = raw.match(/_/g);
    if (unders && unders.length >= 6) return unders.length;

    const hashX = raw.match(/[#Xx]/g);
    if (hashX && hashX.length >= 6 && !/\d{5,}/.test(raw)) {
      return hashX.length;
    }

    // Digit-as-slot masks like "000 000 0000" / "999-999-9999"
    // only when the string is almost entirely mask digits + separators.
    const stripped = raw.replace(/[\s\-()./]/g, "");
    if (/^[09#]+$/.test(stripped) && stripped.length >= 6) {
      return stripped.length;
    }

    return null;
  }

  function expectedLen(fingerprint) {
    const fp = fingerprint || {};
    const fromMax = toInt(fp.maxLength);
    // Prefer explicit data-mask / pattern masks; placeholder only if
    // it looks like a real mask template (see maskSlotCount).
    const fromMask =
      maskSlotCount(fp.mask) ||
      maskSlotCount(fp.pattern) ||
      maskSlotCount(fp.placeholder);
    if (fromMask && fromMax) return Math.min(fromMask, fromMax);
    return fromMask || fromMax;
  }

  function allowsPlus(fingerprint) {
    const fp = fingerprint || {};
    const pattern = String(fp.pattern || "");
    const placeholder = String(fp.placeholder || "");
    const mask = String(fp.mask || "");
    if (/\+/.test(`${pattern}${placeholder}${mask}`)) return true;
    if (toInt(fp.maxLength) && toInt(fp.maxLength) >= 12) return true;
    return false;
  }

  function preferDigitsOnly(fingerprint) {
    const fp = fingerprint || {};
    const pattern = String(fp.pattern || "");
    const inputMode = String(fp.inputMode || "").toLowerCase();
    if (inputMode === "numeric" || inputMode === "tel") return true;
    if (/^\\d|\[0-9\]|\\d\{/.test(pattern)) return true;
    if (maskSlotCount(fp.mask) || maskSlotCount(fp.placeholder)) return true;
    return false;
  }

  /**
   * Build phone candidates from a parsed phone / raw profile value.
   */
  function phoneCandidates(rawValue, phoneParsed) {
    const parsed = phoneParsed || {};
    const raw = String(rawValue || "").trim();
    const list = [];

    const push = (v) => {
      const s = String(v || "").trim();
      if (s && !list.includes(s)) list.push(s);
    };

    push(parsed.fullNumber);
    push(parsed.nationalWithZero);
    push(parsed.nationalNumber);
    if (parsed.dialDigits && parsed.nationalNumber) {
      push(`${parsed.dialDigits}${parsed.nationalNumber}`);
      push(`0${parsed.nationalNumber}`);
    }
    push(raw);
    push(digitsOnly(raw));
    if (raw.startsWith("+")) push(digitsOnly(raw));
    return list;
  }

  function fitsConstraint(value, fingerprint) {
    const fp = fingerprint || {};
    const s = String(value ?? "");
    if (!s) return false;

    const max = toInt(fp.maxLength);
    if (max != null && s.length > max) return false;

    const min = toInt(fp.minLength);
    if (min != null && s.length < min) return false;

    const slots = expectedLen(fp);
    if (slots != null) {
      const dig = digitsOnly(s);
      // If field looks digit-oriented, digit count must match slots when slots==max
      // or value length must be <= slots.
      if (preferDigitsOnly(fp)) {
        if (dig.length > slots) return false;
        // Exact mask length when maxlength equals slot count
        if (max != null && max === slots && dig.length !== slots && s.length !== slots) {
          // Allow exact digit match OR exact string length match
          if (dig.length !== slots && s.length !== slots) return false;
        }
      } else if (s.length > slots) {
        return false;
      }
    }

    const pattern = String(fp.pattern || "");
    if (pattern) {
      try {
        const re = new RegExp(`^(?:${pattern})$`);
        if (!re.test(s)) return false;
      } catch {
        // Invalid pattern attribute — ignore
      }
    }

    return true;
  }

  function scoreCandidate(value, fingerprint, profileKey) {
    const fp = fingerprint || {};
    const s = String(value || "");
    if (!fitsConstraint(s, fp)) return -1;

    let score = 100;
    const dig = digitsOnly(s);
    const slots = expectedLen(fp);
    const max = toInt(fp.maxLength);

    if (slots != null && dig.length === slots) score += 40;
    if (max != null && s.length === max) score += 20;
    if (max != null && dig.length === max) score += 25;

    if (profileKey === "phone" || profileKey === "phoneCountryCode") {
      if (allowsPlus(fp) && s.startsWith("+")) score += 10;
      if (!allowsPlus(fp) && s.startsWith("+")) score -= 30;
      if (preferDigitsOnly(fp) && /^\d+$/.test(s)) score += 15;
      // Prefer local/national shapes for short fields
      if (max != null && max <= 10 && s.startsWith("0") && dig.length === 10) {
        score += 35;
      }
      if (max != null && max <= 10 && s.startsWith("+")) score -= 50;
    }

    // Static +CC chrome beside the input — never prefer E.164 full number
    const staticPrefix = String(fp.staticDialPrefix || "").trim();
    if (staticPrefix) {
      if (s.startsWith("+")) score -= 60;
      if (/^\d+$/.test(s) && !s.startsWith("0") && dig.length >= 8 && dig.length <= 11) {
        score += 45;
      }
      if (s.startsWith("0") && dig.length === 10) score += 20;
    }

    return score;
  }

  /**
   * @param {string} value
   * @param {object} fingerprint
   * @param {{ profileKey?: string, phoneParsed?: object, preferNational?: boolean }} options
   */
  function fitValue(value, fingerprint, options) {
    const opts = options || {};
    const profileKey = opts.profileKey || null;
    const optsPreferNational = Boolean(opts.preferNational);
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    const fp = { ...(fingerprint || {}) };
    if (!fp.staticDialPrefix && optsPreferNational) {
      fp.staticDialPrefix = "national";
    }
    // ID numbers: never invent a short length from placeholders / masks.
    // A bogus 6-slot read used to turn 9502541021587 into 021587.
    if (profileKey === "idNumber") {
      const dig = digitsOnly(raw);
      if (dig.length >= 10) return dig;
      return raw;
    }

    const hasConstraints =
      toInt(fp.maxLength) ||
      toInt(fp.minLength) ||
      fp.pattern ||
      fp.mask ||
      maskSlotCount(fp.placeholder) ||
      Boolean(fp.staticDialPrefix);

    if (!hasConstraints) return raw;

    let candidates = [raw];
    if (profileKey === "phone" || opts.phoneParsed || optsPreferNational) {
      candidates = phoneCandidates(raw, opts.phoneParsed);
      if (optsPreferNational || fp.staticDialPrefix) {
        // Prefer national shapes first
        const parsed = opts.phoneParsed || {};
        if (parsed.nationalNumber) candidates.unshift(parsed.nationalNumber);
        if (parsed.nationalWithZero) candidates.unshift(parsed.nationalWithZero);
      }
    } else if (preferDigitsOnly(fp)) {
      candidates = [raw, digitsOnly(raw)];
    }

    // Truncation fallbacks — trailing slice is phone-only (local portion).
    const max = toInt(fp.maxLength);
    const slots = expectedLen(fp);
    const limit = slots || max;
    if (limit) {
      const dig = digitsOnly(raw);
      const isPhone =
        profileKey === "phone" ||
        profileKey === "phoneCountryCode" ||
        opts.phoneParsed ||
        optsPreferNational;

      if (dig.length > limit) {
        if (isPhone) {
          candidates.push(dig.slice(-limit));
        }
        candidates.push(dig.slice(0, limit));
      }
      if (raw.length > limit) {
        candidates.push(raw.slice(0, limit));
      }
      if (isPhone && dig.startsWith("0") && dig.length > limit) {
        candidates.push(dig.slice(0, limit));
      }
      // 10-digit SA national from intl
      if (isPhone && limit === 10 && dig.length >= 9) {
        const national = dig.replace(/^27/, "");
        if (national.length === 9) candidates.push(`0${national}`);
        if (national.length === 10 && national.startsWith("0")) {
          candidates.push(national);
        }
      }
    }

    let best = null;
    let bestScore = -1;
    for (const c of candidates) {
      const score = scoreCandidate(c, fp, profileKey);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    if (best != null && bestScore >= 0) return best;

    // Last resort: truncate to maxlength
    if (max != null && raw.length > max) return raw.slice(0, max);
    return raw;
  }

  function constraintsFromElement(el) {
    if (!el || !el.getAttribute) {
      return {
        maxLength: null,
        minLength: null,
        pattern: "",
        mask: "",
        inputMode: "",
        placeholder: "",
      };
    }
    const maxAttr = el.getAttribute("maxlength");
    const minAttr = el.getAttribute("minlength");
    return {
      maxLength: maxAttr != null && maxAttr !== "" ? Number(maxAttr) : el.maxLength > 0 ? el.maxLength : null,
      minLength: minAttr != null && minAttr !== "" ? Number(minAttr) : null,
      pattern: el.getAttribute("pattern") || "",
      mask:
        el.getAttribute("data-mask") ||
        el.getAttribute("mask") ||
        el.getAttribute("data-inputmask") ||
        el.getAttribute("data-mask-value") ||
        "",
      inputMode: el.getAttribute("inputmode") || "",
      placeholder: el.getAttribute("placeholder") || "",
    };
  }

  global.FoxFillFitValue = fitValue;
  global.FoxFillConstraintsFromElement = constraintsFromElement;
  global.FoxFillExpectedLen = expectedLen;
})(typeof globalThis !== "undefined" ? globalThis : self);
