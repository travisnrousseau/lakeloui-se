/**
 * Transform dashboard HTML so it renders correctly in mobile email clients.
 * Many clients strip or ignore @media and grid; this forces single-column, full-width layout.
 */
const EMAIL_SAFE_STYLE = `
/* Email/mobile: single column, full width so it doesn't break on small screens */
.email-safe{margin:0 !important;padding:12px !important;max-width:100% !important;width:100% !important;-webkit-text-size-adjust:100%;box-sizing:border-box !important;}
.email-safe .dashboard{display:block !important;grid-template-columns:1fr !important;max-width:100% !important;width:100% !important;}
.email-safe header,.email-safe .hero,.email-safe .card,.email-safe footer{display:block !important;width:100% !important;max-width:100% !important;grid-column:span 1 !important;}
.email-safe .text-big{font-size:2rem !important;}
.email-safe .card{box-sizing:border-box !important;}
.email-safe img,.email-safe svg{max-width:100% !important;height:auto !important;}
.email-safe .forecast-viz,.email-safe .forecast-bento{max-width:100% !important;overflow:hidden !important;}
`;

export function makeEmailSafe(html: string): string {
  let out = html;
  // Add body class so our overrides apply
  out = out.replace(/<body(\s+class=")/, '<body$1email-safe ');
  if (!out.includes('email-safe')) {
    out = out.replace(/<body(\s+)/, '<body class="email-safe"$1');
  }
  // Inject email-safe CSS after the first </style>
  out = out.replace('</style>', EMAIL_SAFE_STYLE + '\n</style>');
  return out;
}
