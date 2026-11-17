"""CareerSIM manga character generation: ComfyUI on Modal.

One Modal app exposing:

- ``ui`` — interactive ComfyUI (``modal serve modal_app/app.py``) for developing
  workflows against the exact models the API uses.
- ``ComfyUI`` — headless API (``modal deploy modal_app/app.py``) executing the
  API-format workflows in ``../workflows`` and returning PNGs:
    * ``base``: Animagine XL 4.0 full-body master sprite (+ BiRefNet alpha cut-out).
    * ``edit``: Qwen-Image-Edit-2509 identity-preserving derived shot (face
      expression, body part, alternate framing) from a reference image.

See ../README.md for usage and ../RESEARCH.md for design rationale.
"""

import json
import random
import subprocess
import uuid
from pathlib import Path
from typing import Any, Optional

import modal
import modal.experimental

APP_NAME = "careersim-imagegen"

COMFYUI_VERSION = "0.27.0"
COMFY_CLI_VERSION = "1.12.0"
BIREFNET_NODE_VERSION = "1.1.4"

GPU = "L40S"
MINUTES = 60

COMFY_DIR = Path("/root/comfy/ComfyUI")
INPUT_DIR = COMFY_DIR / "input"
OUTPUT_DIR = COMFY_DIR / "output"
MODELS_DIR = COMFY_DIR / "models"
CACHE_DIR = "/cache"

# (HF repo, filename in repo, ComfyUI models/ subdir, rename-to or None)
HF_MODELS: list[tuple[str, str, str, Optional[str]]] = [
    (
        "cagliostrolab/animagine-xl-4.0",
        "animagine-xl-4.0-opt.safetensors",
        "checkpoints",
        None,
    ),
    (
        "Comfy-Org/Qwen-Image-Edit_ComfyUI",
        "split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors",
        "diffusion_models",
        None,
    ),
    (
        "Comfy-Org/Qwen-Image_ComfyUI",
        "split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors",
        "text_encoders",
        None,
    ),
    (
        "Comfy-Org/Qwen-Image_ComfyUI",
        "split_files/vae/qwen_image_vae.safetensors",
        "vae",
        None,
    ),
    (
        "lightx2v/Qwen-Image-Lightning",
        "Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors",
        "loras",
        None,
    ),
    # BiRefNet "General" (MIT) for background removal; the ComfyUI_BiRefNet_ll node
    # expects it at models/BiRefNet/General.safetensors.
    ("ZhengPeng7/BiRefNet", "model.safetensors", "BiRefNet", "General.safetensors"),
]


def hf_download() -> None:
    """Download all model weights into the cache Volume and symlink them into ComfyUI."""
    from huggingface_hub import hf_hub_download

    for repo_id, filename, subdir, rename in HF_MODELS:
        local_path = hf_hub_download(repo_id=repo_id, filename=filename, cache_dir=CACHE_DIR)
        target = MODELS_DIR / subdir / (rename or Path(filename).name)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_symlink() or target.exists():
            target.unlink()
        target.symlink_to(local_path)
        print(f"linked {target} -> {local_path}")


cache_vol = modal.Volume.from_name(f"{APP_NAME}-hf-cache", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    # libgl1/libglib2.0-0 for opencv-python pulled in by the BiRefNet node.
    .apt_install("git", "libgl1", "libglib2.0-0")
    .uv_pip_install(
        f"comfy-cli=={COMFY_CLI_VERSION}",
        "fastapi[standard]==0.115.4",
    )
    .run_commands(
        f"comfy --skip-prompt install --fast-deps --nvidia --version {COMFYUI_VERSION}"
    )
    .run_commands(
        f"comfy node install --fast-deps comfyui_birefnet_ll@{BIREFNET_NODE_VERSION}"
    )
    .uv_pip_install("huggingface-hub==0.36.0")
    .env({"HF_XET_HIGH_PERFORMANCE": "1"})
    .run_function(hf_download, volumes={CACHE_DIR: cache_vol}, timeout=60 * MINUTES)
    # Workflow JSONs are mounted (not baked) so edits only need a redeploy, not a rebuild.
    .add_local_dir(
        Path(__file__).parent.parent / "workflows", remote_path="/root/workflows"
    )
)

app = modal.App(name=APP_NAME, image=image)


# ---------------------------------------------------------------------------
# Workflow templates and patching
#
# Node ids below refer to ../workflows/character_base.json and
# ../workflows/character_edit.json. Keep them in sync when editing the JSONs.
# ---------------------------------------------------------------------------

