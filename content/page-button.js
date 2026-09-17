/**
 * FoxFill floating page button — opt-in, non-intrusive side control.
 * Injected only when the user enables “Page fill button” and grants site access.
 */
(function initFoxFillPageButton() {
  const HOST_ID = "foxfill-page-button-host";
  if (document.getElementById(HOST_ID)) return;
  if (window !== window.top) return; // one FAB on the top frame only

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.zIndex = "2147483645";
  host.style.inset = "0";
  host.style.pointerEvents = "none";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
      .wrap {
        pointer-events: none;
        position: fixed;
        right: 14px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
      }
      .fab {
        pointer-events: auto;
        appearance: none;
        border: 1px solid rgba(212, 181, 116, 0.55);
        background: #0F3D2E;
        color: #F3EFE6;
        width: 48px;
        height: 48px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 10px 28px rgba(15, 61, 46, 0.35);
        transition: width 0.18s ease, padding 0.18s ease, gap 0.18s ease, background 0.15s ease;
        overflow: hidden;
        padding: 0;
        gap: 0;
      }
      .fab:hover,
      .fab:focus-visible {
        width: 118px;
        padding: 0 14px 0 6px;
        gap: 8px;
        justify-content: flex-start;
        border-radius: 999px;
        outline: none;
        background: #144836;
      }
      .fab:disabled {
        opacity: 0.72;
        cursor: wait;
      }
      .fab-icon {
        width: 36px;
        height: 36px;
        flex-shrink: 0;
        border-radius: 8px;
        display: block;
        object-fit: contain;
      }
      .fab-label {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
        white-space: nowrap;
        opacity: 0;
        max-width: 0;
        overflow: hidden;
        transition: opacity 0.15s ease, max-width 0.15s ease;
      }
      .fab:hover .fab-label,
      .fab:focus-visible .fab-label {
        opacity: 1;
        max-width: 64px;
      }
      .toast {
        pointer-events: none;
        max-width: 220px;
        background: #F8F7F4;
        color: #1F2A25;
        border: 1px solid rgba(15, 61, 46, 0.16);
        border-radius: 10px;
        padding: 8px 10px;
        font-size: 11px;
        line-height: 1.35;
        box-shadow: 0 10px 24px rgba(15, 61, 46, 0.2);
        opacity: 0;
        transform: translateX(8px);
        transition: opacity 0.18s ease, transform 0.18s ease;
      }
      .toast.is-on {
        opacity: 1;
        transform: translateX(0);
      }
      .toast.is-error {
        background: #ffe5e5;
        color: #7a2e2e;
      }
      .toast.is-ok {
        background: #E6F1EA;
        color: #0F3D2E;
      }
    </style>
    <div class="wrap">
      <div class="toast" id="toast" hidden></div>
      <button type="button" class="fab" id="fab" title="FoxFill — fill matched fields" aria-label="FoxFill fill">
        <img class="fab-icon" alt="" width="36" height="36" />
        <span class="fab-label">Fill</span>
      </button>
    </div>
  `;

  const fab = shadow.getElementById("fab");
  const toast = shadow.getElementById("toast");
  const icon = shadow.querySelector(".fab-icon");
  icon.src = chrome.runtime.getURL("assets/icons/icon48.png");

  let toastTimer = 0;
  function showToast(message, kind) {
    window.clearTimeout(toastTimer);
    toast.hidden = false;
    toast.textContent = message;
    toast.classList.remove("is-on", "is-error", "is-ok");
    if (kind) toast.classList.add(kind);
    requestAnimationFrame(() => toast.classList.add("is-on"));
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-on");
      window.setTimeout(() => {
        toast.hidden = true;
      }, 200);
    }, 3200);
  }

  fab.addEventListener("click", async () => {
    if (fab.disabled) return;
    fab.disabled = true;
    showToast("Scanning & filling…");
    try {
      const result = await chrome.runtime.sendMessage({
        type: "FOXFILL_PAGE_BUTTON_FILL",
      });
      if (!result || result.ok !== true) {
        showToast(result?.error || "Couldn’t fill this page.", "is-error");
        return;
      }
      const filled = result.filled || 0;
      if (filled === 0) {
        showToast(result.message || "No confident matches to fill.", "is-error");
      } else {
        showToast(
          `Filled ${filled} field${filled === 1 ? "" : "s"}.`,
          "is-ok"
        );
      }
    } catch (err) {
      showToast(err?.message || "FoxFill isn’t available on this page.", "is-error");
    } finally {
      fab.disabled = false;
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "FOXFILL_REMOVE_PAGE_BUTTON") {
      host.remove();
    }
  });
})();
