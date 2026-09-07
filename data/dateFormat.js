/**
 * Deterministic date parsing/formatting for DOB fills.
 */
(function initFoxFillDateFormat(global) {
  function digits(value) {
    return String(value || "").replace(/\D+/g, "");
  }

  function normalizePattern(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/yyyy/g, "y")
      .replace(/yy/g, "y")
      .replace(/mm/g, "m")
      .replace(/dd/g, "d");
  }

  function detectPattern(fingerprint) {
    const blob = [
      fingerprint?.placeholder,
      fingerprint?.ariaLabel,
      fingerprint?.label,
      fingerprint?.nearbyText,
    ]
      .filter(Boolean)
      .join(" ");

    const n = String(blob).toLowerCase();
    if (/dd[\/.\-]\s*mm[\/.\-]\s*yyyy|dd\s*-\s*mm\s*-\s*yyyy/.test(n)) {
      return "DD-MM-YYYY";
    }
    if (/mm[\/.\-]\s*dd[\/.\-]\s*yyyy|mm\s*-\s*dd\s*-\s*yyyy/.test(n)) {
      return "MM-DD-YYYY";
    }
    if (/yyyy[\/.\-]\s*mm[\/.\-]\s*dd/.test(n)) return "YYYY-MM-DD";
    if (n.includes("dd-mm-yyyy") || n.includes("dd/mm/yyyy")) return "DD-MM-YYYY";
    if (n.includes("mm-dd-yyyy") || n.includes("mm/dd/yyyy")) return "MM-DD-YYYY";
    if ((fingerprint?.type || "").toLowerCase() === "date") return "YYYY-MM-DD";
    return "YYYY-MM-DD";
  }

  /**
   * Parse many common DOB inputs into { year, month, day }.
   */
  function parseDateParts(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;

    let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) {
      return { year: +m[1], month: +m[2], day: +m[3] };
    }

    m = raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
    if (m) {
      const a = +m[1];
      const b = +m[2];
      const y = +m[3];
      // If first > 12, must be D-M-Y; if second > 12, must be M-D-Y
      if (a > 12) return { year: y, month: b, day: a };
      if (b > 12) return { year: y, month: a, day: b };
      // Ambiguous — prefer D-M-Y for SA/UK contexts unless value already ISO
      return { year: y, month: b, day: a };
    }

    const d = digits(raw);
    if (d.length === 8) {
      // Prefer YMD if starts with 19/20
      if (/^(19|20)/.test(d)) {
        return { year: +d.slice(0, 4), month: +d.slice(4, 6), day: +d.slice(6, 8) };
      }
      return { year: +d.slice(4, 8), month: +d.slice(2, 4), day: +d.slice(0, 2) };
    }
    return null;
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatDate(value, pattern) {
    const parts = parseDateParts(value);
    if (!parts) return String(value || "").trim();
    const { year, month, day } = parts;
    if (!year || !month || !day) return String(value || "").trim();

    const p = String(pattern || "YYYY-MM-DD").toUpperCase();
    if (p.includes("YYYY") && p.indexOf("YYYY") === 0) {
      return `${year}-${pad(month)}-${pad(day)}`;
    }
    if (p.startsWith("MM")) {
      const sep = p.includes("/") ? "/" : p.includes(".") ? "." : "-";
      return `${pad(month)}${sep}${pad(day)}${sep}${year}`;
    }
    if (p.startsWith("DD")) {
      const sep = p.includes("/") ? "/" : p.includes(".") ? "." : "-";
      return `${pad(day)}${sep}${pad(month)}${sep}${year}`;
    }
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  function toIso(value) {
    const parts = parseDateParts(value);
    if (!parts) return "";
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  }

  global.FoxFillDateFormat = {
    detectPattern,
    parseDateParts,
    formatDate,
    toIso,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
