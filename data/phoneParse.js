/**
 * Deterministic phone parsing helpers (no AI, no external APIs).
 * Splits stored numbers into full / countryCode / national parts.
 */
(function initFoxFillPhoneParse(global) {
  /** Country name → preferred dial code (E.164 without + stored separately). */
  const COUNTRY_TO_DIAL = {
    "south africa": "27",
    "united kingdom": "44",
    "uk": "44",
    "united states": "1",
    "usa": "1",
    "canada": "1",
    "australia": "61",
    "new zealand": "64",
    "india": "91",
    "germany": "49",
    "france": "33",
    "netherlands": "31",
    "ireland": "353",
    "nigeria": "234",
    "kenya": "254",
    "ghana": "233",
    "zimbabwe": "263",
    "botswana": "267",
    "namibia": "264",
    "mozambique": "258",
    "brazil": "55",
    "mexico": "52",
    "spain": "34",
    "italy": "39",
    "portugal": "351",
    "china": "86",
    "japan": "81",
    "singapore": "65",
    "uae": "971",
    "united arab emirates": "971",
  };

  /** Longest-first dial codes for prefix stripping. */
  const DIAL_CODES = [
    "1868", "1869", "1876", "1242", "1246", "1264", "1268", "1284", "1340",
    "1441", "1473", "1649", "1664", "1670", "1671", "1684", "1721", "1758",
    "1767", "1784", "1787", "1809", "1829", "1849", "1939",
    "971", "966", "965", "968", "974", "973", "961", "962", "963", "964",
    "353", "358", "351", "352", "354", "356", "357", "359",
    "234", "233", "254", "255", "256", "258", "260", "263", "264", "267", "268",
    "27", "44", "61", "64", "91", "49", "33", "31", "34", "39", "55", "52",
    "86", "81", "65", "82", "60", "66", "62", "63", "90", "7", "1",
    "20", "21", "22", "23", "24", "25", "26", "28", "29",
    "30", "32", "36", "40", "41", "43", "45", "46", "47", "48",
    "51", "53", "54", "56", "57", "58",
  ].sort((a, b) => b.length - a.length);

  const PHONE_ALIASES = [
    "phone number",
    "telephone",
    "mobile number",
    "mobile",
    "cell phone",
    "cellphone",
    "cell number",
    "contact number",
    "phone",
    "tel",
  ];

  const DIAL_ALIASES = [
    "country region code",
    "country/region code",
    "country / region code",
    "country code",
    "dialing code",
    "dialling code",
    "dial code",
    "phone code",
    "calling code",
    "international code",
    "region code",
  ];

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[*•·]/g, " ")
      .replace(/[_./\\-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function digitsOnly(value) {
    return String(value || "").replace(/\D+/g, "");
  }

  function clueBlob(fingerprint) {
    const fp = fingerprint || {};
    return normalize(
      [fp.label, fp.ariaLabel, fp.name, fp.id, fp.placeholder, fp.nearbyText].join(" ")
    );
  }

  function looksLikePhoneField(fingerprint) {
    if (looksLikeAreaCodeField(fingerprint)) return false;
    if (looksLikeDialCodeField(fingerprint)) return false;
    const auto = normalize(fingerprint.autocomplete || "").replace(/\s+/g, "-");
    if (auto === "tel" || auto.startsWith("tel-")) return true;
    if ((fingerprint.type || "").toLowerCase() === "tel") return true;
    const blob = clueBlob(fingerprint);
    if (/\bresidence\b/.test(blob) && /\bcountry\b/.test(blob)) return false;
    return PHONE_ALIASES.some((a) => {
      const na = normalize(a);
      if (na.length <= 5) {
        return new RegExp(`(?:^|\\s)${na.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`).test(blob);
      }
      return blob.includes(na);
    });
  }

  function looksLikeAreaCodeField(fingerprint) {
    const auto = normalize(fingerprint.autocomplete || "").replace(/\s+/g, "-");
    if (auto.includes("tel-area-code") || auto.endsWith("tel-area")) return true;

    const blob = clueBlob(fingerprint);
    if (!blob) return false;
    if (/\b(country|dial|calling|international)\s+code\b/.test(blob)) return false;
    if (/\bcountry\/region\s+code\b/.test(blob)) return false;
    return (
      /\barea\s*code\b/.test(blob) ||
      /\bareacode\b/.test(blob) ||
      /\bstd\s*code\b/.test(blob)
    );
  }

  function looksLikeLocalPhoneField(fingerprint) {
    const auto = normalize(fingerprint.autocomplete || "").replace(/\s+/g, "-");
    if (auto.includes("tel-local")) return true;
    const blob = clueBlob(fingerprint);
    if (!blob) return false;
    if (looksLikeAreaCodeField(fingerprint)) return false;
    if (/\bmobile\b|\bcell\b/.test(blob)) return false;
    // Standalone "Phone Number" under a home-phone group (not "Mobile")
    return (
      /(?:^|\s)phone number(?:\s|$)/.test(blob) &&
      !/\bmobile\b/.test(blob)
    );
  }

  function phoneKind(fingerprint) {
    if (looksLikeAreaCodeField(fingerprint)) return "area";
    const blob = clueBlob(fingerprint);
    if (/\bmobile\b|\bcell\b/.test(blob)) return "mobile";
    if (/\bhome\b/.test(blob)) return "home";
    if (looksLikeLocalPhoneField(fingerprint)) return "local";
    return "phone";
  }

  function looksLikeDialCodeField(fingerprint) {
    const blob = clueBlob(fingerprint);
    if (!blob) return false;
    if (/\bresidence\b/.test(blob)) return false;
    if (/\barea\s*code\b/.test(blob) && !/\b(country|dial|calling)\b/.test(blob)) {
      return false;
    }
    if (DIAL_ALIASES.some((a) => blob.includes(normalize(a)))) return true;
    if (
      /\b(country|region)\b/.test(blob) &&
      /\bcode\b/.test(blob) &&
      !/\bresidence\b/.test(blob) &&
      !/\bpostal\b/.test(blob) &&
      !/\bzip\b/.test(blob)
    ) {
      return true;
    }
    return false;
  }

  /** True when text is mainly a visible dial prefix like "+27" (not a field name). */
  function isDialPrefixText(text) {
    const raw = String(text || "").trim();
    if (!raw || raw.length > 16) return false;
    if (/^\+\d{1,4}$/.test(raw)) return true;
    if (/^(00|\+)\d{1,4}$/.test(raw.replace(/\s+/g, ""))) return true;
    // Short badges: "ZA +27", "+27 ZA"
    if (raw.length <= 12 && /\+\d{1,4}/.test(raw) && !/[a-z]{4,}/i.test(raw)) {
      return true;
    }
    return false;
  }

  /**
   * Detect a static dial-code chrome next to the input (not a separate fillable control).
   * Returns "+27" style string or "".
   */
  function detectStaticDialPrefix(fingerprint) {
    const fp = fingerprint || {};
    if (fp.staticDialPrefix) {
      const existing = String(fp.staticDialPrefix).trim();
      if (existing) {
        const dig = digitsOnly(existing);
        return dig ? `+${dig}` : existing;
      }
    }

    const sources = [fp.label, fp.nearbyText, fp.ariaLabel, fp.placeholder];
    for (const src of sources) {
      const raw = String(src || "").trim();
      if (!raw) continue;
      // Prefer exact short prefix tokens inside nearby blobs
      const parts = raw.split(/\s+/);
      for (const part of parts) {
        if (isDialPrefixText(part)) {
          const dig = digitsOnly(part);
          if (dig) return `+${dig}`;
        }
      }
      if (isDialPrefixText(raw)) {
        const dig = digitsOnly(raw);
        if (dig) return `+${dig}`;
      }
      // Nearby may start with "+27 …"
      const lead = raw.match(/^\s*\+(\d{1,4})(?:\s|$)/);
      if (lead && raw.length <= 40) {
        return `+${lead[1]}`;
      }
    }
    return "";
  }

  function hasStaticDialPrefix(fingerprint) {
    return Boolean(detectStaticDialPrefix(fingerprint));
  }

  function dialForCountryName(country) {
    const n = normalize(country);
    if (!n) return null;
    if (COUNTRY_TO_DIAL[n]) return COUNTRY_TO_DIAL[n];
    for (const [name, dial] of Object.entries(COUNTRY_TO_DIAL)) {
      if (n.includes(name) || name.includes(n)) return dial;
    }
    return null;
  }

  function extractDialCodesFromText(text) {
    const found = [];
    const re = /\+(\d{1,4})/g;
    let m;
    const raw = String(text || "");
    while ((m = re.exec(raw))) {
      found.push(m[1]);
    }
    return found;
  }

  /**
   * Split a national subscriber number into area/local parts.
   * SA-style mobile: 761234567 → area 076 + local 1234567
   */
  function splitAreaLocal(nationalNumber, dialDigits) {
    let national = digitsOnly(nationalNumber);
    if (!national) {
      return { areaCode: "", localNumber: "", nationalWithZero: "" };
    }
    national = national.replace(/^0+/, "");
    const withZero = `0${national}`;

    // Prefer 3-digit area for ZA-like numbers (0xx + 7 digits)
    if (withZero.length >= 10) {
      return {
        areaCode: withZero.slice(0, 3),
        localNumber: withZero.slice(3),
        nationalWithZero: withZero,
      };
    }
    if (withZero.length >= 7) {
      return {
        areaCode: withZero.slice(0, 3),
        localNumber: withZero.slice(3),
        nationalWithZero: withZero,
      };
    }
    return {
      areaCode: "",
      localNumber: national,
      nationalWithZero: withZero,
    };
  }

  /**
   * @returns {{ fullNumber: string, countryCode: string, nationalNumber: string, dialDigits: string, areaCode: string, localNumber: string, nationalWithZero: string }}
   */
  function parsePhone(phone, countryHint) {
    const raw = String(phone || "").trim();
    const empty = {
      fullNumber: "",
      countryCode: "",
      nationalNumber: "",
      dialDigits: "",
      areaCode: "",
      localNumber: "",
      nationalWithZero: "",
    };
    if (!raw) return empty;

    let digits = digitsOnly(raw);
    if (!digits) return empty;

    const hinted = dialForCountryName(countryHint);
    let dialDigits = "";

    if (raw.includes("+") || raw.trim().startsWith("00")) {
      if (digits.startsWith("00")) digits = digits.slice(2);
      if (hinted && digits.startsWith(hinted) && digits.length > hinted.length + 3) {
        dialDigits = hinted;
      } else {
        for (const code of DIAL_CODES) {
          if (digits.startsWith(code) && digits.length > code.length + 3) {
            dialDigits = code;
            break;
          }
        }
      }
    } else if (hinted && digits.startsWith(hinted) && digits.length > hinted.length + 3) {
      dialDigits = hinted;
    } else if (hinted) {
      const national = digits.replace(/^0+/, "");
      const split = splitAreaLocal(national, hinted);
      return {
        fullNumber: `+${hinted}${national}`,
        countryCode: `+${hinted}`,
        nationalNumber: national,
        dialDigits: hinted,
        ...split,
      };
    }

    if (!dialDigits) {
      const national = digits.replace(/^0+/, "");
      const split = splitAreaLocal(national, "");
      return {
        fullNumber: raw.startsWith("+") ? `+${digits}` : digits,
        countryCode: "",
        nationalNumber: national,
        dialDigits: "",
        ...split,
      };
    }

    const national = digits.slice(dialDigits.length).replace(/^0+/, "");
    const split = splitAreaLocal(national, dialDigits);
    return {
      fullNumber: `+${dialDigits}${national}`,
      countryCode: `+${dialDigits}`,
      nationalNumber: national,
      dialDigits,
      ...split,
    };
  }

  /**
   * Score how well a <select> option matches dial + country hints.
   */
  function scoreDialOption(option, dialDigits, countryHint) {
    const value = String(option.value || "");
    const text = String(option.text || option.textContent || "");
    const blob = normalize(`${value} ${text}`);
    const digVal = digitsOnly(value);
    const digText = digitsOnly(text);
    let score = 0;

    if (!dialDigits) return 0;

    if (value === `+${dialDigits}` || value === dialDigits) score += 100;
    if (digVal === dialDigits || digVal.endsWith(dialDigits)) score += 70;
    if (new RegExp(`(?:^|\\D)${dialDigits}(?:\\D|$)`).test(text.replace(/\s+/g, ""))) {
      score += 60;
    }
    if (text.includes(`+${dialDigits}`) || blob.includes(`+${dialDigits}`)) score += 80;

    const country = normalize(countryHint);
    if (country && blob.includes(country)) score += 50;

    // Prefer real options over placeholders
    if (!value || /select|choose|country/i.test(text)) score -= 40;

    return score;
  }

  function findBestDialOption(options, dialDigits, countryHint) {
    if (!Array.isArray(options) || !dialDigits) return null;
    let best = null;
    let bestScore = 0;
    let second = 0;

    for (const opt of options) {
      const s = scoreDialOption(opt, dialDigits, countryHint);
      if (s > bestScore) {
        second = bestScore;
        bestScore = s;
        best = opt;
      } else if (s > second) {
        second = s;
      }
    }

    if (!best || bestScore < 60) return null;
    if (bestScore - second < 15 && second >= 60) return null; // ambiguous
    return {
      value: best.value,
      text: best.text || best.textContent || "",
      score: bestScore,
    };
  }

  global.FoxFillPhoneParse = {
    COUNTRY_TO_DIAL,
    PHONE_ALIASES,
    DIAL_ALIASES,
    normalize,
    digitsOnly,
    clueBlob,
    looksLikePhoneField,
    looksLikeAreaCodeField,
    looksLikeLocalPhoneField,
    phoneKind,
    looksLikeDialCodeField,
    isDialPrefixText,
    detectStaticDialPrefix,
    hasStaticDialPrefix,
    dialForCountryName,
    extractDialCodesFromText,
    splitAreaLocal,
    parsePhone,
    scoreDialOption,
    findBestDialOption,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
