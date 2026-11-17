# OpenRouter alternative to the Modal pipeline

Checked on 2026-11-12. The original implementation remains in
[PR #67](https://github.com/lf1up/careersim/pull/67).

## What can be replaced

The original pipeline uses Animagine XL to create a base sprite, Qwen Image Edit
to derive expressions and body shots, and BiRefNet to remove backgrounds. It
manages these models through ComfyUI on a Modal GPU with about 38 GB of weights.

OpenRouter now exposes a dedicated image endpoint:

- `POST https://openrouter.ai/api/v1/images`
- A text `prompt` and model select the base generation.
- `input_references` accepts base64 image data URLs for derived shots.
- `background: "transparent"` and `output_format: "png"` request alpha output
  from models that support it.
- The response contains `data[].b64_json` and optional usage/cost information.

Sources: [image guide](https://openrouter.ai/docs/guides/overview/multimodal/image-generation),
[request reference](https://openrouter.ai/docs/api/api-reference/images/generate-an-image).

This preserves the base-plus-derived-shots workflow, but changes the underlying
models. It is not an API wrapper around the same Animagine/Qwen checkpoints.

## Model choice

The default, `openai/gpt-image-2.6-flare`, currently advertises reference images,
transparent backgrounds, and PNG output in its
[provider capabilities](https://openrouter.ai/api/v1/images/models/openai/gpt-image-2.6-flare/endpoints).
This avoids a separate background-removal dependency. It is an implementation
choice based on capabilities, not a measured ranking of manga quality.

Another candidate is `sourceful/riverflow-v2.6-pro`, whose
[provider capabilities](https://openrouter.ai/api/v1/images/models/sourceful/riverflow-v2.6-pro/endpoints)
also advertise references and transparency. Compare sample bundles before
choosing a production default. Models without transparent output need a separate
background-removal step and are not suitable drop-in replacements for this CLI.

## What we retain and give up

Retain character specs, built-in expressions and shots, custom instructions,
transparent sprites, white-background companions, and local asset bundles.
The white-background companion is a local composite of the transparent sprite,
not a separate pre-removal render as it was in the Modal pipeline.

Give up exact diffusion checkpoints, sampler/LoRA control, the ComfyUI editor,
and fixed seeds. We also exchange GPU infrastructure costs for provider image
charges. No latency, visual-quality, or cost improvement is claimed without a
live comparison. Model/provider terms must be assessed for the chosen service;
the old checkpoint-license research does not establish hosted-service rights.

## Review findings in the original PR

- The ComfyUI development server lacks proxy authentication, although the
  separate generation API has it. Anyone with the UI URL can access that server.
- The CLI writes its manifest only at the end. A later failure leaves earlier
  images without recorded prompts/seeds; rerunning overwrites the base.
- HTTP 429 is treated as a permanent client error instead of a retryable limit.
- No imagegen tests are checked into the original PR or run by its CI jobs.

The alternative removes the exposed server, saves incremental manifests,
checks files before resuming, retries rate limits, and adds offline tests to CI.
It still needs a live sample bundle to judge appearance and character identity.
