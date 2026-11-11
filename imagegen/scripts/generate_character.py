#!/usr/bin/env python3
"""Generate character PNG bundles with OpenRouter's image API."""

import argparse
import base64
import hashlib
import io
import json
import math
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from PIL import Image, UnidentifiedImageError

ENDPOINT = "https://openrouter.ai/api/v1/images"
DEFAULT_MODEL = "openai/gpt-image-2.6-flare"
IDENTITY_CLAUSE = (
    "Keep the same character: identical face, hairstyle, hair color, eye color "
    "and outfit. Preserve the reference image's manga illustration style."
)
EXPRESSIONS = {
    "neutral": "with a calm, neutral expression",
    "happy": "smiling warmly with a cheerful, happy expression",
    "sad": "with a sad, downcast expression and slightly teary eyes",
    "angry": "with an angry, frustrated expression and furrowed brows",
    "surprised": "with a surprised expression, wide eyes and slightly open mouth",
    "worried": "with a worried, anxious expression",
    "embarrassed": "blushing with an embarrassed, flustered expression",
    "determined": "with a determined, confident expression",
}
SHOTS = {
    "upper_body": "Waist-up shot of this exact character, facing the viewer",
    "hands": "Close-up shot of this exact character's hands held in front of them",
    "profile": "Full-body side profile view of this exact character",
    "back": "Full-body view of this exact character seen from behind",
}


def safe_name(value):
    if not isinstance(value, str) or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9_-]{0,99}", value
    ):
        raise SystemExit(
            "Names must be 1–100 letters, numbers, underscores or hyphens, starting with a letter or number."
        )
    return value


def resolve_entries(entries, builtin, kind):
    if not isinstance(entries, list):
        raise SystemExit(f"{kind}s must be a list of names or instruction objects")
    resolved = []
    seen = set()
    for entry in entries:
        if isinstance(entry, str) and entry in builtin:
            name, instruction = entry, builtin[entry]
            if kind == "expression":
                instruction = f"Close-up portrait of this exact character's face and shoulders, {instruction}"
        elif isinstance(entry, dict):
            name, instruction = entry.get("name"), entry.get("instruction")
        else:
            raise SystemExit(
                f"Unknown {kind}: {entry!r}; use a built-in name or an instruction object"
            )
        safe_name(name)
        if (
            name.casefold() in seen
            or not isinstance(instruction, str)
            or not instruction.strip()
        ):
            raise SystemExit(f"Duplicate {kind} name or empty instruction: {name}")
        seen.add(name.casefold())
        resolved.append(
            {
                "name": name,
                "instruction": f"{instruction.rstrip('.')}. {IDENTITY_CLAUSE}",
            }
        )
    return resolved


def load_spec(args):
    spec = {}
    if args.spec:
        try:
            spec = json.loads(Path(args.spec).read_text())
        except (OSError, ValueError) as exc:
            raise SystemExit(f"Cannot read character spec: {exc}") from exc
    if not isinstance(spec, dict):
        raise SystemExit("Character spec must be a JSON object")
    unsupported = set(spec) - {"slug", "description", "expressions", "shots"}
    if unsupported:
        raise SystemExit(
            f"Unsupported spec fields: {', '.join(sorted(unsupported))}. Remove legacy diffusion settings; use --model and --aspect-ratio."
        )
    for name in ("slug", "description"):
        if getattr(args, name) is not None:
            spec[name] = getattr(args, name)
    safe_name(spec.get("slug"))
    if not isinstance(spec.get("description"), str) or not spec["description"].strip():
        raise SystemExit("A non-empty character description is required")
    for field, builtin, kind, default in (
        (
            "expressions",
            EXPRESSIONS,
            "expression",
            ["neutral", "happy", "sad", "surprised"],
        ),
        ("shots", SHOTS, "shot", []),
    ):
        override = getattr(args, field)
        entries = (
            [x.strip() for x in override.split(",") if x.strip()]
            if override is not None
            else spec.get(field, default)
        )
        spec[field] = resolve_entries(entries, builtin, kind)
        if args.alpha_edits:
            names = {entry["name"].casefold() for entry in spec[field]}
            if any(f"{name}_raw" in names for name in names):
                raise SystemExit(
                    f"{field} names collide with an alpha image's _raw companion"
                )
    return spec


