/**
 * Midnight Alpine HTML template for pre-rendering.
 * Inline CSS so Lambda output is self-contained (no asset dependency).
 * Placeholders: {{HERO_BEANS}}, {{SUMMIT_TEMP}}, {{BASE_TEMP}}, {{SUMMIT_FEELS_LIKE}}, {{BASE_FEELS_LIKE}},
 * {{BASE_CARD_CLASS}}, {{BODY_CLASS}}, {{TIME}}, {{STASH_CARD_LABEL}}, {{STASH_NAME}}, {{STASH_WHY}}, {{SUMMIT_WIND}}, {{BASE_WIND}},
 * {{SUMMIT_WIND_META}}, {{BASE_WIND_META}}, {{SPARKLINE_SUMMIT}}, {{SPARKLINE_BASE}}, {{SNOW_REPORT_CARD}}, {{FORECAST_CARD}}
 */
export const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WX.LAKELOUI.SE | Trav's Weather Dashboard</title>
<style>
:root{--black:#000;--white:#fff;--cyan:#00d4ff;--orange:#ff5f00;--gray:#86868b;--gray-dark:#1c1c1e;--u:8px;--u2:16px;--u3:24px;--u4:32px;--u8:64px;--font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,sans-serif;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--black);color:var(--white);font-family:var(--font);line-height:1.5;padding:var(--u2);-webkit-font-smoothing:antialiased;transition:backdrop-filter 0.5s, filter 0.5s;}
.text-big{font-size:4rem;font-weight:200;line-height:1;}
.text-beans{font-size:1.25rem;font-weight:700;}
.text-muted{color:var(--gray);font-variant:small-caps;}
.feels-like{display:block;color:var(--gray);font-size:0.875rem;font-weight:400;margin-top:2px;}
.dashboard{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--u2);max-width:1200px;margin:0 auto;}
header{grid-column:span 2;display:flex;justify-content:space-between;align-items:center;padding:var(--u2) 0;position:sticky;top:0;background:rgba(0,0,0,.8);backdrop-filter:blur(10px);z-index:100;}
.logo{font-size:1.125rem;font-weight:800;}
.card{background:var(--gray-dark);border-radius:var(--u2);padding:var(--u3);display:flex;flex-direction:column;gap:var(--u);position:relative;overflow:hidden;}
.hero{grid-column:span 2;background:linear-gradient(135deg,#1c1c1e 0%,#000 100%);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(20px);min-height:120px;justify-content:center;}
.card-summit,.card-base{grid-column:span 1;}
.card-intelligence{grid-column:span 1;}
@keyframes orange-pulse{0%{box-shadow:0 0 0 0 rgba(255,95,0,.4);}70%{box-shadow:0 0 0 15px rgba(255,95,0,0);}100%{box-shadow:0 0 0 0 rgba(255,95,0,0);}}
.inversion-active{animation:orange-pulse 2s infinite;border:1px solid var(--orange);}
.snow-periods{margin-top:var(--u);display:flex;flex-direction:column;gap:var(--u);}
.snow-row{display:flex;justify-content:space-between;align-items:center;font-size:0.9375rem;}
.snow-label{color:var(--gray);}
.snow-cm{font-weight:600;}
.snow-equiv-periods{display:flex;flex-direction:column;gap:6px;margin-top:6px;font-size:0.875rem;}
.snow-equiv-periods span{display:block;}
.snow-upper-label{margin-top:var(--u2);font-size:0.8125rem;}
.snow-conditions{margin-top:var(--u);color:var(--gray);font-size:0.875rem;}
.snow-updated{margin-top:var(--u);font-size:0.75rem;color:var(--gray);}
.snow-wind-note{margin-top:var(--u);font-size:0.8125rem;color:var(--gray);font-style:italic;}
.wind-meta{display:block;font-size:0.75rem;color:var(--gray);margin-top:2px;}
.sparkline{height:40px;width:100%;margin-top:var(--u);}
.sparkline path{fill:none;stroke:var(--cyan);stroke-width:2;stroke-linecap:round;}
.audio-player{display:flex;align-items:center;gap:var(--u2);margin-top:var(--u);}
.play-button{min-width:60px;min-height:60px;border-radius:50%;background:var(--white);color:var(--black);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;}

/* Vertical Heatmap */
.vertical-heatmap{position:absolute;right:0;top:0;bottom:0;width:12px;display:flex;flex-direction:column-reverse;background:#333;}
.heatmap-segment{flex:1;width:100%;}
.cloud-ceiling{position:absolute;left:-8px;right:-8px;height:2px;background:var(--white);box-shadow:0 0 8px var(--white);z-index:10;}

/* 48H forecast graph — height from inline style so SVG (180px) doesn’t overflow */
.forecast-viz{width:100%;min-height:180px;}
.confidence-area{fill:var(--cyan);opacity:0.15;}
.tactical-line{fill:none;stroke:var(--white);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;}
.forecast-axis{stroke:var(--gray);stroke-width:1;stroke-dasharray:4 4;opacity:0.3;}
.forecast-label-text{fill:var(--gray);font-size:10px;font-variant:small-caps;}

footer{grid-column:span 2;display:flex;justify-content:space-between;align-items:flex-end;padding:var(--u8) 0 var(--u4);}
.footer-links{display:flex;gap:var(--u3);}
.footer-links a{color:var(--white);text-decoration:none;font-weight:600;font-size:.875rem;}
.trll-logo{font-weight:900;font-style:italic;opacity:.5;}
.snow-overlay{pointer-events:none;position:fixed;inset:0;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle fill='white' opacity='0.3' cx='20' cy='10' r='1'/%3E%3Ccircle fill='white' opacity='0.2' cx='60' cy='30' r='1'/%3E%3Ccircle fill='white' opacity='0.25' cx='40' cy='60' r='1'/%3E%3Ccircle fill='white' opacity='0.2' cx='80' cy='80' r='1'/%3E%3C/svg%3E");animation:snow-drift 20s linear infinite;}
@keyframes snow-drift{0%{transform:translateY(-100%);}100%{transform:translateY(100%);}}
@media(max-width:768px){.dashboard{grid-template-columns:1fr;}header,.hero,.card,footer{grid-column:span 1;}.text-big{font-size:3rem;}}
</style>
</head>
<body class="{{BODY_CLASS}}" style="{{BODY_STYLE}}">
<div class="dashboard">
<header>
<div class="logo">WX.LAKELOUI.SE</div>
<div class="text-muted">[TRAV'S DASHBOARD]</div>
<div class="text-muted">AVALANCHE: ● | <span id="time">{{TIME}}</span></div>
</header>
<section class="card hero">
<p class="text-beans" id="hero-beans">{{HERO_BEANS}}</p>
</section>
<section class="card card-summit">
{{VERTICAL_HEATMAP}}
<div class="text-muted">SUMMIT (PARADISE)</div>
<div class="text-big" id="summit-temp">{{SUMMIT_TEMP}}</div>
{{SUMMIT_FEELS_LIKE}}
<div class="text-beans" id="summit-wind">{{SUMMIT_WIND}}</div>
{{SUMMIT_WIND_META}}
<div class="sparkline"><svg viewBox="0 0 100 40" preserveAspectRatio="none"><path d="{{SPARKLINE_SUMMIT}}"/></svg></div>
</section>
<section class="card card-base {{BASE_CARD_CLASS}}">
<div class="text-muted">BASE AREA</div>
<div class="text-big" id="base-temp">{{BASE_TEMP}}</div>
{{BASE_FEELS_LIKE}}
<div class="text-beans" id="base-wind">{{BASE_WIND}}</div>
{{BASE_WIND_META}}
<div class="sparkline"><svg viewBox="0 0 100 40" preserveAspectRatio="none"><path d="{{SPARKLINE_BASE}}"/></svg></div>
</section>
<section class="card card-intelligence">
<div class="text-muted">{{STASH_CARD_LABEL}}</div>
<div class="text-beans" id="stash-name">{{STASH_NAME}}</div>
<p id="stash-why">{{STASH_WHY}}</p>
</section>
<section class="card card-intelligence">
<div class="text-muted">Pika & Skoki (GOES-18)</div>
{{SNOW_REPORT_CARD}}
</section>
<section class="card card-intelligence" style="grid-column: span 2;">
<div class="text-muted">48H FORECAST</div>
<p class="snow-conditions text-muted">{{FORECAST_MODELS_DESC}}</p>
{{FORECAST_BENTO}}
<p class="snow-updated" style="margin-top:var(--u2); border-top: 1px solid rgba(255,255,255,0.1); padding-top: var(--u);"><strong>7-day:</strong> {{GDPS_TREND}}</p>
</section>
<section class="card card-intelligence">
<div class="text-muted">SNOW PHONE</div>
<div class="audio-player"><button class="play-button" type="button" aria-label="Play">▶</button><div class="text-muted">LATEST REPORT</div></div>
</section>
<footer>
<div class="footer-links">
<a href="https://avalanche.ca" target="_blank" rel="noopener">AVALANCHE.CA</a>
<a href="https://skilouise.com" target="_blank" rel="noopener">SKILOUISE.COM</a>
<a href="https://511.alberta.ca" target="_blank" rel="noopener">ROADS</a>
</div>
<div class="trll-logo"><a href="https://trll.ca" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;">TRLL</a></div>
</footer>
</div>
</body>
</html>`;

/** Escape HTML for safe injection */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
