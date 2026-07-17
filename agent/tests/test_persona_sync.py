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

    def __init__(
        self,
        objects: dict[str, bytes],
        *,
        page_size: int | None = None,
        fail_list: Exception | None = None,
        fail_download: Exception | None = None,
    ):
        self.objects = dict(objects)
        self.downloads: list[tuple[str, str, str]] = []
        self.page_size = page_size
        self.fail_list = fail_list
        self.fail_download = fail_download
        self.list_calls: list[dict[str, Any]] = []

    def list_objects_v2(self, **kwargs: Any) -> dict[str, Any]:
        self.list_calls.append(kwargs)
        if self.fail_list is not None:
            raise self.fail_list
        prefix = kwargs.get("Prefix") or ""
        keys = sorted(
            key for key in self.objects if key.startswith(prefix)
        )
        start = 0
        token = kwargs.get("ContinuationToken")
        if token:
            start = int(token)
        if self.page_size is None:
            page_keys = keys[start:]
            return {
                "Contents": [{"Key": key} for key in page_keys],
                "IsTruncated": False,
            }
        page_keys = keys[start : start + self.page_size]
        next_start = start + self.page_size
        truncated = next_start < len(keys)
        result: dict[str, Any] = {
            "Contents": [{"Key": key} for key in page_keys],
            "IsTruncated": truncated,
        }
        if truncated:
            result["NextContinuationToken"] = str(next_start)
        return result

    def download_file(self, Bucket: str, Key: str, Filename: str) -> None:
        if self.fail_download is not None:
            raise self.fail_download
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
    assert not persona_sync._is_syncable("")
    assert not persona_sync._is_syncable("avatars/")


def test_sync_list_failure_keeps_local(data_dir: Path, caplog: pytest.LogCaptureFixture):
    fake = FakeS3({}, fail_list=RuntimeError("list boom"))
    with caplog.at_level("ERROR"):
        ok = persona_sync.sync_personas_from_s3(
            settings=_enabled_settings(),
            s3_client=fake,
            data_dir=data_dir,
        )
    assert ok is False
    assert data_dir.joinpath("personas.json").read_text(encoding="utf-8") == (
        '[{"slug":"local"}]'
    )
    assert "Failed to list" in caplog.text


def test_sync_download_failure_reloads_and_returns_false(
    data_dir: Path, caplog: pytest.LogCaptureFixture
):
    fake = FakeS3(
        {"cast/personas.json": b'[{"slug":"partial"}]'},
        fail_download=RuntimeError("download boom"),
    )
    with caplog.at_level("ERROR"):
        ok = persona_sync.sync_personas_from_s3(
            settings=_enabled_settings(),
            s3_client=fake,
            data_dir=data_dir,
        )
    assert ok is False
    assert "Persona S3 sync failed" in caplog.text
    # Temp download artifacts must not linger beside the destination.
    assert list(data_dir.glob(".personas.json.*.tmp")) == []


def test_sync_paginates_list_results(data_dir: Path):
    fake = FakeS3(
        {
            "cast/personas.json": b"[]",
            "cast/simulations.json": b"[]",
            "cast/avatars/a.png": b"a",
            "cast/avatars/b.png": b"b",
        },
        page_size=2,
    )
    assert (
        persona_sync.sync_personas_from_s3(
            settings=_enabled_settings(),
            s3_client=fake,
            data_dir=data_dir,
        )
        is True
    )
    assert len(fake.list_calls) >= 2
    assert fake.list_calls[1].get("ContinuationToken") == "2"
    assert data_dir.joinpath("avatars/a.png").read_bytes() == b"a"
    assert data_dir.joinpath("avatars/b.png").read_bytes() == b"b"


def test_sync_normalizes_prefix_without_trailing_slash(data_dir: Path):
    fake = FakeS3({"cast/personas.json": b"[]", "cast/simulations.json": b"[]"})
    assert (
        persona_sync.sync_personas_from_s3(
            settings=_enabled_settings(personas_s3_prefix="cast"),
            s3_client=fake,
            data_dir=data_dir,
        )
        is True
    )
    assert fake.list_calls[0]["Prefix"] == "cast/"


def test_sync_empty_prefix_uses_bucket_root(data_dir: Path):
    fake = FakeS3(
        {
            "personas.json": b'[{"slug":"root"}]',
            "simulations.json": b"[]",
        }
    )
    assert (
        persona_sync.sync_personas_from_s3(
            settings=_enabled_settings(personas_s3_prefix=""),
            s3_client=fake,
            data_dir=data_dir,
        )
        is True
    )
    assert fake.list_calls[0]["Prefix"] == ""
    assert data_dir.joinpath("personas.json").read_bytes() == b'[{"slug":"root"}]'


