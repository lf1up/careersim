# Research: ComfyUI manga character pipeline on Modal

Findings behind the design of `imagegen/`. Goal: generate 2D manga characters for
CareerSIM's visual-novel features, with the ability to derive **different body parts of
the same character** — especially the face with multiple expressions — without identity
drift ("real interactive manga adventure" style: one full-body sprite per character plus
matching close-up shots).

## 1. Running ComfyUI on modal.com

Modal's canonical ComfyUI recipe (from the official `modal-labs/modal-examples`
`06_gpu_and_ml/comfyui` example, and Modal's [image & video solutions
page](https://modal.com/solutions/image-and-video)):

1. Build a `modal.Image` with [`comfy-cli`](https://github.com/Comfy-Org/comfy-cli) and a
   **pinned** ComfyUI version (`comfy --skip-prompt install --fast-deps --nvidia --version X`).
2. Install custom nodes at build time from the [ComfyUI Registry](https://registry.comfy.org)
   (`comfy node install --fast-deps <id>@<version>`), so the image is reproducible.
3. Download model weights with `huggingface_hub.hf_hub_download` inside an
   `Image.run_function` build step, caching to a **Modal Volume** and symlinking files into
   ComfyUI's `models/` subdirectories. Rebuilds and new containers reuse the cache.
4. Expose two entry points:
   - an **interactive ComfyUI web UI** (`modal serve`) for developing workflows visually;
   - a **headless API** — a `modal.Cls` that starts `comfy launch --background` once per
     container (`@modal.enter`), then executes exported **API-format** workflow JSON via
     `comfy run --workflow ... --wait` per request and returns the output PNGs.
5. Scale-to-zero between requests; `scaledown_window` keeps a warm container for a few
   minutes after each request.

Notes:

- Workflows must be exported in **API format** (Export (API) in the ComfyUI menu, or
  authored directly). UI-format JSON (with `nodes`/`links`/subgraphs) is not accepted by
  `POST /prompt` without conversion.
- Web endpoints are protected with [Modal proxy auth](https://modal.com/docs/guide/webhook-proxy-auth)
  (`requires_proxy_auth=True`; clients send `Modal-Key` / `Modal-Secret` headers) — no
  custom auth code needed.
- Cold starts are ~1–3 min (server boot + first model load from Volume). Modal's
  CPU/GPU **memory snapshots** can cut this several-fold but are experimental with
  ComfyUI (requires forcing CPU-only init during snapshot). Deferred; see § 6.
- GPU pricing (July 2026, per-second billing): T4 ≈ $0.59/h, L4 ≈ $0.80/h, A10 ≈ $1.10/h,
  **L40S ≈ $1.95/h**, A100-80GB ≈ $2.50/h, H100 ≈ $3.95/h. The Starter plan includes
  $30/month of free credits.

**GPU choice: L40S (48 GB).** Fits the SDXL-class base model (~7 GB), the fp8
Qwen-Image-Edit diffusion model (~20 GB) + Qwen2.5-VL text encoder (~9 GB), and BiRefNet
concurrently; ComfyUI offloads models under VRAM pressure automatically. A full character
bundle (base + ~6 edit shots, warm) is ~2–4 GPU-minutes ≈ **$0.05–0.15**.

## 2. Model stack and licensing

| Role | Model | File → ComfyUI dir | License |
| --- | --- | --- | --- |
| Base sprite (txt2img) | [Animagine XL 4.0 Opt](https://huggingface.co/cagliostrolab/animagine-xl-4.0) | `animagine-xl-4.0-opt.safetensors` → `checkpoints/` | CreativeML Open RAIL++-M (commercial use permitted) |
| Parts/expressions (edit) | [Qwen-Image-Edit-2509 fp8](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI) | `split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors` → `diffusion_models/` | Apache 2.0 |
| Text encoder for Qwen | [Qwen2.5-VL 7B fp8](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI) | `split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors` → `text_encoders/` | Apache 2.0 |
| VAE for Qwen | same repo | `split_files/vae/qwen_image_vae.safetensors` → `vae/` | Apache 2.0 |
| 4-step distillation LoRA | [lightx2v/Qwen-Image-Lightning](https://huggingface.co/lightx2v/Qwen-Image-Lightning) | `Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors` → `loras/` | Apache 2.0 |
| Background removal | [BiRefNet General](https://huggingface.co/ZhengPeng7/BiRefNet) | `model.safetensors` → `BiRefNet/General.safetensors` | MIT |

Base model candidates compared:

- **Animagine XL 4.0 Opt** (chosen): retrained-from-scratch SDXL anime model, the most
  polished out-of-the-box output, explicit commercial-use license, Danbooru-tag prompting.
- **Illustrious XL v2.0**: strong ecosystem base (most character LoRAs target it), similar
  openrail license; slightly rawer output without a fine-tune. Easy swap later — same
  workflow, different checkpoint file.
- **NoobAI-XL**: deepest character knowledge, but tuned for reproducing *existing*
  characters — less relevant since we generate original personas.
- **BRIA RMBG-2.0** for background removal was **rejected**: non-commercial license.
  BiRefNet General is MIT and equally standard (same `ComfyUI_BiRefNet_ll` node family).

## 3. Character consistency approaches compared

| Approach | Consistency | Novel shots (poses/parts) | Ops complexity | Verdict |
| --- | --- | --- | --- | --- |
| Prompt-only (same tags + seed) | Poor across shots | — | none | rejected |
| Master sprite + crop-and-refine (FaceDetailer / Impact Pack) | Very high (reuses pixels) | Limited to regions visible in the master | low | subset of our design; superseded by Qwen edits |
| **Qwen-Image-Edit-2509 instruction edits** | High (trained for person/character identity preservation, incl. cartoon) | Yes — arbitrary "same character, close-up of X" shots | low (native ComfyUI nodes since v0.3.60) | **chosen for stage B** |
| VNCCS suite ([AHEKOT/ComfyUI_VNCCS](https://github.com/AHEKOT/ComfyUI_VNCCS), MIT) | Very high | Yes (pose studio, emotion studio, costumes) | high — 7+ custom-node packs, UI-panel-centric workflows, own model manager | rejected for v1 (hard to pin/automate headless on Modal); re-evaluate if we need costume sets at scale |
| Per-character LoRA training | Highest at scale | Yes | high (training loop + dataset) | future option; VNCCS-style sheets or our bundles can be the training set |

The chosen hybrid:

- **Stage A — base**: Animagine XL generates one high-res full-body master sprite per
  character (fixed seed ⇒ reproducible), then BiRefNet cuts a transparent sprite.
  Danbooru-style prompts with Animagine's recommended quality/negative tags
  (`masterpiece, high score, great score, absurdres` / official negative list), Euler a,
  ~28 steps, CFG 5, 832×1216.
- **Stage B — parts/expressions**: Qwen-Image-Edit-2509 takes the master sprite plus an
  instruction ("Close-up portrait of this exact character's face, smiling…", "…of the
  character's hands…") and renders identity-preserving derived shots. The Lightning
  4-step LoRA cuts edits to 4 sampler steps (CFG 1.0) ≈ 4–8× faster with minor quality
  loss — the right default for asset iteration; disable per-request for hero assets
  (20 steps / CFG 4, per the official ComfyUI template's reference table).

The edit workflow mirrors the official ComfyUI template
(`image_qwen_image_edit_2509.json` from `Comfy-Org/workflow_templates`):
`UNETLoader → LoraLoaderModelOnly (Lightning) → ModelSamplingAuraFlow(shift=3) → CFGNorm`,
`TextEncodeQwenImageEditPlus` for positive/negative conditioning (both see the scaled
reference image), `FluxKontextImageScale` to normalize input resolution, and
`VAEEncode(reference)` as the initial latent.

## 4. Alpha-channel sprites

`RembgByBiRefNet` returns `(foreground image, mask)` with mask=1 on the character. Core
ComfyUI's `JoinImageWithAlpha` **inverts** the mask it receives (`alpha = 1.0 - mask`), so
the graph is `RembgByBiRefNet.mask → InvertMask → JoinImageWithAlpha.alpha`, then
`SaveImage` writes an RGBA PNG. Both workflows include this branch; the server drops it
when `remove_background` is false.

For edits, the (raw, non-alpha) master render is the reference input — ComfyUI's
`LoadImage` flattens RGBA onto black, so feeding the cut-out sprite would leak a black
background into the edit conditioning. The client therefore keeps `base_raw.png`
alongside the transparent `base.png` and sends the raw one to stage B.

## 5. Versions pinned in this directory

- ComfyUI `0.27.0` (Qwen-Image-Edit-2509 nodes are native since 0.3.60, Sept 2025)
- `comfy-cli` 1.12.0, `huggingface-hub` 0.36.0 (Modal's proven combo), `fastapi[standard]` 0.115.4
- Custom node: `comfyui_birefnet_ll@1.1.4` (ComfyUI Registry)
- `modal` ≥ 1.5

## 6. Future work

- **Wire into CareerSIM**: map `agent/data/personas.json` entries to character specs and
  generate bundles for the 9 existing personas; serve via the existing avatar route
  (`agent/src/careersim_agent/api/app.py`) or the S3 cast sync on `feat/personas-s3-sync`.
- **Poses**: Qwen-Image-Edit-2509 natively supports ControlNet-style keypoint/depth
  conditioning; add an OpenPose reference input for repeatable VN poses.
- **Costume variants**: prompt-level outfit swaps work today via edit instructions;
  VNCCS's clothes pipeline or a dedicated outfit LoRA if we need large wardrobes.
- **Per-character LoRA**: train on a generated bundle (~20–50 shots) when a character
  needs unlimited novel shots with maximum fidelity.
- **Cold starts**: adopt Modal memory snapshots (CPU snapshot with deferred CUDA init, or
  experimental `enable_gpu_snapshot`) if interactive latency starts to matter.
- **Newer editors**: Qwen-Image-Edit-2511+ improves character consistency further and has
  official ComfyUI templates; revisit the pinned model as these stabilize.
