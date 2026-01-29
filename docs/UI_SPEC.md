# UI/UX Specification: Midnight Alpine (lakeloui.se)

## CORE PRINCIPLES
- **Static First:** Pre-render all HTML. Zero client-side processing.
- **Dark Mode Only:** Background #000000 (True OLED Black). Text #FFFFFF.
- **Touch Target:** Minimum 60px for "Glove-Friendly" interaction.
- **Speed:** No external JS libraries except Alpine.js (for light interactivity/audio).
- **The Grid:** Strict **8px Baseline Grid**. Everything is a multiple of 8 (8, 16, 24, 32).

## THE VISUAL LANGUAGE
- **Background:** `#000000` (True OLED Black).
- **Typography:** System fonts (SF Pro / Inter / system-ui).
    - *Big Data:* Thin weight, large scale.
    - *The Beans:* Bold, high-contrast for readability through goggles.
- **Accents:**
    - **Snow Cyan (`#00D4FF`):** Primary data and sparklines.
    - **Safety Orange (`#FF5F00`):** Alerts, Inversions, and Flood Watches.
    - **Muted Gray (`#86868B`):** Secondary labels and historical "ghost" data.

## CSS ARCHITECTURE (Semantic CSS)
- Use CSS Variables for the 8px grid (`--unit: 8px;`).
- Use `display: grid;` for the Bento Box layout.
- Use `backdrop-filter: blur(10px);` for the Hero Card.
- Sparklines should be light SVG paths rendered by the Mono-Lambda.

## THE BENTO BOX HIERARCHY

### Section 1: The Status Bar (Header)
- **Left:** `LAKELOUI.SE` (Logo-type, 18px Bold).
- **Center:** `[TRAV'S DASHBOARD]` (Small caps, muted gray).
- **Right:** `[AVALANCHE DOT]` | `[TIME]`.

### Section 2: The "Hero" (The Beans)
A full-width card with a subtle **Glassmorphism** effect.
- **Content:** A single, punchy headline written by Gemini 3 Flash.

### Section 3: The Vital Signs (Two-Column Grid)
- **Card A (Summit):** Big Temp | Wind Direction/Speed | 24h Sparkline (Cyan).
- **Card B (Base):** Big Temp | Wind Direction/Speed | 24h Sparkline (Cyan).

### Section 4: The Intelligence (Two-Column Grid)
- **Card C (Stash Finder):** Large Icon (Wind Arrow) | "The Stash" name | Tactical "Why."
- **Card D (Snow Phone):** Sleek, custom HTML5 Audio Player. One large `Play` button.

### Section 5: The Footer (Minimalist)
- **Links:** `AVALANCHE.CA` | `SKILOUISE.COM` | `ROADS`.
- **Credit:** Small `TRLL` logo in the bottom right.
- **Secret:** The hidden `/admin` link (sourceIP restricted).

## ANIMATION & STATES
- **Heavy Snow:** If precip > 5cm/hr, inject a CSS-only snow overlay (`body.snow-overlay`).
- **Pulse:** If an Inversion is active, the Base Temp card has a subtle Safety Orange outer-glow pulse (`card-base.inversion-active`).
- **Summer Mode:** When Environmental Mode triggers:
    - Snow Phone Card → Creek Crossing Card (Text).
    - Vital Signs → River Discharge Meter (Horizontal gauge).
    - Stash Finder → Trail Visibility Index (FireWork smoke levels).

## PRE-RENDER (Lambda)
- Template lives in `backend/src/template.ts` (inline CSS, no asset dependency).
- `backend/src/renderHtml.ts` fills placeholders and escapes HTML.
- Handler calls `renderHtml()` then `pushHtml()` to S3 every 15 min (with or without new AI script).
