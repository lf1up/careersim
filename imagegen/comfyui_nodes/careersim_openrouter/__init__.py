"""CareerSIM OpenRouter image node for a local ComfyUI installation."""

import base64
import importlib.util
import io
import json
import os
from pathlib import Path

from PIL import Image

import folder_paths

script = Path(__file__).resolve().parents[2] / "scripts/generate_character.py"
spec = importlib.util.spec_from_file_location("careersim_imagegen_client", script)
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


class CareerSimOpenRouterImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("STRING", {"default": client.DEFAULT_MODEL}),
                "prompt": ("STRING", {"default": "", "multiline": True}),
                "aspect_ratio": (["2:3", "1:1", "3:2", "3:4", "4:3", "9:16", "16:9"],),
                "background": (["transparent", "opaque"],),
            },
            "optional": {"reference_image": ("IMAGE",)},
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "generate"
    CATEGORY = "CareerSIM/OpenRouter"

    def generate(self, model, prompt, aspect_ratio, background, reference_image=None):
        import numpy as np
        import torch

        key = os.environ.get("OPENROUTER_API_KEY", "").strip()
        if not key:
            key_file = Path(folder_paths.get_user_directory()) / "openrouter_key.json"
            try:
                key = json.loads(key_file.read_text())["api_key"].strip()
            except (OSError, ValueError, KeyError, AttributeError) as exc:
                raise RuntimeError("Set OPENROUTER_API_KEY or ComfyUI/user/openrouter_key.json") from exc
        if not model.strip() or not prompt.strip():
            raise ValueError("Model and prompt are required")

        payload = {
            "model": model.strip(),
            "prompt": prompt.strip(),
            "aspect_ratio": aspect_ratio,
            "background": background,
            "output_format": "png",
            "n": 1,
        }
        if reference_image is not None:
            pixels = (reference_image[0].cpu().numpy() * 255).clip(0, 255).astype("uint8")
            buffer = io.BytesIO()
            Image.fromarray(pixels).save(buffer, format="PNG")
            payload["input_references"] = [{
                "type": "image_url",
                "image_url": {"url": "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")},
            }]

        try:
            data, _ = client.generate(payload, key, timeout=300, retries=2)
            image = client.check_png(data, background == "transparent")
        except SystemExit as exc:
            raise RuntimeError(str(exc)) from exc
        if background == "opaque":
            image = image.convert("RGB")
        tensor = torch.from_numpy(np.array(image).astype("float32") / 255.0).unsqueeze(0)
        return (tensor,)


NODE_CLASS_MAPPINGS = {"CareerSimOpenRouterImage": CareerSimOpenRouterImage}
NODE_DISPLAY_NAME_MAPPINGS = {"CareerSimOpenRouterImage": "CareerSIM OpenRouter Image"}