BASE_WORKFLOW_FILE = "character_base.json"
EDIT_WORKFLOW_FILE = "character_edit.json"

BASE_NODES = {
    "positive": "2",
    "negative": "3",
    "latent": "4",
    "sampler": "5",
    "save_raw": "7",
    "alpha_branch": ("8", "9", "10", "11"),
    "save_alpha": "12",
}

EDIT_NODES = {
    "unet": "1",
    "lora": "2",
    "model_sampling": "3",
    "load_image": "7",
    "positive": "9",
    "negative": "10",
    "sampler": "12",
    "save_raw": "14",
    "alpha_branch": ("15", "16", "17", "18"),
    "save_alpha": "19",
}

BASE_DEFAULTS = {"width": 832, "height": 1216, "steps": 28, "cfg": 5.0}
EDIT_LIGHTNING_DEFAULTS = {"steps": 4, "cfg": 1.0}
EDIT_FULL_DEFAULTS = {"steps": 20, "cfg": 4.0}

MAX_DIMENSION = 2048
MAX_STEPS = 60
SEED_MAX = 2**32 - 1


def _workflows_dir() -> Path:
    local = Path(__file__).resolve().parent.parent / "workflows"
    if local.is_dir():
        return local
    return Path("/root/workflows")


def load_workflow(filename: str) -> dict[str, Any]:
    return json.loads((_workflows_dir() / filename).read_text())


def _apply_output_prefixes(
    workflow: dict[str, Any],
    nodes: dict[str, Any],
    client_id: str,
    remove_background: bool,
) -> dict[str, str]:
    """Point SaveImage nodes at unique prefixes; drop the alpha branch if unused.

    Returns a mapping of output name ("raw"/"alpha") -> filename prefix.
    """
    prefixes = {"raw": f"{client_id}_raw"}
    workflow[nodes["save_raw"]]["inputs"]["filename_prefix"] = prefixes["raw"]
    if remove_background:
        prefixes["alpha"] = f"{client_id}_alpha"
        workflow[nodes["save_alpha"]]["inputs"]["filename_prefix"] = prefixes["alpha"]
    else:
        for node_id in (*nodes["alpha_branch"], nodes["save_alpha"]):
            workflow.pop(node_id, None)
    return prefixes


def build_base_workflow(
    *,
    prompt: str,
    seed: int,
    client_id: str,
    negative_prompt: Optional[str] = None,
    width: Optional[int] = None,
    height: Optional[int] = None,
    steps: Optional[int] = None,
    cfg: Optional[float] = None,
    remove_background: bool = True,
) -> tuple[dict[str, Any], dict[str, str]]:
    """Patch the txt2img master-sprite workflow. Returns (workflow, output prefixes)."""
    workflow = load_workflow(BASE_WORKFLOW_FILE)
    nodes = BASE_NODES

    workflow[nodes["positive"]]["inputs"]["text"] = prompt
    if negative_prompt is not None:
        workflow[nodes["negative"]]["inputs"]["text"] = negative_prompt

    latent = workflow[nodes["latent"]]["inputs"]
    latent["width"] = min(int(width or BASE_DEFAULTS["width"]), MAX_DIMENSION)
    latent["height"] = min(int(height or BASE_DEFAULTS["height"]), MAX_DIMENSION)

    sampler = workflow[nodes["sampler"]]["inputs"]
    sampler["seed"] = seed
    sampler["steps"] = min(int(steps or BASE_DEFAULTS["steps"]), MAX_STEPS)
    sampler["cfg"] = float(cfg if cfg is not None else BASE_DEFAULTS["cfg"])

    prefixes = _apply_output_prefixes(workflow, nodes, client_id, remove_background)
    return workflow, prefixes


