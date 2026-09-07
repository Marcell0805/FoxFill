# FoxFill

Privacy-first Chrome extension that fills web forms from a locally stored profile.

**Current:** Phase 9 — multi-profile, custom fields, encryption, full settings page (local), optional in-page overlay preview.

Product rules and roadmap: **[PLAN.md](PLAN.md)**

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `D:\repos\FoxFill`
5. Click **Open full settings** (or Personal → Open full settings) to edit all details in a wide tab — still local only
6. Optional: encryption under Privacy on that page (or More in the popup)
7. Open a page with a form → **Scan Form**
8. Review groups, adjust ticks, then **Fill N Fields**

## Permissions (V1)

- `storage` — local profiles (optionally encrypted)
- `activeTab` — temporary access after you open the popup
- `scripting` — inject scanner/matcher/filler only on user action

No broad host permissions. FoxFill does not scan pages in the background.

## Project layout

```
FoxFill/
  manifest.json
  PLAN.md          Architecture + roadmap (source of truth)
  popup/           Scan / review / fill (+ quick profile edits)
  options/         Full settings page (all details in a browser tab)
  content/         Scanner, matcher, compound, filler, overlay
  background/      Service worker
  data/            Patterns, phone/date/fit, profiles, crypto
  assets/icons/
  fixtures/        Local test form
```

## Roadmap (summary)

1–8b Foundation through encryption + custom fields — **done**  
9 Full settings page + overlay preview — **done**  
Later: Chrome Web Store packaging; fuller in-page fill

See [PLAN.md](PLAN.md) for locked rules and full detail.