def generate(payload, api_key, timeout, retries):
    for attempt in range(retries + 1):
        delay = min(2 ** min(attempt, 6), 60)
        try:
            response = requests.post(
                ENDPOINT,
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=timeout,
            )
        except requests.RequestException as exc:
            error = f"Network request failed ({type(exc).__name__})"
        else:
            if response.status_code == 200:
                try:
                    result = response.json()
                    if not isinstance(result, dict):
                        raise ValueError("expected an object")
                    data = base64.b64decode(
                        result["data"][0]["b64_json"], validate=True
                    )
                    usage = result.get("usage") or {}
                    if not isinstance(usage, dict):
                        raise ValueError("invalid usage data")
                    return data, usage
                except (ValueError, KeyError, IndexError, TypeError) as exc:
                    raise SystemExit(
                        "OpenRouter returned an invalid image response"
                    ) from exc
            error = f"OpenRouter returned HTTP {response.status_code}"
            if response.status_code != 429 and not 500 <= response.status_code < 600:
                raise SystemExit(error)
            try:
                retry_after = float(response.headers.get("Retry-After", delay))
                if math.isfinite(retry_after):
                    delay = min(max(retry_after, 0), 60)
            except ValueError:
                pass
        if attempt == retries:
            raise SystemExit(f"{error}; resume this bundle with --resume")
        print(f"  {error}; retrying in {delay:g}s")
        time.sleep(delay)


def check_png(data, transparent):
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "PNG":
                raise ValueError("expected PNG")
            image.load()
            rgba = image.convert("RGBA")
    except (
        OSError,
        ValueError,
        UnidentifiedImageError,
        Image.DecompressionBombError,
    ) as exc:
        raise SystemExit("OpenRouter did not return a valid PNG") from exc
    if transparent:
        low, high = rgba.getchannel("A").getextrema()
        if low == 255 or high == 0:
            raise SystemExit(
                "Expected a visible sprite with real transparency; the model returned opaque or empty pixels"
            )
    return rgba


def write_atomic(path, data):
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def white_background(image):
    canvas = Image.new("RGBA", image.size, "white")
    canvas.alpha_composite(image)
    buffer = io.BytesIO()
    canvas.convert("RGB").save(buffer, format="PNG")
    return buffer.getvalue()


