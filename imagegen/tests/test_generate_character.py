import base64
import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import requests
from PIL import Image

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/generate_character.py"
spec = importlib.util.spec_from_file_location("generate_character", SCRIPT)
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


def png(transparent=True):
    image = Image.new("RGBA", (2, 2), (80, 100, 120, 255))
    if transparent:
        image.putpixel((0, 0), (0, 0, 0, 0))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def response(status=200, image=None, body=None):
    result = requests.Response()
    result.status_code = status
    result._content = json.dumps(
        body
        if body is not None
        else {
            "created": 1748372400,
            "data": [
                {
                    "b64_json": base64.b64encode(image or png()).decode(),
                    "media_type": "image/png",
                }
            ],
            "usage": {"cost": 0.04, "total_tokens": 4175},
        }
    ).encode()
    return result


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.output = self.root / "assets"
        self.env = patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-secret"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def run_cli(self, *extra):
        args = [
            str(SCRIPT),
            "--slug",
            "aiko",
            "--description",
            "an office worker",
            "--expressions",
            "happy",
            "--out",
            str(self.output),
            "--retries",
            "0",
            *extra,
        ]
        with patch.object(sys, "argv", args), contextlib.redirect_stdout(io.StringIO()):
            cli.main()

    def manifest(self):
        return json.loads((self.output / "aiko/manifest.json").read_text())

    def test_bundle_uses_base_reference_and_writes_real_pngs(self):
        with patch.object(
            cli.requests, "post", side_effect=[response(), response(image=png(False))]
        ) as post:
            self.run_cli()
        first, second = [call.kwargs for call in post.call_args_list]
        self.assertEqual(
            post.call_args_list[0].args[0], "https://openrouter.ai/api/v1/images"
        )
        self.assertEqual(first["headers"]["Authorization"], "Bearer test-secret")
        self.assertEqual(first["json"]["background"], "transparent")
        self.assertEqual(first["json"]["output_format"], "png")
        self.assertEqual(second["json"]["background"], "opaque")
        reference = second["json"]["input_references"][0]["image_url"]["url"]
        self.assertEqual(base64.b64decode(reference.split(",", 1)[1]), png())
        with Image.open(self.output / "aiko/base.png") as image:
            self.assertEqual(image.getpixel((0, 0))[3], 0)
        with Image.open(self.output / "aiko/base_raw.png") as image:
            self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))
            self.assertEqual(image.getpixel((1, 1)), (80, 100, 120))
        manifest = self.manifest()
        self.assertEqual(
            [item["file"] for item in manifest["images"]],
            ["base.png", "face_happy.png"],
        )
        self.assertEqual(manifest["images"][0]["usage"]["cost"], 0.04)
        self.assertNotIn("test-secret", json.dumps(manifest))

    def test_partial_run_checkpoints_and_resumes_without_regenerating_base(self):
        with patch.object(
            cli.requests, "post", side_effect=[response(), response(503)]
        ):
            with self.assertRaises(SystemExit):
                self.run_cli()
        self.assertEqual([x["file"] for x in self.manifest()["images"]], ["base.png"])
        with patch.object(cli.requests, "post", return_value=response()) as post:
            self.run_cli("--resume")
        self.assertEqual(post.call_count, 1)
        self.assertIn("input_references", post.call_args.kwargs["json"])
        with patch.object(cli.requests, "post") as post:
            self.run_cli("--resume")
        post.assert_not_called()
        self.assertEqual(len(self.manifest()["images"]), 2)

    def test_resume_rejects_changed_spec_and_refuses_implicit_overwrite(self):
        with patch.object(cli.requests, "post", return_value=response()):
            self.run_cli()
        for extra in [(), ("--resume", "--description", "different character")]:
            with self.subTest(extra=extra), patch.object(cli.requests, "post") as post:
                with self.assertRaises(SystemExit):
                    self.run_cli(*extra)
                post.assert_not_called()

    def test_alpha_edits_keep_white_background_companion(self):
        with patch.object(cli.requests, "post", return_value=response()) as post:
            self.run_cli("--alpha-edits")
        self.assertEqual(post.call_args.kwargs["json"]["background"], "transparent")
        with Image.open(self.output / "aiko/face_happy_raw.png") as image:
            self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))

    def test_rate_limit_retries_but_authentication_failure_does_not(self):
        with patch.object(
            cli.requests, "post", side_effect=[response(429), response()]
        ) as post, patch.object(cli.time, "sleep"):
            self.run_cli("--expressions", "", "--retries", "1")
        self.assertEqual(post.call_count, 2)
        with patch.object(cli.requests, "post", return_value=response(401)) as post:
            with self.assertRaises(SystemExit):
                self.run_cli("--slug", "other", "--retries", "2")
        self.assertEqual(post.call_count, 1)

    def test_retry_budget_is_bounded(self):
        with patch.object(
            cli.requests, "post", return_value=response(503)
        ) as post, patch.object(cli.time, "sleep"):
            with self.assertRaises(SystemExit):
                self.run_cli("--retries", "2")
        self.assertEqual(post.call_count, 3)

    def test_rejects_empty_invalid_and_opaque_image_output(self):
        cases = [
            response(body={"data": []}),
            response(body={"data": [{"b64_json": "???"}]}),
            response(image=b"not an image"),
            response(image=png(False)),
        ]
        for index, result in enumerate(cases):
            with self.subTest(index=index), patch.object(
                cli.requests, "post", return_value=result
            ):
                with self.assertRaises(SystemExit):
                    self.run_cli("--slug", f"bad{index}")
            self.assertFalse((self.output / f"bad{index}/base.png").exists())

    def test_unsafe_names_duplicate_names_and_legacy_settings_fail_before_http(self):
        cases = [
            {"slug": "../escape"},
            {"slug": "/tmp/escape"},
            {"expressions": [{"name": "../escape", "instruction": "smile"}]},
            {"expressions": ["happy", "happy"]},
            {"seed": 42},
            {"width": 832},
            {"expressions": "happy"},
            {"description": 42},
        ]
        for index, updates in enumerate(cases):
            filename = self.root / f"spec{index}.json"
            filename.write_text(
                json.dumps({"slug": "aiko", "description": "office worker", **updates})
            )
            with self.subTest(updates=updates), patch.object(
                cli.requests, "post"
            ) as post:
                with patch.object(
                    sys,
                    "argv",
                    [str(SCRIPT), "--spec", str(filename), "--out", str(self.output)],
                ):
                    with self.assertRaises(SystemExit):
                        cli.main()
                post.assert_not_called()

    def test_custom_instructions_keep_identity_constraint(self):
        filename = self.root / "spec.json"
        filename.write_text(
            json.dumps(
                {
                    "slug": "custom",
                    "description": "worker",
                    "expressions": [
                        {"name": "smug", "instruction": "one raised eyebrow"}
                    ],
                    "shots": [],
                }
            )
        )
        with patch.object(
            sys,
            "argv",
            [str(SCRIPT), "--spec", str(filename), "--out", str(self.output)],
        ), patch.object(
            cli.requests, "post", return_value=response()
        ) as post, contextlib.redirect_stdout(
            io.StringIO()
        ):
            cli.main()
        prompt = post.call_args.kwargs["json"]["prompt"]
        self.assertIn("one raised eyebrow", prompt)
        self.assertIn("identical face", prompt)

    def test_alpha_companion_name_collision_is_rejected_before_generation(self):
        filename = self.root / "collision.json"
        filename.write_text(
            json.dumps(
                {
                    "slug": "collision",
                    "description": "worker",
                    "expressions": [
                        {"name": "smile", "instruction": "smile"},
                        {"name": "smile_RAW", "instruction": "another smile"},
                    ],
                }
            )
        )
        with patch.object(
            sys,
            "argv",
            [
                str(SCRIPT),
                "--spec",
                str(filename),
                "--alpha-edits",
                "--out",
                str(self.output),
            ],
        ), patch.object(
            cli.requests, "post", return_value=response()
        ) as post, contextlib.redirect_stdout(
            io.StringIO()
        ):
            with self.assertRaises(SystemExit):
                cli.main()
            post.assert_not_called()

    def test_resume_recreates_companion_but_refuses_changed_original(self):
        with patch.object(cli.requests, "post", return_value=response()):
            self.run_cli()
        raw = self.output / "aiko/base_raw.png"
        raw.unlink()
        with patch.object(cli.requests, "post") as post:
            self.run_cli("--resume")
            self.assertTrue(raw.exists())
            post.assert_not_called()
        (self.output / "aiko/base.png").write_bytes(png(False))
        with patch.object(cli.requests, "post") as post:
            with self.assertRaises(SystemExit):
                self.run_cli("--resume")
            post.assert_not_called()

    def test_case_only_duplicate_names_fail_before_paid_requests(self):
        filename = self.root / "case-collision.json"
        filename.write_text(
            json.dumps(
                {
                    "slug": "case-collision",
                    "description": "worker",
                    "expressions": ["happy", {"name": "Happy", "instruction": "smile"}],
                }
            )
        )
        with patch.object(
            sys,
            "argv",
            [str(SCRIPT), "--spec", str(filename), "--out", str(self.output)],
        ), patch.object(
            cli.requests, "post", return_value=response()
        ) as post, contextlib.redirect_stdout(
            io.StringIO()
        ):
            with self.assertRaises(SystemExit):
                cli.main()
            post.assert_not_called()

    def test_network_retry_honors_budget_and_rate_limit_delay(self):
        limited = response(429)
        limited.headers["Retry-After"] = "3"
        with patch.object(
            cli.requests, "post", side_effect=[requests.Timeout(), limited, response()]
        ) as post, patch.object(cli.time, "sleep") as sleep:
            self.run_cli("--expressions", "", "--retries", "2")
        self.assertEqual(post.call_count, 3)
        self.assertEqual(sleep.call_args.args, (3.0,))

    def test_missing_key_and_existing_lock_prevent_paid_calls(self):
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": ""}), patch.object(
            cli.requests, "post"
        ) as post:
            with self.assertRaises(SystemExit):
                self.run_cli()
            post.assert_not_called()
        directory = self.output / "aiko"
        directory.mkdir(parents=True)
        lock = directory / ".generating"
        lock.touch()
        with patch.object(cli.requests, "post") as post:
            with self.assertRaises(SystemExit):
                self.run_cli("--resume")
            post.assert_not_called()
        self.assertTrue(lock.exists())

    def test_non_json_and_non_png_responses_are_rejected(self):
        invalid_json = response()
        invalid_json._content = b"<html>error</html>"
        buffer = io.BytesIO()
        Image.new("RGB", (2, 2)).save(buffer, format="JPEG")
        for index, result in enumerate(
            [invalid_json, response(image=buffer.getvalue())]
        ):
            with self.subTest(index=index), patch.object(
                cli.requests, "post", return_value=result
            ):
                with self.assertRaises(SystemExit):
                    self.run_cli("--slug", f"invalid{index}")


if __name__ == "__main__":
    unittest.main()