def test_sync_returns_false_when_client_unavailable(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(persona_sync, "_build_s3_client", lambda _settings: None)
    assert (
        persona_sync.sync_personas_from_s3(
            settings=_enabled_settings(),
            data_dir=data_dir,
        )
        is False
    )


def test_build_s3_client_uses_region(monkeypatch: pytest.MonkeyPatch):
    import sys
    import types

    captured: dict[str, Any] = {}
    fake_boto3 = types.ModuleType("boto3")

    def client(service: str, **kwargs: Any):
        captured["service"] = service
        captured["kwargs"] = kwargs
        return FakeS3({})

    fake_boto3.client = client  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "boto3", fake_boto3)

    client_obj = persona_sync._build_s3_client(
        _enabled_settings(aws_region="eu-west-1")
    )
    assert isinstance(client_obj, FakeS3)
    assert captured == {
        "service": "s3",
        "kwargs": {"region_name": "eu-west-1"},
    }

    captured.clear()
    client_obj = persona_sync._build_s3_client(_enabled_settings(aws_region=""))
    assert isinstance(client_obj, FakeS3)
    assert captured == {"service": "s3", "kwargs": {}}


def test_build_s3_client_without_boto3(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    import builtins
    import sys

    monkeypatch.delitem(sys.modules, "boto3", raising=False)
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "boto3":
            raise ImportError("no boto3")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    with caplog.at_level("ERROR"):
        assert persona_sync._build_s3_client(_enabled_settings()) is None
    assert "boto3 is not installed" in caplog.text


def test_ensure_personas_synced_success(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        persona_sync,
        "sync_personas_from_s3",
        lambda **_kwargs: True,
    )
    assert persona_sync.ensure_personas_synced(settings=_enabled_settings()) is True


def test_relative_key_helpers():
    assert persona_sync._relative_key("cast/personas.json", "cast/") == "personas.json"
    assert persona_sync._relative_key("other/personas.json", "cast/") is None
    assert persona_sync._relative_key("/personas.json", "") == "personas.json"


def test_iter_object_keys_stops_without_continuation_token():
    class TruncatedNoToken:
        def list_objects_v2(self, **_kwargs: Any) -> dict[str, Any]:
            return {
                "Contents": [{"Key": "cast/personas.json"}],
                "IsTruncated": True,
                # Missing NextContinuationToken — iterator must stop.
            }

        def download_file(self, *_args: Any, **_kwargs: Any) -> None:
            raise AssertionError("unused")

    keys = list(
        persona_sync._iter_object_keys(TruncatedNoToken(), "bucket", "cast/")
    )
    assert keys == ["cast/personas.json"]


def test_download_atomically_cleans_tmp_on_failure(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
):
    dest = data_dir / "personas.json"
    fake = FakeS3({}, fail_download=RuntimeError("download boom"))

    # Force unlink of the temp file to raise so the OSError guard is hit.
    original_unlink = Path.unlink

    def flaky_unlink(self: Path, *args: Any, **kwargs: Any):
        if self.name.endswith(".tmp"):
            raise OSError("busy")
        return original_unlink(self, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", flaky_unlink)
    with pytest.raises(RuntimeError, match="download boom"):
        persona_sync._download_atomically(fake, "bucket", "cast/personas.json", dest)


def test_run_gradio_syncs_before_ui(monkeypatch: pytest.MonkeyPatch):
    from careersim_agent import main as main_module

    order: list[str] = []

    monkeypatch.setattr(
        "careersim_agent.services.persona_sync.ensure_personas_synced",
        lambda: order.append("sync"),
    )

    class FakeApp:
        def launch(self, **_kwargs):
            order.append("launch")

    monkeypatch.setattr(
        "careersim_agent.ui.create_gradio_app",
        lambda: order.append("create") or FakeApp(),
    )
    main_module.run_gradio()
    assert order[:2] == ["sync", "create"]
    assert order[-1] == "launch"


def test_run_voice_delegates_sync_to_worker(monkeypatch: pytest.MonkeyPatch):
    """``run_voice`` must not sync itself — sync runs in ``run_worker``
    after the VOICE_ENABLED kill switch so disabled deploys exit cleanly
    without touching S3.
    """
    from careersim_agent import main as main_module

    order: list[str] = []

    monkeypatch.setattr(
        "careersim_agent.services.persona_sync.ensure_personas_synced",
        lambda: order.append("sync"),
    )
    monkeypatch.setattr(
        "careersim_agent.voice.worker.run_worker",
        lambda: order.append("worker") or 0,
    )
    monkeypatch.setattr(main_module.sys, "exit", lambda code: order.append(f"exit:{code}"))
    main_module.run_voice()
    assert order == ["worker", "exit:0"]
    assert "sync" not in order


def test_create_api_app_syncs_once(monkeypatch: pytest.MonkeyPatch):
    calls: list[str] = []
    monkeypatch.setattr(
        "careersim_agent.api.app.ensure_personas_synced",
        lambda: calls.append("sync"),
    )
    from careersim_agent.api.app import create_api_app

    create_api_app()
    assert calls == ["sync"]
