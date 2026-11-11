# imagegen — manga character pipeline (ComfyUI on Modal)

Generates consistent 2D manga characters for CareerSIM's visual-novel features. One
[ComfyUI](https://github.com/comfyanonymous/ComfyUI) deployment on
[modal.com](https://modal.com) produces, per character:

- a **full-body master sprite** (Animagine XL 4.0, transparent background via BiRefNet);
- **derived shots of the same character** — face close-ups with different expressions,
  waist-up shots, hands, profile views — using Qwen-Image-Edit-2509 instruction edits
  that preserve the character's identity.

See [RESEARCH.md](RESEARCH.md) for the model/approach research and licensing notes.

```
imagegen/
├── modal_app/app.py           # Modal app: image build, model downloads, ComfyUI UI + API
├── workflows/
│   ├── character_base.json    # API-format: txt2img master sprite (+ alpha branch)
│   └── character_edit.json    # API-format: identity-preserving edit (+ alpha branch)
├── scripts/generate_character.py  # CLI: character spec -> full asset bundle
└── output/<slug>/             # generated bundles (gitignored)
```

## Prerequisites

- [uv](https://docs.astral.sh/uv/) (same toolchain as `agent/`)
- A [Modal](https://modal.com) account (Starter plan includes $30/month free compute)

```bash
cd imagegen
uv sync
uv run modal setup   # one-time browser auth; writes ~/.modal.toml
```

No Hugging Face token is needed — all models are public and ungated.

## Deploy

```bash
uv run modal deploy modal_app/app.py
```

First deploy builds the image and downloads ~38 GB of model weights into a persistent
Modal Volume (one-time, ~5–15 min). The deploy prints two URLs:

- `...-comfyui-api.modal.run` — the generation API (used by the client below)
- `...-ui.modal.run` — interactive ComfyUI (for workflow development)

The API endpoint is protected by [Modal proxy auth](https://modal.com/docs/guide/webhook-proxy-auth).
Create a proxy token in the Modal dashboard (Settings → Proxy Auth Tokens) and export it:

```bash
export MODAL_PROXY_TOKEN_ID=wk-...
export MODAL_PROXY_TOKEN_SECRET=ws-...
```

### Smoke test without the HTTP endpoint

```bash
uv run modal run modal_app/app.py
```

generates one sample character (base + one smiling face shot) straight through the
deployed infrastructure and writes the PNGs to `/tmp/imagegen-smoke/`.

## Generate a character bundle

```bash
uv run python scripts/generate_character.py \
  --endpoint https://<workspace>--careersim-imagegen-comfyui-api.modal.run \
  --slug aiko \
  --description "1girl, solo, aiko, office lady, mid-twenties, long dark brown hair, amber eyes, navy blazer, white shirt, pencil skirt, id badge on lanyard" \
  --expressions neutral,happy,sad,surprised \
  --shots upper_body,hands
```

Output lands in `output/aiko/`:

```
output/aiko/
├── base.png            # transparent full-body sprite (the VN asset)
├── base_raw.png        # same render before background removal (edit reference)
├── face_neutral.png    # face close-ups, same character, per expression
├── face_happy.png
├── face_sad.png
├── face_surprised.png
├── shot_upper_body.png
├── shot_hands.png
└── manifest.json       # spec, seeds and parameters for reproducibility
```

Built-in expressions: `neutral`, `happy`, `sad`, `angry`, `surprised`, `worried`,
`embarrassed`, `determined`. Built-in shots: `upper_body`, `hands`, `profile`,
`back`. Anything else can be defined in a spec file.

### Spec-file mode

For repeatable casts, keep one JSON file per character:

```bash
uv run python scripts/generate_character.py --spec specs/aiko.json
```

```json
{
  "slug": "aiko",
  "description": "1girl, solo, office lady, mid-twenties, long dark brown hair, amber eyes, navy blazer",
  "seed": 42,
  "expressions": [
    "neutral",
    "happy",
    { "name": "smug", "instruction": "with a confident smug smile, one eyebrow raised" }
  ],
  "shots": [
    "upper_body",
    { "name": "phone", "instruction": "Close-up of the character's hand holding a smartphone" }
  ]
}
```

Fixed seeds make the base sprite reproducible; each derived shot records its own seed in
`manifest.json`.

## Developing workflows interactively

```bash
uv run modal serve modal_app/app.py
```

opens a live ComfyUI at the printed `...-ui.modal.run` URL with all models available.
Build/tweak a graph there, use *Export (API)* and drop the JSON into `workflows/` — the
API loads workflow files fresh from the container on each request, so `modal deploy`
picks up changes without an image rebuild.

## Costs and performance

- GPU: one **L40S** (~$1.95/h, billed per second, scales to zero when idle).
- Warm timings: base sprite ~10–15 s; each edit shot ~15–25 s with the Lightning 4-step
  LoRA (default). A full bundle (base + 6 shots) ≈ 2–4 GPU-minutes ≈ **$0.05–0.15**.
- Cold start adds ~1–3 min (server boot + first model load from the Volume). The
  container stays warm for 5 minutes after the last request (`scaledown_window`).
- Hero-quality edits: pass `--no-lightning` to render edits with the full 20-step / CFG 4
  schedule (~4–8× slower).

## Troubleshooting

- **401 from the API** — missing/wrong proxy token headers; re-check
  `MODAL_PROXY_TOKEN_ID` / `MODAL_PROXY_TOKEN_SECRET`.
- **First request times out** — cold start plus first Qwen load can exceed client
  timeouts; the client retries by default. `modal app logs careersim-imagegen` shows
  server-side progress.
- **Identity drift on a shot** — regenerate with a different `--seed`; the edit model is
  seeded per shot. Stronger phrasing in the instruction ("this exact character,
  identical face and hair") also helps.
- **Rebuilding models** — weights live in the `careersim-imagegen-hf-cache` Volume;
  deleting it forces a re-download on next build.
