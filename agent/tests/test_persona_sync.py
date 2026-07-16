"""Tests for S3-backed persona / simulation data sync."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from careersim_agent import config as config_module
from careersim_agent.config import Settings
from careersim_agent.services import persona_sync
from careersim_agent.services.data_loader import reload_data


class FakeS3:
    """Minimal S3 stand-in for list + download."""

    def __init__(self, objects: dict[str, bytes]):
        self.objects = dict(objects)
        self.downloads: list[tuple[str, str, str]] = []

    def list_objects_v2(self, **kwargs: Any) -> dict[str, Any]:
        prefix = kwargs.get("Prefix") or ""
        contents = [
            {"Key": key}
            for key in sorted(self.objects)
            if key.startswith(prefix)
        ]
        return {"Contents": contents, "IsTruncated": False}

    def download_file(self, Bucket: str, Key: str, Filename: str) -> None:
        if Key not in self.objects:
            raise FileNotFoundError(Key)
        Path(Filename).write_bytes(self.objects[Key])
        self.downloads.append((Bucket, Key, Filename))


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    """Empty local data dir with the expected cast files pre-seeded."""
    (tmp_path / "personas.json").write_text('[{"slug":"local"}]', encoding="utf-8")
    (tmp_path / "simulations.json").write_text("[]", encoding="utf-8")
    (tmp_path / "avatars").mkdir()
    (tmp_path / "documents" / "personas" / "local").mkdir(parents=True)
    return tmp_path


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    config_module.get_settings.cache_clear()
    yield
    config_module.get_settings.cache_clear()
    reload_data()


def _enabled_settings(**overrides: Any) -> Settings:
    values = {
        "personas_s3_enabled": True,
        "personas_s3_bucket": "careersim-personas",
        "personas_s3_prefix": "cast/",
        "aws_region": "us-east-1",
    }
    values.update(overrides)
    return Settings(**values)


def test_sync_noop_when_flag_disabled(data_dir: Path):
    settings = _enabled_settings(personas_s3_enabled=False)
    fake = FakeS3({"cast/personas.json": b"[]"})

    assert (
        persona_sync.sync_personas_from_s3(
            settings=settings,
            s3_client=fake,
            data_dir=data_dir,
        )
        is False
    )
    assert fake.downloads == []
    assert data_dir.joinpath("personas.json").read_text(encoding="utf-8") == (
        '[{"slug":"local"}]'
    )


def test_sync_requires_bucket(data_dir: Path, caplog: pytest.LogCaptureFixture):
    settings = _enabled_settings(personas_s3_bucket="")
    with caplog.at_level("ERROR"):
        ok = persona_sync.sync_personas_from_s3(
            settings=settings,
            s3_client=FakeS3({}),
            data_dir=data_dir,
        )
    assert ok is False
    assert "PERSONAS_S3_BUCKET" in caplog.text


def test_sync_rewrites_cast_files(data_dir: Path):
    remote_personas = b'[{"slug":"from-s3","name":"Remote"}]'
    remote_sims = b'[{"slug":"sim-1","personaSlug":"from-s3"}]'
    fake = FakeS3(
        {
            "cast/personas.json": remote_personas,
            "cast/simulations.json": remote_sims,
            "cast/avatars/from-s3.png": b"\x89PNG",
            "cast/documents/personas/from-s3/notes.md": b"# hi",
            "cast/README.md": b"ignore me",
            # Directory placeholder — list iterator skips keys ending in /.
            "cast/avatars/": b"",
        }
    )

    settings = _enabled_settings()
    assert (
        persona_sync.sync_personas_from_s3(
            settings=settings,
            s3_client=fake,
            data_dir=data_dir,
        )
        is True
    )

    assert data_dir.joinpath("personas.json").read_bytes() == remote_personas
    assert data_dir.joinpath("simulations.json").read_bytes() == remote_sims
    assert data_dir.joinpath("avatars/from-s3.png").read_bytes() == b"\x89PNG"
    assert (
        data_dir.joinpath("documents/personas/from-s3/notes.md").read_text(
            encoding="utf-8"
        )
        == "# hi"
    )
    assert not (data_dir / "README.md").exists()


def test_sync_rejects_path_traversal(data_dir: Path):
    fake = FakeS3(
        {
            "cast/../personas.json": b"bad",
            "cast/avatars/../../evil.png": b"bad",
        }
    )
    settings = _enabled_settings()
    assert (
        persona_sync.sync_personas_from_s3(
            settings=settings,
            s3_client=fake,
            data_dir=data_dir,
        )
        is False
    )
    assert data_dir.joinpath("personas.json").read_text(encoding="utf-8") == (
        '[{"slug":"local"}]'
    )


def test_ensure_personas_synced_swallows_errors(data_dir: Path, monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("unexpected")

    monkeypatch.setattr(persona_sync, "sync_personas_from_s3", boom)
    assert persona_sync.ensure_personas_synced(settings=_enabled_settings()) is False


def test_is_syncable_helpers():
    assert persona_sync._is_syncable("personas.json")
    assert persona_sync._is_syncable("simulations.json")
    assert persona_sync._is_syncable("avatars/x.png")
    assert persona_sync._is_syncable("documents/personas/x/a.md")
    assert not persona_sync._is_syncable("README.md")
    assert not persona_sync._is_syncable("personas.json/extra")
    assert not persona_sync._is_syncable("../personas.json")
    assert not persona_sync._is_syncable("avatars")
