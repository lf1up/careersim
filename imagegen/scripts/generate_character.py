#!/usr/bin/env python3
"""Generate a full manga character asset bundle via the imagegen Modal API.

Produces, for one character spec:
  output/<slug>/base.png            transparent full-body master sprite
  output/<slug>/base_raw.png        same render before background removal
  output/<slug>/face_<expr>.png     face close-ups (same character) per expression
  output/<slug>/shot_<name>.png     other derived shots (upper body, hands, ...)
  output/<slug>/manifest.json       spec + seeds + parameters for reproducibility

Usage (see imagegen/README.md):
  python scripts/generate_character.py --endpoint https://... --slug aiko \
      --description "1girl, solo, office lady, ..." \
      --expressions neutral,happy,sad,surprised --shots upper_body,hands

Auth: Modal proxy tokens via --token-id/--token-secret or
MODAL_PROXY_TOKEN_ID / MODAL_PROXY_TOKEN_SECRET env vars.
"""

import argparse
import base64
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import requests

QUALITY_TAGS = "masterpiece, high score, great score, absurdres"
DEFAULT_NEGATIVE = (
    "lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, "
    "fewer digits, cropped, worst quality, low quality, low score, bad score, "
    "average score, signature, watermark, username, blurry"
)
BASE_PROMPT_SUFFIX = (
    "standing, full body, looking at viewer, simple background, white background"
)

IDENTITY_CLAUSE = (
    "Keep the same character: identical face, hairstyle, hair color, eye color "
    "and outfit."
)
STYLE_CLAUSE = "Clean white background, anime style."

EXPRESSIONS: dict[str, str] = {
    "neutral": "with a calm, neutral expression",
    "happy": "smiling warmly with a cheerful, happy expression",
    "sad": "with a sad, downcast expression and slightly teary eyes",
    "angry": "with an angry, frustrated expression and furrowed brows",
    "surprised": "with a surprised expression, wide eyes and slightly open mouth",
    "worried": "with a worried, anxious expression",
    "embarrassed": "blushing with an embarrassed, flustered expression",
    "determined": "with a determined, confident expression",
}

SHOTS: dict[str, str] = {
    "upper_body": "Waist-up shot of this exact character, facing the viewer",
    "hands": "Close-up shot of this exact character's hands held in front of them",
    "profile": "Full-body side profile view of this exact character",
    "back": "Full-body view of this exact character seen from behind",
}

SEED_MAX = 2**32 - 1


def expression_instruction(clause: str) -> str:
    return (
        f"Close-up portrait of this exact character's face and shoulders, {clause}. "
        f"{IDENTITY_CLAUSE} {STYLE_CLAUSE}"
    )


def shot_instruction(description: str) -> str:
    return f"{description}. {IDENTITY_CLAUSE} {STYLE_CLAUSE}"


def resolve_entries(
    entries: list[Any], builtin: dict[str, str], kind: str
) -> list[tuple[str, str]]:
    """Normalize a spec list of names / {name, instruction} objects.

    For expressions the built-in value is a clause wrapped by
    ``expression_instruction``; custom objects provide the full instruction.
    """
    resolved: list[tuple[str, str]] = []
    for entry in entries:
        if isinstance(entry, str):
            if entry not in builtin:
                available = ", ".join(sorted(builtin))
                raise SystemExit(
                    f"unknown {kind} '{entry}'; built-ins: {available}. "
                    f"Use a spec file with an explicit instruction for custom {kind}s."
                )
            if kind == "expression":
                resolved.append((entry, expression_instruction(builtin[entry])))
            else:
                resolved.append((entry, shot_instruction(builtin[entry])))
        elif isinstance(entry, dict) and entry.get("name") and entry.get("instruction"):
            resolved.append((str(entry["name"]), str(entry["instruction"])))
        else:
            raise SystemExit(
                f"invalid {kind} entry {entry!r}; expected a name or "
                "{'name': ..., 'instruction': ...}"
            )
    return resolved


