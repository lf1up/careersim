# OpenRouter character bundles

Keep PR #67 as the Modal implementation, rebased on current main. Build the
requested alternative on `codex/imagegen-openrouter`.

## Approach

Use OpenRouter's dedicated `POST /api/v1/images` endpoint from the existing
Python CLI. Generate a transparent base sprite, then pass it as an image
reference for each expression or shot. Keep character descriptions, built-in
expressions/shots, custom instructions, PNG filenames, and a JSON manifest.
Remove the Modal app, ComfyUI workflows, model downloads, and Modal dependency.

Retaining Modal behind a provider switch would keep the deployment burden.
Using a model without transparency would require a separate background-removal
service. The selected alternative uses a model supporting reference images and
native transparent output; no app integration or new service is needed.

## Implementation choices

- Default model: `openai/gpt-image-2.6-flare`, selectable via `--model` or
  `OPENROUTER_IMAGE_MODEL`. The provider's current capability record supports
  reference images, PNG output, and transparent backgrounds.
- Authenticate with `OPENROUTER_API_KEY`; never save credentials in a manifest.
- Use `requests` for HTTP and Pillow to verify real PNG/alpha output and create
  the white-background `base_raw.png` locally from the same base pixels.
- Preserve `--alpha-edits`. Explain that unsupported seeds, diffusion options,
  and exact old dimensions must be removed from legacy specs.
- Save the manifest atomically after each successful image. `--resume` reuses
  completed files only when the normalized spec and generation settings match.
- Refuse accidental overwrite, unsafe filenames, duplicate output names,
  malformed responses, and opaque output when transparency was requested.
- Retry rate limits and server failures within the configured retry budget.
  Requests can be billed again after an ambiguous network failure.

## Validation

Exercise the CLI with realistic mocked HTTP responses and real PNG files,
including partial failure/resume, transparent and opaque output, rate limits,
authentication failures, and invalid inputs. Add these tests to CI. Live image
quality, identity consistency, latency, and cost require a paid sample run.

Sources checked on 2026-11-12:
- https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- https://openrouter.ai/docs/api/api-reference/images/generate-an-image
- https://openrouter.ai/api/v1/images/models/openai/gpt-image-2.6-flare/endpoints
