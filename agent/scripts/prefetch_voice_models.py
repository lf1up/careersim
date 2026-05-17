"""Prefetch the default Piper + faster-whisper models.

Run during the agent-voice Docker image build so the first
``docker compose up`` produces a fully working voice stack without
waiting on first-utterance model downloads.

Idempotent: re-runs are no-ops once the cache is warm. Safe to run on
the host too (the model paths default to the values matching the
container layout, but can be overridden via env).

Skips gracefully when the relevant SDKs aren't installed — useful for
local development where the `voice` extra hasn't been pulled in. The
build-time invocation in agent/Dockerfile does install the extra, so
this only no-ops when invoked outside that flow.
"""

from __future__ import annotations

import logging
import os
import sys
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)


PIPER_VOICES = (
    # (voice_id, base download URL).  See
    # https://github.com/rhasspy/piper/blob/master/VOICES.md
    "en_US-libritts_r-medium",
)

WHISPER_MODEL = os.environ.get("VOICE_WHISPER_MODEL", "base.en")


def _prefetch_piper(model_dir: Path) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)
    base = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

    for voice_id in PIPER_VOICES:
        # Voice files are split as "lang/locale/voice/quality"
        # (e.g. en/en_US/libritts_r/medium). Resolve programmatically
        # to keep this script tolerant of new voices.
        if not voice_id.startswith("en_US-"):
            logger.warning("piper prefetch only supports en_US voices currently")
            continue
        rest = voice_id[len("en_US-"):]
        # voice slug + quality split
        parts = rest.rsplit("-", 1)
        if len(parts) != 2:
            logger.warning("malformed voice id: %s", voice_id)
            continue
        slug, quality = parts
        url_prefix = f"{base}/en/en_US/{slug}/{quality}"

        for suffix in (".onnx", ".onnx.json"):
            target = model_dir / f"{voice_id}{suffix}"
            if target.exists():
                logger.info("piper voice %s%s already present", voice_id, suffix)
                continue
            url = f"{url_prefix}/{voice_id}{suffix}"
            logger.info("downloading %s -> %s", url, target)
            try:
                urllib.request.urlretrieve(url, target)
            except Exception as exc:
                logger.warning("piper prefetch failed for %s: %s", url, exc)


def _prefetch_whisper(model: str) -> None:
    try:
        from faster_whisper import WhisperModel  # noqa: F401
    except ImportError:
        logger.info("faster-whisper not installed; skipping whisper prefetch")
        return

    # Loading the model triggers HuggingFace's snapshot_download into
    # the user's HF cache (`~/.cache/huggingface`). The model is then
    # held in memory for the duration of this script — fine for a
    # build-time invocation, since the process exits immediately
    # after. The agent-voice container reuses the same cache via the
    # `whisper_models` named volume.
    from faster_whisper import WhisperModel

    logger.info("warming faster-whisper model=%s", model)
    try:
        WhisperModel(model, device="cpu", compute_type="int8")
    except Exception as exc:  # pragma: no cover
        logger.warning("whisper prefetch failed: %s", exc)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    piper_dir = Path(os.environ.get("VOICE_PIPER_MODEL_DIR", "/app/.piper_models"))
    _prefetch_piper(piper_dir)
    _prefetch_whisper(WHISPER_MODEL)
    return 0


if __name__ == "__main__":
    sys.exit(main())
