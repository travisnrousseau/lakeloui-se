# Snow Math Explained (lakeloui.se)

A short, email-friendly explanation of how we estimate snow amounts on the site. You can copy this whole file into an email or share it as-is.

---

## 1. Snow-to-liquid ratio (SLR) from temperature

**What it is:** The snow-to-liquid ratio is how many centimetres of snow you get per centimetre of liquid (melted) equivalent. For example, 20:1 means 20 cm of snow for 1 cm of water. Colder air produces fluffier, drier snow (higher ratio); warmer air produces wetter, denser snow (lower ratio).

**Formula:**

```
SLR(T) = 10 + (0 − T)   for T in °C
```

We cap the result between **5** and **30** so we don’t get unrealistic values.

**Examples:**

| Temperature | SLR (ratio) |
|-------------|-------------|
| 0°C         | 10:1        |
| -10°C       | 20:1        |
| -20°C       | 30:1 (cap)  |
| +5°C        | 5:1 (cap)   |

**Where it comes from:** This is a standard temperature-based approximation used in forecasting (10:1 at 0°C is a common baseline). More detailed methods use temperature through the whole atmosphere; we use the surface temperature at mid-mountain (Pika) and at the summit (Paradise) for simplicity.

---

## 2. Depth from snow water equivalent (SWE)

If you have **snow water equivalent** in millimetres (e.g. from a weighing gauge) and want depth in centimetres:

```
depth (cm) = SWE (mm) × SLR(T) / 10
```

So at 10:1, 10 mm of water gives 10 cm of snow; at 20:1, 10 mm of water gives 20 cm of snow. The resort’s Pika gauge measures SWE and converts to depth using snow density; we use their reported depths for mid-mountain.

---

## 3. Orographic precipitation multiplier (elevation)

**What it is:** In the mountains, precipitation often increases with elevation (uplift and cooling). So we expect more precipitation at the summit than at mid-mountain. We represent that with a multiplier.

**Formula:**

```
orographic multiplier = 1 + (elev_upper − elev_mid) × 0.0008
```

We cap the multiplier between **1.0** and **1.6**. The factor **0.0008** corresponds to about **8% more precipitation per 100 m** of elevation gain, which is in the range used in Rockies orographic studies.

**Elevations we use:**

- Mid-mountain (Pika): **2000 m**
- Summit (Paradise): **2630 m**

So the elevation difference is 630 m, and the multiplier is about 1 + 630 × 0.0008 ≈ 1.5.

---

## 4. Upper-mountain snow depth (full estimate)

We combine **orographic** (more precipitation at higher elevation) and **SLR** (fluffier snow when it’s colder aloft):

```
upper depth (cm) = mid depth (cm) × orographic multiplier × (SLR_upper / SLR_mid)
```

Where:

- **mid depth** = Resort-reported depth at Pika (12h, 24h, or 48h), in cm.
- **orographic multiplier** = From the formula above (2000 m → 2630 m).
- **SLR_upper** = Snow-to-liquid ratio at the summit, from Paradise temperature.
- **SLR_mid** = Snow-to-liquid ratio at mid-mountain, from Pika temperature (resort XML).

**Why this is reasonable:** Same liquid equivalent at mid and upper would give depths proportional to SLR (colder → fluffier → more cm). On top of that, orographic lift gives more precipitation at the summit, so we multiply by the orographic factor. So we get: more precip aloft × fluffier snow aloft when it’s cold.

**Fallback:** If we don’t have temperatures (e.g. outside the resort data window), we use a fixed **1.5×** of mid depth, which matches the resort’s usual “upper mountain” rule of thumb.

---

## 5. Wind redistribution (qualitative only)

**What it is:** Wind **moves** snow (drifting, scouring); it doesn’t create or destroy it. So we **do not** change the single “upper” depth number with a wind factor. Instead we describe **where** snow is likely to pile up vs. get stripped.

When summit wind is **≥ 25 km/h**, we show a short note, for example:

- *“Strong NW wind — loading on SE aspects, scouring on NW.”*

So:

- **Loading** = downwind (lee) side — snow is deposited there.
- **Scouring** = upwind (windward) side — snow is stripped.

The numeric depths (mid and upper) stay as basin-wide estimates; wind only affects the qualitative “where to expect more or less” message.

---

## Summary

| What | Formula or source |
|------|-------------------|
| **Mid depth (12h / 24h / 48h)** | Resort-reported values at Pika (from their XML). |
| **SLR from temperature** | SLR(T) = 10 + (0 − T) °C, capped between 5 and 30. |
| **Depth from SWE** | depth (cm) = SWE (mm) × SLR(T) / 10. |
| **Orographic multiplier** | 1 + (elev_upper − elev_mid) × 0.0008, capped 1.0–1.6. |
| **Upper depth** | mid × orographic mult × (SLR_upper / SLR_mid); fallback 1.5× when temps are missing. |
| **Wind** | Text note only (loading vs. scouring); no change to the depth number. |

All of this is implemented in one place in the codebase so the math stays consistent and easy to adjust if we get better coefficients or data.
