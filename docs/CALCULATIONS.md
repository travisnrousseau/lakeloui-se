# Snow & Weather Calculations (lakeloui.se)

Equations used on this site so you know what’s going on. Implemented in `backend/src/snowMath.ts` and used in `renderHtml.ts`.

---

## 1. Snow-to-liquid ratio (SLR) from temperature

**What it is:** SLR = ratio of snow depth to liquid equivalent (e.g. 20:1 = 20 cm snow per 1 cm of water). Colder air → fluffier, drier snow → higher SLR; warmer → wetter → lower SLR.

**Formula (temperature-based approximation):**

```
SLR(T) = 10 + (0 − T)   for T in °C
```

Clamped to **5 ≤ SLR ≤ 30** so we don’t get extreme values.

| T (°C) | SLR (approx) |
|--------|--------------|
|   0    | 10:1         |
| -10    | 20:1         |
| -20    | 30:1 (cap)   |
|  +5    |  5:1 (cap)   |

**Reference:** Common forecasting practice (10:1 baseline at 0°C); temperature-based SLR methods used in NWS and NBM. More complex schemes (e.g. Roebber, Cobb–Waldstreicher) use layer temperatures; we use surface temp at mid (Pika) and summit (Paradise) for simplicity.

**When we use it:** To scale mid-mountain depth to upper-mountain when summit is colder (fluffier snow aloft) or warmer (wetter aloft). See “Upper-mountain depth” below.

---

## 2. Depth from SWE (when we have liquid equivalent)

If we ever have **snow water equivalent (SWE)** in mm and want depth in cm:

```
depth_cm = SWE_mm × SLR(T) / 10
```

So at 10:1, 10 mm SWE → 10 cm depth; at 20:1, 10 mm SWE → 20 cm depth. Implemented as `depthCmFromSwe(sweMm, tC)` in `snowMath.ts`.

---

## 3. Orographic precipitation multiplier (elevation)

**What it is:** Precipitation often increases with elevation in mountains (uplift, cooling). We apply a multiplier so “upper” gets more precip than “mid” by a physically plausible amount.

**Formula:**

```
orographic_mult = 1 + (elev_upper − elev_mid) × 0.0008
```

Clamped to **1.0 ≤ mult ≤ 1.6**. The factor **0.0008** corresponds to ~**8% per 100 m** elevation gain, in the range used in Rockies orographic studies.

**Elevations we use (m ASL):**

- Mid (Pika): **2000 m**
- Upper (Paradise/summit): **2630 m**

So `(2630 − 2000) × 0.0008 ≈ 0.50` → multiplier ≈ **1.5** (capped at 1.6 if needed).

---

## 4. Upper-mountain snow depth (physical estimate)

We combine **orographic** (more precip at elevation) and **SLR** (fluffier snow when colder aloft):

```
upper_cm = mid_cm × orographic_mult × (SLR_upper / SLR_mid)
```

- **mid_cm** — Resort-reported depth at Pika (12h, 24h, or 48h), cm.
- **orographic_mult** — From §3 (elev_mid = 2000 m, elev_upper = 2630 m).
- **SLR_upper** — From summit (Paradise) temperature, °C.
- **SLR_mid** — From mid (Pika) temperature, °C (resort XML).

**Fallback:** If either temperature is missing, we use **upper_cm = mid_cm × 1.5** (resort convention) so the card always shows a number.

**Why this is correct:** Same liquid equivalent at mid and upper would give depths proportional to SLR (colder → fluffier → more cm). Orographic lift gives more precip at upper elevation, so we multiply by orographic_mult. Together: more precip aloft × fluffier snow aloft when cold.

---

## 5. Wind redistribution (no change to basin depth)

**What it is:** Wind **moves** snow (drifting, scouring); it doesn’t create or destroy it. So we do **not** multiply the single “upper” depth number by a wind factor. Instead we show **where** snow is likely loaded vs scoured.

**Rule:** When **summit wind ≥ 25 km/h** we display a short note, e.g.:

- “Strong NW wind — loading on SE aspects, scouring on NW.”

So:

- **Loading** = downwind (lee) side — snow is deposited there.
- **Scouring** = upwind (windward) side — snow is stripped.

Aspect is derived from the 16-point wind direction (N, NNE, …). This is qualitative and supports the Stash Finder; the numeric snow depths (mid and upper) remain basin-relevant and are not adjusted for wind.

---

## 6. Temp, elevation, wind (display)

- **Temp:** WeatherLink (Paradise/Base) and resort XML (Pika) — displayed as reported, °C. Used in SLR for upper estimate.
- **Elevation:** Fixed pins — Base ~1650 m, Pika 2000 m, Paradise 2630 m (see ARCHITECTURE / DATA_SOURCES). Used in orographic multiplier.
- **Wind:** Speed (km/h) and direction (degrees → 16-point). Used for redistribution note and Stash Finder; not used to scale the single depth number.

---

## Summary

| Quantity            | Source / formula |
|---------------------|------------------|
| Mid depth (12h/24h/48h) | Resort XML (Pika) |
| SLR(T)              | 10 + (0 − T), clamp 5–30 |
| Orographic mult     | 1 + (elev_upper − elev_mid) × 0.0008, clamp 1.0–1.6 |
| Upper depth         | mid_cm × orographic_mult × (SLR_upper / SLR_mid); fallback 1.5× |
| Wind effect         | Text note only (loading/scouring); no depth multiplier |

All numeric snow math lives in `backend/src/snowMath.ts` so it stays consistent and testable.
