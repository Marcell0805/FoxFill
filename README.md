# FoxFill

Privacy-first Chrome extension that fills web forms from a locally stored profile.

**Current:** Phase 8b — multi-profile, custom fields, optional passphrase encryption at rest (popup only).

Product rules and roadmap: **[PLAN.md](PLAN.md)**

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `D:\repos\FoxFill`
5. Choose or create a **Profile**, fill **Personal** / **Address** → Save
6. Optional: **More** → custom fields and encryption
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
  popup/           UI (scan review + profile + fill)
  content/         Scanner, matcher, compound, filler
  background/      Service worker
  data/            Patterns, phone/date/fit, profiles, crypto
  assets/icons/
  fixtures/        Local test form
```

## Roadmap (summary)

1–8b Foundation through encryption + custom fields — **done**  
Later: optional overlay (still popup-only by default)

See [PLAN.md](PLAN.md) for locked rules and full detail.