def generate_bundle(args, spec, settings, out_dir, api_key):
    manifest_path = out_dir / "manifest.json"
    manifest = {
        "version": 1,
        "spec": spec,
        "settings": settings,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "images": [],
    }
    if args.resume:
        try:
            saved = json.loads(manifest_path.read_text())
        except (OSError, ValueError) as exc:
            raise SystemExit(
                "Cannot resume without a valid manifest; use a new output directory"
            ) from exc
        if not isinstance(saved, dict) or any(
            saved.get(key) != manifest[key] for key in ("version", "spec", "settings")
        ):
            raise SystemExit(
                "Resume requires the same spec, model, aspect ratio, and alpha settings"
            )
        if not isinstance(saved.get("images"), list):
            raise SystemExit("Invalid manifest image list")
        manifest = saved

    base_prompt = (
        f"Create a single full-body manga character sprite: {spec['description']}. "
        "Standing, facing the viewer, entire head and feet visible, clean linework, "
        "consistent anime shading. Isolated on a transparent background, no text."
    )
    jobs = [("base.png", base_prompt, True)]
    for field, prefix in (("expressions", "face"), ("shots", "shot")):
        jobs.extend(
            (f"{prefix}_{entry['name']}.png", entry["instruction"], args.alpha_edits)
            for entry in spec[field]
        )
    expected = {name for name, _, _ in jobs}
    completed = {}
    for record in manifest["images"]:
        if (
            not isinstance(record, dict)
            or record.get("file") not in expected
            or record["file"] in completed
        ):
            raise SystemExit("Invalid manifest image record")
        path = out_dir / record["file"]
        if not path.is_file() or hashlib.sha256(
            path.read_bytes()
        ).hexdigest() != record.get("sha256"):
            raise SystemExit(
                f"Saved image missing or changed: {path.name}; use a new output directory"
            )
        completed[record["file"]] = record
    if completed and "base.png" not in completed:
        raise SystemExit(
            "Cannot resume derived shots without their original base sprite"
        )

    def checkpoint():
        write_atomic(manifest_path, (json.dumps(manifest, indent=2) + "\n").encode())

    checkpoint()
    reference = None
    for index, (filename, prompt, transparent) in enumerate(jobs, 1):
        path = out_dir / filename
        if filename in completed:
            data = path.read_bytes()
            image = check_png(data, transparent)
            print(f"[{index}/{len(jobs)}] keeping {filename}")
        else:
            print(f"[{index}/{len(jobs)}] generating {filename}")
            payload = {
                "model": settings["model"],
                "prompt": prompt,
                "aspect_ratio": settings["aspect_ratio"],
                "output_format": "png",
                "background": "transparent" if transparent else "opaque",
                "n": 1,
            }
            if reference is not None:
                payload["input_references"] = [
                    {"type": "image_url", "image_url": {"url": reference}}
                ]
                payload["prompt"] += (
                    " Transparent background."
                    if transparent
                    else " Clean white background."
                )
            data, usage = generate(payload, api_key, args.timeout, args.retries)
            image = check_png(data, transparent)
            write_atomic(path, data)
            record = {
                "file": filename,
                "prompt": payload["prompt"],
                "sha256": hashlib.sha256(data).hexdigest(),
                "usage": usage,
            }
            if transparent:
                record["raw_file"] = f"{path.stem}_raw.png"
            manifest["images"].append(record)
            checkpoint()
        if transparent:
            write_atomic(out_dir / f"{path.stem}_raw.png", white_background(image))
        if filename == "base.png":
            reference = "data:image/png;base64," + base64.b64encode(data).decode(
                "ascii"
            )
    print(f"Bundle complete: {out_dir}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", help="character spec JSON file")
    parser.add_argument("--slug", help="character output folder name")
    parser.add_argument("--description", help="character appearance in plain language")
    parser.add_argument(
        "--expressions", help=f"comma-separated expressions: {', '.join(EXPRESSIONS)}"
    )
    parser.add_argument("--shots", help=f"comma-separated shots: {', '.join(SHOTS)}")
    parser.add_argument(
        "--model", default=os.environ.get("OPENROUTER_IMAGE_MODEL", DEFAULT_MODEL)
    )
    parser.add_argument(
        "--aspect-ratio",
        default="2:3",
        choices=["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "auto"],
    )
    parser.add_argument(
        "--out", type=Path, default=Path(__file__).resolve().parents[1] / "output"
    )
    parser.add_argument(
        "--alpha-edits",
        action="store_true",
        help="transparent derived shots, with white-background companions",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="continue an existing bundle with identical settings",
    )
    parser.add_argument(
        "--timeout", type=float, default=300, help="per-request timeout in seconds"
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=2,
        help="extra attempts for network errors, 429, and 5xx",
    )
    args = parser.parse_args()
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("Set OPENROUTER_API_KEY before generating a bundle")
    if (
        not args.model.strip()
        or not math.isfinite(args.timeout)
        or args.timeout <= 0
        or not 0 <= args.retries <= 10
    ):
        raise SystemExit(
            "Model must be non-empty, timeout positive and finite, and retries between 0 and 10"
        )
    spec = load_spec(args)
    settings = {
        "model": args.model,
        "aspect_ratio": args.aspect_ratio,
        "alpha_edits": args.alpha_edits,
    }
    out_dir = args.out / spec["slug"]
    if args.resume:
        if not out_dir.is_dir():
            raise SystemExit("No existing bundle to resume")
    else:
        try:
            out_dir.mkdir(parents=True, exist_ok=False)
        except FileExistsError as exc:
            raise SystemExit(
                "Output directory already exists; use --resume or a new --out directory"
            ) from exc
    lock = out_dir / ".generating"
    try:
        with lock.open("x"):
            pass
    except FileExistsError as exc:
        raise SystemExit(
            "This bundle is already being generated. Remove .generating only if the previous process has stopped."
        ) from exc
    try:
        generate_bundle(args, spec, settings, out_dir, api_key)
    finally:
        lock.unlink()


if __name__ == "__main__":
    main()