class ImagegenClient:
    def __init__(
        self,
        endpoint: str,
        token_id: Optional[str],
        token_secret: Optional[str],
        timeout: float,
        retries: int,
    ):
        self.endpoint = endpoint.rstrip("/")
        self.timeout = timeout
        self.retries = retries
        self.headers = {"Content-Type": "application/json"}
        if token_id and token_secret:
            self.headers["Modal-Key"] = token_id
            self.headers["Modal-Secret"] = token_secret

    def generate(self, payload: dict[str, Any]) -> dict[str, Any]:
        last_error: Optional[str] = None
        for attempt in range(1, self.retries + 2):
            try:
                response = requests.post(
                    self.endpoint,
                    json=payload,
                    headers=self.headers,
                    timeout=self.timeout,
                )
            except requests.RequestException as exc:
                last_error = str(exc)
            else:
                if response.status_code == 200:
                    return response.json()
                last_error = f"HTTP {response.status_code}: {response.text[:500]}"
                # 4xx won't get better on retry.
                if 400 <= response.status_code < 500:
                    break
            if attempt <= self.retries:
                wait = 10 * attempt
                print(f"  request failed ({last_error}); retrying in {wait}s...")
                time.sleep(wait)
        raise SystemExit(f"generation request failed: {last_error}")


