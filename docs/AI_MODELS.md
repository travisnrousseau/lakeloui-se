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

## OpenRouter (implementation)

The backend uses **OpenRouter** so you can switch models and providers without changing code. See [openrouter.ai](https://openrouter.ai/docs).

### Environment variables

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | **Required** to call the LLM. If unset, the Lambda skips OpenRouter and uses the built‑in fallback narrative. |
| `OPENROUTER_MODEL` | Model id (e.g. `google/gemini-2.0-flash-001`, `openai/gpt-4o-mini`, `anthropic/claude-3.5-haiku`). Default: `google/gemini-2.0-flash-001`. |
| `OPENROUTER_SYSTEM_PROMPT` | Full system prompt string. If set, overrides file and built‑in default. Use for Lambda (env or Secrets Manager). |
| `OPENROUTER_SYSTEM_PROMPT_FILE` | Path to a file containing the system prompt. Used when `OPENROUTER_SYSTEM_PROMPT` is not set. Useful for local dry‑render. |
| `OPENROUTER_SYSTEM_PROMPT_4AM` | System prompt for the **4am (Snow Reporters)** report. Overrides file and built‑in 4am default when set. See [AI_WEATHER_OUTPUT](AI_WEATHER_OUTPUT.md) §1.1. |
| `OPENROUTER_SYSTEM_PROMPT_FILE_4AM` | Path to file for 4am system prompt. Used when `OPENROUTER_SYSTEM_PROMPT_4AM` is not set. |
| `REPORT_TYPE` | Set to `4am` to force the 4am (technical) report regardless of time. Used for dry‑render or override. Otherwise 4am is auto when current hour MST is 4. |

### 4am report and STASH FINDER area

When the run is **4am MST** (or `REPORT_TYPE=4am`), the backend uses the **4am (Snow Reporters)** system prompt and puts the **full technical brief** in the **STASH FINDER** card. The card label becomes **04:00 REPORT**; the hero shows a one‑line pointer. See [AI_WEATHER_OUTPUT](AI_WEATHER_OUTPUT.md) §1.1 and §4.

### System prompt precedence

1. **`OPENROUTER_SYSTEM_PROMPT`** (env) — use this to fully control the prompt (e.g. paste CONTENT_LOGIC + AI_WEATHER_OUTPUT rules).
2. **`OPENROUTER_SYSTEM_PROMPT_FILE`** — path to a `.txt` or `.md` file; read at runtime. Relative paths are resolved from process cwd.
3. **Built‑in default** — short instructions for JSON `{ summary, stash_name?, stash_note?, groomer_pick? }` and Mountain Guide tone.

For **4am** runs, the same precedence applies using `OPENROUTER_SYSTEM_PROMPT_4AM` and `OPENROUTER_SYSTEM_PROMPT_FILE_4AM`; the built‑in 4am default is technical (Pika new snow, 12h forecast, wind + best skiing, physics terms explained).

An example prompt file is in **`docs/prompts/forecast-system-example.txt`**. For local dry‑render: `OPENROUTER_SYSTEM_PROMPT_FILE=docs/prompts/forecast-system-example.txt` (path relative to cwd).

### Changing the model

Set `OPENROUTER_MODEL` to any [OpenRouter model id](https://openrouter.ai/docs#models), e.g.:

- `google/gemini-2.0-flash-001` (default)
- `openai/gpt-4o-mini`
- `anthropic/claude-3.5-haiku`
- `anthropic/claude-3.5-sonnet`

No code change required.

---

## Wiring (high level)

1. Lambda computes alerts (inversion, orographic, Chinook, freezing level, stash, groomer, history_alert) and has resort XML summary.
2. If Resort XML MD5 or snapshot hash unchanged → skip LLM; reuse last narrative from DynamoDB.
3. Else: build a small JSON payload; call **OpenRouter** with `OPENROUTER_MODEL` and system prompt (env or file); parse response; use `summary` for hero, `stash_name`/`stash_note` for STASH FINDER; include in `index.html`.

See ARCHITECTURE §2 (Logic Sequence) and PROJECT_STATUS §2 (Content logic & AI).
