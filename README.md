# FoxFill

Privacy-first Chrome extension that fills web forms from a locally stored profile.

**Current:** Phase 6+ — review UI, phone/date compounds, title & residence selects, constraint-aware fills.

Product rules and roadmap: **[PLAN.md](PLAN.md)**

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `D:\repos\FoxFill`
5. Fill **Personal** / **Address** → Save Profile
6. Open a page with a form → **Scan Form**
7. Review groups, adjust ticks, then **Fill N Fields**

## Permissions (V1)

- `storage` — local profile
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
  data/            Field patterns, phone parse, date format, fit value
  assets/icons/
  fixtures/        Local test form
```

## Roadmap (summary)

1–6 Foundation through review UI — **done**  
6+ Title, residence type, static `+CC` phone prefix, value fitting — **done**  
7 Polish — next  
8 Future (multi-profile, overlay, etc.)

See [PLAN.md](PLAN.md) for locked rules and full detail.
