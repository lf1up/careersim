"""Fetch persona / simulation cast data from S3 and rewrite local files.

Gated by ``PERSONAS_S3_ENABLED``. When the flag is off this module is a
no-op and the git-backed ``agent/data`` tree is used as-is.

Expected bucket layout (keys relative to ``PERSONAS_S3_PREFIX``)::

    personas.json
    simulations.json
    avatars/<slug>.png
    documents/personas/<slug>/*.md
    documents/simulations/<slug>/*.md
    documents/shared/*.md

That layout matches ``agent/data/`` so a future personas repo can publish
straight into the bucket and agents pick it up on the next start.
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Optional, Protocol

from ..config import Settings, get_settings
from .data_loader import get_data_dir, reload_data

logger = logging.getLogger(__name__)

# Only rewrite paths that belong to the cast. Anything else under the
# prefix (README, CI artifacts, etc.) is ignored so a messy bucket can't
# pollute the data dir.
_SYNC_ROOT_FILES = frozenset({"personas.json", "simulations.json"})
_SYNC_ROOT_DIRS = frozenset({"avatars", "documents"})


class _S3Client(Protocol):
    def list_objects_v2(self, **kwargs: Any) -> dict[str, Any]: ...
    def download_file(self, Bucket: str, Key: str, Filename: str) -> None: ...


def sync_personas_from_s3(
    settings: Optional[Settings] = None,
    *,
    s3_client: Optional[_S3Client] = None,
    data_dir: Optional[Path] = None,
) -> bool:
    """Download cast data from S3 into the local data dir, then reload caches.

    Returns ``True`` when a sync ran successfully, ``False`` when the
    feature is disabled or the sync was skipped/failed (local files are
    left untouched on failure so the agent can still boot from the
    baked-in / bind-mounted cast).
    """
    cfg = settings if settings is not None else get_settings()

    if not cfg.personas_s3_enabled:
        logger.debug("persona S3 sync skipped (PERSONAS_S3_ENABLED=false)")
        return False

    if not cfg.personas_s3_bucket:
        logger.error(
            "PERSONAS_S3_ENABLED is true but PERSONAS_S3_BUCKET is empty; "
            "keeping local persona data"
        )
        return False

    client = s3_client if s3_client is not None else _build_s3_client(cfg)
    if client is None:
        return False

    target = data_dir if data_dir is not None else get_data_dir()
    prefix = _normalize_prefix(cfg.personas_s3_prefix)

    try:
        keys = list(_iter_object_keys(client, cfg.personas_s3_bucket, prefix))
    except Exception:
        logger.exception(
            "Failed to list s3://%s/%s; keeping local persona data",
            cfg.personas_s3_bucket,
            prefix,
        )
        return False

    rel_paths = [_relative_key(key, prefix) for key in keys]
    to_sync = [
        (key, rel)
        for key, rel in zip(keys, rel_paths)
        if rel is not None and _is_syncable(rel)
    ]

    if not to_sync:
        logger.error(
            "No syncable persona objects under s3://%s/%s; keeping local data",
            cfg.personas_s3_bucket,
            prefix,
        )
        return False

    written = 0
    try:
        for key, rel in to_sync:
            dest = target / rel
            _download_atomically(client, cfg.personas_s3_bucket, key, dest)
            written += 1
    except Exception:
        logger.exception(
            "Persona S3 sync failed after writing %d file(s); "
            "local data may be partially updated",
            written,
        )
        # Still clear caches — whatever did land should be visible, and
        # mtime-based auto-reload would pick it up on the next access
        # anyway. Operators can re-run with a good bucket to finish.
        reload_data()
        return False

    reload_data()
    logger.info(
        "Synced %d persona data file(s) from s3://%s/%s → %s",
        written,
        cfg.personas_s3_bucket,
        prefix or "(bucket root)",
        target,
    )
    return True


def ensure_personas_synced(
    settings: Optional[Settings] = None,
) -> bool:
    """Startup helper: sync when the flag is on, never raise.

    Safe to call from every entrypoint (API, Gradio, voice). Failures are
    logged and the process continues on local files.
    """
    try:
        return sync_personas_from_s3(settings=settings)
    except Exception:
        logger.exception("Unexpected persona S3 sync error; keeping local data")
        return False


def _build_s3_client(settings: Settings) -> Optional[_S3Client]:
    try:
        import boto3
    except ImportError:
        logger.error(
            "PERSONAS_S3_ENABLED is true but boto3 is not installed; "
            "install the agent package (boto3 is a core dependency) or "
            "disable PERSONAS_S3_ENABLED"
        )
        return None

    kwargs: dict[str, Any] = {}
    if settings.aws_region:
        kwargs["region_name"] = settings.aws_region
    return boto3.client("s3", **kwargs)


def _normalize_prefix(prefix: str) -> str:
    cleaned = (prefix or "").strip().lstrip("/")
    if cleaned and not cleaned.endswith("/"):
        cleaned += "/"
    return cleaned


def _iter_object_keys(client: _S3Client, bucket: str, prefix: str):
    token: Optional[str] = None
    while True:
        kwargs: dict[str, Any] = {"Bucket": bucket, "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        page = client.list_objects_v2(**kwargs)
        for obj in page.get("Contents") or []:
            key = obj.get("Key")
            if not key or key.endswith("/"):
                # Skip directory placeholders.
                continue
            yield key
        if not page.get("IsTruncated"):
            break
        token = page.get("NextContinuationToken")
        if not token:
            break


def _relative_key(key: str, prefix: str) -> Optional[str]:
    if prefix:
        if not key.startswith(prefix):
            return None
        return key[len(prefix) :]
    return key.lstrip("/")


def _is_syncable(relative_key: str) -> bool:
    if not relative_key or relative_key.endswith("/"):
        return False
    # Reject path traversal and absolute-looking segments.
    parts = Path(relative_key).parts
    if any(part in ("", ".", "..") for part in parts):
        return False
    root = parts[0]
    if root in _SYNC_ROOT_FILES:
        return len(parts) == 1
    if root in _SYNC_ROOT_DIRS:
        return len(parts) >= 2
    return False


def _download_atomically(
    client: _S3Client,
    bucket: str,
    key: str,
    dest: Path,
) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{dest.name}.",
        suffix=".tmp",
        dir=str(dest.parent),
    )
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        client.download_file(bucket, key, str(tmp_path))
        os.replace(tmp_path, dest)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise
