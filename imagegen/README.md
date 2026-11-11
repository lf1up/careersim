# Character image bundles with OpenRouter

Generate a full-body manga sprite, then use that sprite as the reference for
matching expressions and alternate shots. This is the OpenRouter alternative to
[PR #67's Modal implementation](https://github.com/lf1up/careersim/pull/67).
It runs as a local Python CLI; no GPU server or model downloads are needed.
It is not yet connected to CareerSIM's persona or avatar routes.

## Setup

Requires Python 3.11+, [uv](https://docs.astral.sh/uv/), and an OpenRouter key
with image-generation credits.

```bash
cd imagegen
uv sync
export OPENROUTER_API_KEY=your-key
```

The default model is `openai/gpt-image-2.6-flare`. Override it with `--model` or
`OPENROUTER_IMAGE_MODEL`. Choose a model/provider supporting image references,
PNG output, transparent backgrounds, and your requested aspect ratio. Check the
[endpoint capabilities](https://openrouter.ai/api/v1/images/models/openai/gpt-image-2.6-flare/endpoints)
before changing models; capabilities differ between providers.

The CLI reads environment variables from the shell. It does not load `.env` files.

## Generate a bundle

```bash
uv run python scripts/generate_character.py \
  --slug aiko \
  --description "A manga office worker in her mid-twenties, long dark brown hair, amber eyes, navy blazer, white shirt, pencil skirt, ID badge" \
  --expressions neutral,happy,sad,surprised \
  --shots upper_body,hands
```

Output goes to `imagegen/output/aiko/`:

```text
base.png              transparent full-body sprite and reference for edits
base_raw.png          same pixels composited onto white locally
face_neutral.png       derived face shots
face_happy.png
face_sad.png
face_surprised.png
shot_upper_body.png    derived body shots
shot_hands.png
manifest.json         normalized spec, settings, prompts, hashes, API usage
```

The base always requires real transparency. Derived shots have white backgrounds
by default. Add `--alpha-edits` for transparent derived images and their
`*_raw.png` white-background companions. The CLI rejects invalid PNGs, fully
opaque sprites when transparency is required, and fully transparent empty sprites.

`--aspect-ratio` defaults to `2:3` for all images. Exact pixel dimensions depend
on the model. Every derived request uses the original base as its reference,
so edits do not accumulate changes from previous shots. Character consistency
still needs visual review; a reference is not a guarantee of identical features.

Built-in expressions: `neutral`, `happy`, `sad`, `angry`, `surprised`, `worried`,
`embarrassed`, `determined`. Built-in shots: `upper_body`, `hands`, `profile`, `back`.
Use `--expressions ''` for a base-only smoke test.

## Character specs

```json
{
  "slug": "aiko",
  "description": "Manga office worker, long dark brown hair, amber eyes, navy blazer",
  "expressions": [
    "neutral",
    "happy",
    {"name": "smug", "instruction": "Close-up portrait with a smug smile and one raised eyebrow"}
  ],
  "shots": [
    "upper_body",
    {"name": "phone", "instruction": "Close-up of this character's hand holding a smartphone"}
  ]
}
```

```bash
uv run python scripts/generate_character.py --spec specs/aiko.json
```

Custom instructions also receive the identity-preservation instruction. Names
must start with a letter or number and contain only letters, numbers, underscores,
or hyphens, up to 100 characters. Duplicate expression or shot names are rejected,
including names differing only by letter case and collisions with `_raw` companions.

Legacy Modal flags (`--endpoint`, proxy tokens, `--seed`, `--no-lightning`) are
removed. Old spec fields such as `seed`, `negative`, `width`, and `height` are
rejected with a migration message. Keep only `slug`, `description`, `expressions`,
and `shots`; select model and aspect ratio with CLI flags.

## Recover interrupted runs

The manifest is saved after each validated image. Run the same command with
`--resume` to keep completed images and request the remaining ones:

```bash
uv run python scripts/generate_character.py --spec specs/aiko.json --resume
```

Use the same model, aspect ratio, alpha setting, and character spec. Changed or
missing recorded images cause an error so a new base cannot silently be mixed
with older shots. White-background companions are recreated locally when needed.
A new run refuses an existing output directory. Use a new `--out` directory for
a different version of the same character.

One process may write a bundle at a time. After a forced process termination,
remove `output/<slug>/.generating` only after confirming that process has stopped.
Then resume. If the process stopped before the first manifest was written, use a
new output directory.

## Cost and failure behavior

Each image is a separate paid request. A base plus four expressions and two shots
makes seven requests. Consult the selected model's current endpoint pricing;
this implementation does not claim the original PR's estimated Modal cost.
`manifest.json` records the usage and cost returned by OpenRouter.

Network errors, HTTP 429, and HTTP 5xx retry twice by default. Use `--retries 0`
to disable retries. Numeric `Retry-After` delays are honored up to 60 seconds.
Authentication and other client errors stop immediately. The default request
timeout is 300 seconds and can be changed with `--timeout`.

A timeout can happen after the provider has generated and billed an image.
Retrying or resuming an unrecorded image can therefore incur another charge.
There is also a small interruption window between writing an image and recording
it in the manifest. Credentials are never stored in the bundle.

Hosted models can change and do not offer this CLI's old fixed-seed behavior.
Keep generated files as the source of truth; prompts alone cannot reproduce them.

## Tests

```bash
uv run python -m unittest discover -s tests -v
uv run python scripts/generate_character.py --help
```

Tests mock the HTTP boundary and process real PNG fixtures. CI runs them without
credentials or image-generation charges. Live artwork quality, identity
consistency, latency, and cost still need a paid sample run.
