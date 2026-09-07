/**
 * FoxFill in-page overlay — visual prototype (popup still drives Scan/Fill).
 * Injected on demand after a scan so you can preview the look.
 */
(function initFoxFillOverlay(global) {
  const HOST_ID = "foxfill-overlay-host";
  const HIGHLIGHT_ATTR = "data-foxfill-hl";
  const DOT_ATTR = "data-foxfill-status-dot";

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function cssEscape(value) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }

  function clearDots() {
    document.querySelectorAll(`[${DOT_ATTR}]`).forEach((node) => node.remove());
  }

  function clearHighlights() {
    document.querySelectorAll(`[${HIGHLIGHT_ATTR}]`).forEach((el) => {
      el.style.outline = "";
      el.style.outlineOffset = "";
      el.style.boxShadow = "";
      el.removeAttribute(HIGHLIGHT_ATTR);
    });
    clearDots();
  }

  function removeOverlay() {
    clearHighlights();
    const host = document.getElementById(HOST_ID);
    if (host) host.remove();
  }

  function scoreElement(el, fp) {
    let score = 0;
    if (!fp) return 0;
    if (fp.id && el.id && el.id === fp.id) score += 100;
    if (fp.name && el.getAttribute("name") === fp.name) score += 80;
    if (
      fp.placeholder &&
      el.getAttribute("placeholder") === fp.placeholder
    ) {
      score += 40;
    }
    if (
      fp.autocomplete &&
      normalize(el.getAttribute("autocomplete")) === normalize(fp.autocomplete)
    ) {
      score += 30;
    }
    return score;
  }

  function findElement(fp) {
    const list = Array.from(
      document.querySelectorAll("input, textarea, select")
    );
    let best = null;
    let bestScore = 0;
    for (const el of list) {
      const s = scoreElement(el, fp);
      if (s > bestScore) {
        bestScore = s;
        best = el;
      }
    }
    return bestScore >= 80 ? best : null;
  }

  function looksLikeLabelNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON|SCRIPT|STYLE|BR|HR|SVG|IMG)$/i.test(node.tagName)) {
      return false;
    }
    if (node.querySelector?.("input, textarea, select")) return false;
    const text = String(node.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 2 || text.length > 64) return false;
    if ((text.match(/\s+/g) || []).length > 8) return false;
    return true;
  }

  /** Best DOM node to hang a status dot on (page label). */
  function findLabelElement(el) {
    if (el.id) {
      const forLabel = document.querySelector(
        `label[for="${cssEscape(el.id)}"]`
      );
      if (forLabel) return forLabel;
    }

    const wrap = el.closest("label");
    if (wrap) return wrap;

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const id of labelledBy.trim().split(/\s+/)) {
        const node = document.getElementById(id);
        if (node) return node;
      }
    }

    let sib = el.previousElementSibling;
    for (let i = 0; sib && i < 3; i += 1, sib = sib.previousElementSibling) {
      if (looksLikeLabelNode(sib)) return sib;
    }

    const parent = el.parentElement;
    if (parent) {
      for (const child of parent.children) {
        if (child === el) break;
        if (looksLikeLabelNode(child)) return child;
      }

      const uncle = parent.previousElementSibling;
      if (looksLikeLabelNode(uncle)) return uncle;

      let best = null;
      for (const node of parent.querySelectorAll("*")) {
        if (node === el || node.contains(el)) continue;
        if (el.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
          continue;
        }
        const cls =
          typeof node.className === "string" ? node.className.toLowerCase() : "";
        const isLabelish =
          node.tagName === "LABEL" ||
          cls.includes("label") ||
          node.getAttribute("data-label") != null;
        if (!isLabelish || !looksLikeLabelNode(node)) continue;
        best = node;
      }
      if (best) return best;
    }

    return null;
  }

  function placeStatusDot(fieldEl, status) {
    const label = findLabelElement(fieldEl);
    const dot = document.createElement("span");
    dot.setAttribute(DOT_ATTR, status);
    dot.setAttribute("aria-hidden", "true");
    dot.title =
      status === "needs_review" ? "FoxFill: maybe / review" : "FoxFill: certain";
    dot.textContent = `${statusGlyph(status)} `;
    dot.style.cssText = [
      "display:inline",
      "margin:0 2px 0 0",
      "padding:0",
      "border:0",
      "background:transparent",
      "font-size:0.85em",
      "line-height:1",
      "vertical-align:middle",
      "pointer-events:none",
      "user-select:none",
    ].join(";");

    if (label) {
      label.insertBefore(dot, label.firstChild);
      return;
    }

    // No label found — sit just before the control.
    fieldEl.parentNode?.insertBefore(dot, fieldEl);
  }

  function statusColor(status) {
    if (status === "will_fill" || status === "matched") return "#22A06B";
    if (status === "needs_review") return "#E2B203";
    return "#8A9690";
  }

  function statusGlyph(status) {
    if (status === "will_fill" || status === "matched") return "🟢";
    if (status === "needs_review") return "🟡";
    return "⚪";
  }

  function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (host) return host;
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.zIndex = "2147483646";
    host.style.inset = "0";
    host.style.pointerEvents = "none";
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
        .panel {
          pointer-events: auto;
          position: fixed;
          right: 16px;
          bottom: 16px;
          width: min(320px, calc(100vw - 32px));
          background: #F8F7F4;
          color: #1F2A25;
          border: 1px solid rgba(15, 61, 46, 0.18);
          border-radius: 14px;
          box-shadow: 0 16px 40px rgba(15, 61, 46, 0.22);
          overflow: hidden;
          animation: rise 0.28s ease;
        }
        @keyframes rise {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .head {
          background: #0F3D2E;
          color: #F3EFE6;
          padding: 12px 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .brand {
          font-family: Georgia, "Times New Roman", serif;
          font-size: 16px;
          font-weight: 600;
        }
        .brand span { color: #D4B574; }
        .close {
          appearance: none;
          border: none;
          background: rgba(248,247,244,0.12);
          color: #F8F7F4;
          border-radius: 8px;
          padding: 4px 8px;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
        }
        .body { padding: 12px 14px 14px; }
        .sub {
          margin: 0 0 10px;
          font-size: 12px;
          color: #6B7A72;
          line-height: 1.35;
        }
        .legend {
          display: flex;
          gap: 12px;
          margin: 0 0 8px;
          font-size: 11px;
          color: #6B7A72;
        }
        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 10px;
        }
        .chip {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.02em;
          padding: 3px 8px;
          border-radius: 999px;
          background: #ECECEC;
          color: #6B7A72;
        }
        .chip-ready { background: #E6F1EA; color: #0F3D2E; }
        .chip-review { background: #FFF4D6; color: #7A5B00; }
        .list {
          list-style: none;
          margin: 0;
          padding: 0;
          max-height: 200px;
          overflow: auto;
          border: 1px solid rgba(15,61,46,0.1);
          border-radius: 10px;
          background: #fff;
        }
        .row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 8px;
          padding: 8px 10px;
          border-bottom: 1px solid rgba(15,61,46,0.08);
          font-size: 12px;
        }
        .row:last-child { border-bottom: none; }
        .row-title {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .row-meta {
          color: #6B7A72;
          font-size: 11px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 48%;
          flex-shrink: 0;
        }
        .foot {
          margin-top: 10px;
          font-size: 10px;
          color: #6B7A72;
          line-height: 1.35;
        }
        .mark {
          margin-right: 4px;
          font-size: 10px;
          line-height: 1;
        }
      </style>
      <div class="panel" part="panel">
        <div class="head">
          <div class="brand">Fox<span>Fill</span></div>
          <button type="button" class="close" id="ffClose">Dismiss</button>
        </div>
        <div class="body">
          <p class="sub" id="ffSub">Matched fields on this page.</p>
          <p class="legend">🟢 Certain &nbsp; 🟡 Review</p>
          <div class="chips" id="ffChips"></div>
          <ul class="list" id="ffList"></ul>
          <p class="foot">Fill from the FoxFill popup.</p>
        </div>
      </div>
    `;
    shadow.getElementById("ffClose").addEventListener("click", () => {
      removeOverlay();
    });
    return host;
  }

  function showOverlay(payload) {
    const matches = Array.isArray(payload?.matches) ? payload.matches : [];
    removeOverlay();
    if (!matches.length) return { ok: true, shown: 0 };

    const host = ensureHost();
    const shadow = host.shadowRoot;
    const chips = shadow.getElementById("ffChips");
    const list = shadow.getElementById("ffList");
    const sub = shadow.getElementById("ffSub");

    let ready = 0;
    let review = 0;
    let skip = 0;
    let highlighted = 0;

    list.innerHTML = "";
    chips.innerHTML = "";

    for (const m of matches) {
      const status = m.status || "unmatched";
      if (status === "will_fill" || status === "matched") ready += 1;
      else if (status === "needs_review") review += 1;
      else skip += 1;

      const el = findElement(m.fingerprint);
      if (el && status !== "unmatched") {
        const color = statusColor(status);
        el.style.outline = `2px solid ${color}`;
        el.style.outlineOffset = "2px";
        el.style.boxShadow = `0 0 0 4px ${color}22`;
        el.setAttribute(HIGHLIGHT_ATTR, status);
        placeStatusDot(el, status);
        highlighted += 1;
      }

      if (status === "unmatched") continue;
      const li = document.createElement("li");
      li.className = "row";
      const title = document.createElement("div");
      title.className = "row-title";
      const mark = document.createElement("span");
      mark.className = "mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = statusGlyph(status);
      const name = m.label || m.profileLabel || "Field";
      title.append(mark, document.createTextNode(name));
      title.title =
        status === "needs_review" ? `${name} — needs review` : `${name} — certain`;
      const meta = document.createElement("div");
      meta.className = "row-meta";
      meta.textContent = m.fill || "";
      meta.title = m.fill || "";
      li.append(title, meta);
      list.append(li);
    }

    const chipData = [
      { text: `${ready} certain`, cls: "chip chip-ready" },
      { text: `${review} maybe`, cls: "chip chip-review" },
    ];
    if (skip) chipData.push({ text: `${skip} skip`, cls: "chip" });
    for (const c of chipData) {
      const span = document.createElement("span");
      span.className = c.cls;
      span.textContent = c.text;
      chips.append(span);
    }

    sub.textContent = highlighted
      ? `${highlighted} field${highlighted === 1 ? "" : "s"} highlighted.`
      : "Matches listed — none outlined on this frame.";

    return { ok: true, shown: matches.length, highlighted };
  }

  global.FoxFillShowOverlay = showOverlay;
  global.FoxFillHideOverlay = removeOverlay;
})(typeof globalThis !== "undefined" ? globalThis : self);
