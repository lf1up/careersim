# OpenRouter character bundles implementation plan

> Execute inline using superpowers:executing-plans.

**Goal:** Deliver a separate OpenRouter alternative to rebased PR #67.
**Architecture:** One Python CLI calls the image API, validates output, and
checkpoints a local bundle. No running server or GPU deployment.
**Tech stack:** Python 3.11+, requests, Pillow, unittest.
**Spec:** `docs/superpowers/specs/2026-11-12-imagegen-openrouter-design.md`.

## Constraints and review focus

Preserve the original PR. Keep edits scoped to imagegen, its documentation,
and its CI job. Check malformed API output, missing alpha, path traversal,
partial runs, settings mismatches on resume, and retry billing behavior.

### Task 1: Replace the standalone pipeline

Files: `imagegen/scripts/generate_character.py`, `imagegen/tests/`,
`imagegen/pyproject.toml`, `imagegen/README.md`, `imagegen/RESEARCH.md`,
`.github/workflows/ci.yml`. Delete `imagegen/modal_app/` and `imagegen/workflows/`.

- [x] Add CLI tests using real PNG fixtures and mocked HTTP at the network boundary.
- [x] Run tests against the original implementation and observe missing behavior.
- [x] Implement API requests, output verification, checkpointing, and resume.
- [x] Update dependencies, examples, tradeoffs, and CI.
- [x] Run all imagegen tests and CLI help; inspect the diff and deleted references.
- [x] Review the complete change and prepare it for a separate draft PR.

## Progress

- Original PR rebased without conflicts and pushed with an exact-head lease.
- Original patch contents verified unchanged with range-diff and tree comparison.
- Implementation uses the already-clean checkout on a separate branch.
- All 15 offline imagegen tests pass in its own environment. CLI help and diff
  whitespace checks pass. The original CLI's missing behavior and filename
  collision regressions were observed failing before their fixes.
- Independent review found a case-insensitive filename collision. Names and raw
  companion names now compare case-insensitively before any paid request.
- No OpenRouter key is available in this session. No live generation or artwork
  quality/cost comparison was performed. The alternative remains a draft.
