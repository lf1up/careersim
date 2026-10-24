"""CareerSIM Agent - LangGraph conversation agent with Gradio UI."""

import tomllib
from pathlib import Path

# parents[2] is the project root. The image copies pyproject.toml there
# (editable install; see agent/Dockerfile).
_pyproject = Path(__file__).resolve().parents[2] / "pyproject.toml"
with _pyproject.open("rb") as _f:
    __version__ = tomllib.load(_f)["project"]["version"]