def build_edit_workflow(
    *,
    instruction: str,
    reference_image: str,
    seed: int,
    client_id: str,
    negative_prompt: Optional[str] = None,
    lightning: bool = True,
    steps: Optional[int] = None,
    cfg: Optional[float] = None,
    remove_background: bool = False,
) -> tuple[dict[str, Any], dict[str, str]]:
    """Patch the identity-preserving edit workflow. Returns (workflow, output prefixes)."""
    workflow = load_workflow(EDIT_WORKFLOW_FILE)
    nodes = EDIT_NODES

    workflow[nodes["positive"]]["inputs"]["prompt"] = instruction
    if negative_prompt is not None:
        workflow[nodes["negative"]]["inputs"]["prompt"] = negative_prompt
    workflow[nodes["load_image"]]["inputs"]["image"] = reference_image

    defaults = EDIT_LIGHTNING_DEFAULTS if lightning else EDIT_FULL_DEFAULTS
    if not lightning:
        # Bypass the Lightning LoRA: feed the UNet straight into ModelSamplingAuraFlow.
        workflow.pop(nodes["lora"], None)
        workflow[nodes["model_sampling"]]["inputs"]["model"] = [nodes["unet"], 0]

    sampler = workflow[nodes["sampler"]]["inputs"]
    sampler["seed"] = seed
    sampler["steps"] = min(int(steps or defaults["steps"]), MAX_STEPS)
    sampler["cfg"] = float(cfg if cfg is not None else defaults["cfg"])

    prefixes = _apply_output_prefixes(workflow, nodes, client_id, remove_background)
    return workflow, prefixes


# ---------------------------------------------------------------------------
# Interactive ComfyUI (workflow development)
# ---------------------------------------------------------------------------


@app.function(
    max_containers=1,
    gpu=GPU,
    volumes={CACHE_DIR: cache_vol},
)
@modal.concurrent(max_inputs=10)  # the UI frontend fires several API calls at once
@modal.web_server(8000, startup_timeout=2 * MINUTES)
def ui():
    subprocess.Popen("comfy launch -- --listen 0.0.0.0 --port 8000", shell=True)


# ---------------------------------------------------------------------------
# Headless API
# ---------------------------------------------------------------------------


@app.cls(
    gpu=GPU,
    volumes={CACHE_DIR: cache_vol},
    scaledown_window=5 * MINUTES,
    timeout=30 * MINUTES,
)
@modal.concurrent(max_inputs=4)  # ComfyUI queues prompts internally
class ComfyUI:
    port: int = 8000

    @modal.enter()
    def launch_comfy_background(self):
        subprocess.run(
            f"comfy launch --background -- --port {self.port}", shell=True, check=True
        )

    @modal.method()
    def infer(
        self,
        workflow: dict[str, Any],
        output_prefixes: dict[str, str],
        input_images: Optional[dict[str, bytes]] = None,
    ) -> dict[str, bytes]:
        """Run one API-format workflow and collect its outputs.

        ``input_images`` are written into ComfyUI's input directory so LoadImage
        nodes can reference them by filename. Returns output-name -> PNG bytes,
        keyed like ``output_prefixes``.
        """
        self.poll_server_health()

        if input_images:
            INPUT_DIR.mkdir(parents=True, exist_ok=True)
            for filename, data in input_images.items():
                (INPUT_DIR / filename).write_bytes(data)

        workflow_path = Path("/tmp") / f"{uuid.uuid4().hex}.json"
        workflow_path.write_text(json.dumps(workflow))
        subprocess.run(
            f"comfy run --workflow {workflow_path} --wait --timeout 1200 --verbose",
            shell=True,
            check=True,
        )

        results: dict[str, bytes] = {}
        for name, prefix in output_prefixes.items():
            matches = sorted(OUTPUT_DIR.glob(f"{prefix}*"))
            if not matches:
                raise RuntimeError(
                    f"no output produced for prefix {prefix!r}; "
                    f"output dir contains: {[p.name for p in OUTPUT_DIR.iterdir()]}"
                )
            results[name] = matches[-1].read_bytes()
        return results

    @modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
    def api(self, item: dict):
        """Generate one image set.

        Body (JSON):
          workflow: "base" | "edit"                       (default "base")
          prompt: str            base: full positive prompt; edit: instruction
          negative_prompt: str   optional override
          seed: int              optional; random when omitted
          remove_background: bool  default true for base, false for edit
          width, height, steps, cfg: optional overrides (base: 832x1216/28/5.0)
          image_b64: str         edit only (required): reference PNG, base64
          lightning: bool        edit only: 4-step LoRA fast path (default true)

        Response (JSON): {"seed": int, "images": {"raw": b64, "alpha"?: b64}}
        """
        import base64 as b64mod

        from fastapi import HTTPException
        from fastapi.responses import JSONResponse

        kind = item.get("workflow", "base")
        prompt = item.get("prompt")
        if not prompt or not isinstance(prompt, str):
            raise HTTPException(status_code=400, detail="'prompt' (string) is required")

        seed = item.get("seed")
        seed = random.randint(0, SEED_MAX) if seed is None else int(seed) % (SEED_MAX + 1)
        client_id = uuid.uuid4().hex
        input_images: Optional[dict[str, bytes]] = None

        if kind == "base":
            workflow, prefixes = build_base_workflow(
                prompt=prompt,
                seed=seed,
                client_id=client_id,
                negative_prompt=item.get("negative_prompt"),
                width=item.get("width"),
                height=item.get("height"),
                steps=item.get("steps"),
                cfg=item.get("cfg"),
                remove_background=bool(item.get("remove_background", True)),
            )
        elif kind == "edit":
            image_b64 = item.get("image_b64")
            if not image_b64:
                raise HTTPException(
                    status_code=400, detail="'image_b64' is required for the edit workflow"
                )
            try:
                reference_bytes = b64mod.b64decode(image_b64)
            except Exception:
                raise HTTPException(status_code=400, detail="'image_b64' is not valid base64")
            reference_name = f"{client_id}_ref.png"
            input_images = {reference_name: reference_bytes}
            workflow, prefixes = build_edit_workflow(
                instruction=prompt,
                reference_image=reference_name,
                seed=seed,
                client_id=client_id,
                negative_prompt=item.get("negative_prompt"),
                lightning=bool(item.get("lightning", True)),
                steps=item.get("steps"),
                cfg=item.get("cfg"),
                remove_background=bool(item.get("remove_background", False)),
            )
        else:
            raise HTTPException(
                status_code=400, detail=f"unknown workflow {kind!r}; expected 'base' or 'edit'"
            )

        images = self.infer.local(workflow, prefixes, input_images)
        return JSONResponse(
            {
                "seed": seed,
                "images": {
                    name: b64mod.b64encode(data).decode("ascii")
                    for name, data in images.items()
                },
            }
        )

    def poll_server_health(self) -> None:
        import socket
        import urllib.error
        import urllib.request

        try:
            req = urllib.request.Request(f"http://127.0.0.1:{self.port}/system_stats")
            urllib.request.urlopen(req, timeout=5)
            print("ComfyUI server is healthy")
        except (socket.timeout, urllib.error.URLError) as e:
            # Stop taking new work and let Modal replace this container; queued
            # inputs fail and should be retried client-side.
            print(f"Server health check failed: {e}")
            modal.experimental.stop_fetching_inputs()
            raise Exception("ComfyUI server is not healthy, stopping container")


