# AI Models for Weather / Ski Advice (LLM Choice)

This doc answers: **which LLM(s) to use for generating the ski-advice narrative** from the structured alerts produced by the Lambda (orographic, inversion, Chinook, freezing level, Stash Finder, Groomer Check, history_alert, resort XML). **Weather models** (HRDPS, RDPS, GDPS) are separate—they feed the logic that produces those alerts; see [MODELS_ROCKIES_OPERATIONS.md](MODELS_ROCKIES_OPERATIONS.md) and [GEOMET_STRATEGY.md](GEOMET_STRATEGY.md).

---

## Requirements

- **Input:** JSON of alerts + resort summary (open/groomed runs, snow report, optional `history_alert`).
- **Output:** Short, punchy “Mountain Guide” prose: authoritative, honest, no marketing fluff (see [CONTENT_LOGIC.md](CONTENT_LOGIC.md)).
- **Constraints:** Low cost (personal project), modest context size, optional structured output (e.g. JSON with `summary`, `stash_note`, `groomer_pick`).
- **Trigger:** Only when Resort XML or weather snapshot changes (MD5/hash check); avoid calling the LLM every 15 minutes.

---

## Recommended LLMs

| Model | Use case | Pros | Cons |
|-------|----------|------|------|
| **Gemini 1.5 Flash** | **Primary** — daily ski advice | Cheap, fast, good instruction-following, free tier. Fits “Mountain Guide” tone when prompted clearly. | Slightly less nuanced than larger models. |
| **Gemini 1.5 Pro** | When you want richer copy | Better nuance and consistency; still reasonable cost. | More expensive than Flash; slower. |
| **Claude 3.5 Haiku** | **Alternative** — low cost | Very low cost, concise output, good for short tactical blurbs. | Less “personality” tuning than Sonnet. |
| **Claude 3.5 Sonnet** | When quality > cost | Excellent prose and tone control; strong at following “no fluff” rules. | Higher cost per call. |
| **GPT-4o mini** | Alternative | Good quality/cost balance, solid structured output. | OpenAI pricing; no free tier for production volume. |
| **GPT-4o** | Premium quality | Top-tier instruction following and tone. | Most expensive; overkill for a single daily blurb. |

---

## Practical recommendation

1. **Start with Gemini 1.5 Flash** (e.g. `gemini-1.5-flash` or `gemini-1.5-flash-8b`): free tier, good for “turn this JSON into 2–4 short sentences.” Store API key in Lambda env (or Secrets Manager); call only when Resort XML or snapshot hash changes.
2. **System prompt:** Put CONTENT_LOGIC rules in the system prompt: only mention history when `history_alert` is non-null; never suggest closed runs; tone = Mountain Guide, no marketing.
3. **Structured output:** Prefer a single JSON response (e.g. `{ "summary": "...", "stash_note": "...", "groomer_pick": "..." }`) so the Lambda can plug it into the HTML template without parsing prose.
4. **If Flash feels too generic:** Switch to **Gemini 1.5 Pro** or **Claude 3.5 Haiku** for better nuance at still-low cost.

---

## What *not* to use for this

- **Weather “AI” models:** There are no LLMs that replace HRDPS/RDPS/GDPS for *forecast* data. The LLM only turns *already-computed* alerts and resort data into human-readable advice.
- **Local/open-weight models** (Llama, Mistral, etc.): Viable if you host them, but added ops and latency; not necessary for a single narrative per change.
- **Generic “weather” APIs:** They don’t produce Lake Louise–specific, orographic/Chinook/inversion-aware copy; your logic in CONTENT_LOGIC + MODELS_ROCKIES_OPERATIONS does. The LLM is the last step: text generation from structured input.

---

## Wiring (high level)

1. Lambda computes alerts (inversion, orographic, Chinook, freezing level, stash, groomer, history_alert) and has resort XML summary.
2. If Resort XML MD5 or snapshot hash unchanged → skip LLM; reuse last narrative from DynamoDB.
3. Else: build a small JSON payload; call Gemini (or chosen model) with system prompt + payload; parse response; store narrative in `Live_Log` / `FRONTEND_META`; include in `index.html` (or `data.json`).

See ARCHITECTURE §2 (Logic Sequence) and PROJECT_STATUS §2 (Content logic & AI).