def load_spec(args: argparse.Namespace) -> dict[str, Any]:
    spec: dict[str, Any] = {}
    if args.spec:
        spec = json.loads(Path(args.spec).read_text())
    if args.slug:
        spec["slug"] = args.slug
    if args.description:
        spec["description"] = args.description
    if args.seed is not None:
        spec["seed"] = args.seed
    if args.expressions is not None:
        spec["expressions"] = [e for e in args.expressions.split(",") if e]
    if args.shots is not None:
        spec["shots"] = [s for s in args.shots.split(",") if s]

    if not spec.get("slug") or not spec.get("description"):
        raise SystemExit("a character needs --slug and --description (or a --spec file)")
    spec.setdefault("expressions", ["neutral", "happy", "sad", "surprised"])
    spec.setdefault("shots", [])
    return spec


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate a manga character asset bundle via the imagegen Modal API."
    )
    parser.add_argument(
        "--endpoint",
        default=os.environ.get("IMAGEGEN_ENDPOINT"),
        help="ComfyUI API endpoint URL (env: IMAGEGEN_ENDPOINT)",
    )
    parser.add_argument(
        "--token-id",
        default=os.environ.get("MODAL_PROXY_TOKEN_ID"),
        help="Modal proxy token id (env: MODAL_PROXY_TOKEN_ID)",
    )
    parser.add_argument(
        "--token-secret",
        default=os.environ.get("MODAL_PROXY_TOKEN_SECRET"),
        help="Modal proxy token secret (env: MODAL_PROXY_TOKEN_SECRET)",
    )
    parser.add_argument("--spec", help="path to a character spec JSON file")
    parser.add_argument("--slug", help="character slug (output folder name)")
    parser.add_argument(
        "--description", help="Danbooru-style character description tags"
    )
    parser.add_argument("--seed", type=int, help="base seed for reproducibility")
    parser.add_argument(
        "--expressions",
        help=f"comma-separated face expressions (built-ins: {', '.join(EXPRESSIONS)})",
    )
    parser.add_argument(
        "--shots",
        help=f"comma-separated extra shots (built-ins: {', '.join(SHOTS)})",
    )
    parser.add_argument(
        "--out", default=None, help="output root directory (default: imagegen/output)"
    )
    parser.add_argument(
        "--alpha-edits",
        action="store_true",
        help="also remove the background from face/shot images",
    )
    parser.add_argument(
        "--no-lightning",
        action="store_true",
        help="render edits with the full 20-step schedule instead of the 4-step LoRA",
    )
    parser.add_argument(
        "--timeout", type=float, default=900, help="per-request timeout in seconds"
    )
    parser.add_argument(
        "--retries", type=int, default=2, help="retries per request on transient errors"
    )
    args = parser.parse_args()

    if not args.endpoint:
        raise SystemExit("--endpoint (or IMAGEGEN_ENDPOINT) is required")
    if not (args.token_id and args.token_secret):
        print(
            "warning: no proxy token configured; requests will fail with 401 unless "
            "the endpoint is public",
            file=sys.stderr,
        )

    spec = load_spec(args)
    expressions = resolve_entries(spec["expressions"], EXPRESSIONS, "expression")
    shots = resolve_entries(spec["shots"], SHOTS, "shot")

    out_root = Path(args.out) if args.out else Path(__file__).resolve().parent.parent / "output"
    out_dir = out_root / spec["slug"]
    out_dir.mkdir(parents=True, exist_ok=True)

    client = ImagegenClient(
        args.endpoint, args.token_id, args.token_secret, args.timeout, args.retries
    )

    base_prompt = f"{spec['description']}, {BASE_PROMPT_SUFFIX}, {QUALITY_TAGS}"
    negative_prompt = spec.get("negative", DEFAULT_NEGATIVE)
    base_seed = spec.get("seed")

    manifest: dict[str, Any] = {
        "slug": spec["slug"],
        "description": spec["description"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "endpoint": client.endpoint,
        "negative_prompt": negative_prompt,
        "lightning": not args.no_lightning,
        "images": [],
    }

    # --- Stage A: full-body master sprite -------------------------------------
    print(f"[1/{1 + len(expressions) + len(shots)}] base sprite for '{spec['slug']}'...")
    started = time.time()
    payload: dict[str, Any] = {
        "workflow": "base",
        "prompt": base_prompt,
        "negative_prompt": negative_prompt,
        "remove_background": True,
    }
    if base_seed is not None:
        payload["seed"] = int(base_seed) % (SEED_MAX + 1)
    if spec.get("width"):
        payload["width"] = int(spec["width"])
    if spec.get("height"):
        payload["height"] = int(spec["height"])

    result = client.generate(payload)
    base_seed = result["seed"]
    base_raw = base64.b64decode(result["images"]["raw"])
    (out_dir / "base_raw.png").write_bytes(base_raw)
    (out_dir / "base.png").write_bytes(base64.b64decode(result["images"]["alpha"]))
    print(f"  done in {time.time() - started:.1f}s (seed {base_seed})")
    manifest["images"].append(
        {
            "file": "base.png",
            "workflow": "base",
            "prompt": base_prompt,
            "seed": base_seed,
            "raw_file": "base_raw.png",
        }
    )

    # --- Stage B: derived shots of the same character --------------------------
    base_raw_b64 = base64.b64encode(base_raw).decode("ascii")
    derived = [("face", name, instruction) for name, instruction in expressions]
    derived += [("shot", name, instruction) for name, instruction in shots]

    for index, (prefix, name, instruction) in enumerate(derived, start=1):
        filename = f"{prefix}_{name}.png"
        print(f"[{1 + index}/{1 + len(derived)}] {filename}...")
        started = time.time()
        payload = {
            "workflow": "edit",
            "prompt": instruction,
            "image_b64": base_raw_b64,
            "lightning": not args.no_lightning,
            "remove_background": bool(args.alpha_edits),
        }
        if spec.get("seed") is not None:
            payload["seed"] = (int(spec["seed"]) + index) % (SEED_MAX + 1)

        result = client.generate(payload)
        images = result["images"]
        if args.alpha_edits:
            (out_dir / filename).write_bytes(base64.b64decode(images["alpha"]))
            raw_file = f"{prefix}_{name}_raw.png"
            (out_dir / raw_file).write_bytes(base64.b64decode(images["raw"]))
        else:
            (out_dir / filename).write_bytes(base64.b64decode(images["raw"]))
            raw_file = None
        print(f"  done in {time.time() - started:.1f}s (seed {result['seed']})")
        manifest["images"].append(
            {
                "file": filename,
                "workflow": "edit",
                "kind": prefix,
                "name": name,
                "instruction": instruction,
                "seed": result["seed"],
                **({"raw_file": raw_file} if raw_file else {}),
            }
        )

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"\nbundle complete: {out_dir}")


if __name__ == "__main__":
    main()