# ---------------------------------------------------------------------------
# Smoke test: `modal run modal_app/app.py`
# ---------------------------------------------------------------------------


@app.local_entrypoint()
def smoke(
    description: str = (
        "1girl, solo, office lady, mid-twenties, long dark brown hair, amber eyes, "
        "navy blazer, white shirt, pencil skirt, id badge on lanyard"
    ),
    seed: int = 42,
):
    """Generate one sample character (base + smiling face) without the HTTP layer."""
    out_dir = Path("/tmp/imagegen-smoke")
    out_dir.mkdir(parents=True, exist_ok=True)
    comfy = ComfyUI()

    base_prompt = (
        f"{description}, standing, full body, looking at viewer, simple background, "
        "white background, masterpiece, high score, great score, absurdres"
    )
    client_id = uuid.uuid4().hex
    workflow, prefixes = build_base_workflow(
        prompt=base_prompt, seed=seed, client_id=client_id
    )
    print("generating base sprite...")
    base_images = comfy.infer.remote(workflow, prefixes)
    (out_dir / "base_raw.png").write_bytes(base_images["raw"])
    (out_dir / "base.png").write_bytes(base_images["alpha"])

    client_id = uuid.uuid4().hex
    reference_name = f"{client_id}_ref.png"
    workflow, prefixes = build_edit_workflow(
        instruction=(
            "Close-up portrait of this exact character's face and shoulders, smiling "
            "warmly with a cheerful, happy expression. Keep the same character: "
            "identical face, hairstyle, hair color, eye color and outfit. "
            "Clean white background, anime style."
        ),
        reference_image=reference_name,
        seed=seed + 1,
        client_id=client_id,
    )
    print("generating face shot...")
    edit_images = comfy.infer.remote(
        workflow, prefixes, {reference_name: base_images["raw"]}
    )
    (out_dir / "face_happy.png").write_bytes(edit_images["raw"])

    print(f"wrote {out_dir}/base_raw.png, base.png, face_happy.png")
