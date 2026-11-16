# Commit messages

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
for commits and pull request titles. For example:

```text
feat(auth): add passkey sign-in
fix(api): handle an expired session
feat(api)!: remove the legacy endpoint
```

Use `feat` for features, `fix` for bug fixes, and `!` or a `BREAKING CHANGE:`
footer for breaking changes. Commitlint uses its standard conventional preset.

## Local setup

Run once from the repository root with Node.js 22 and pnpm installed:

```sh
pnpm --dir tools/commitlint install --ignore-workspace --frozen-lockfile --ignore-scripts
git config --local core.hooksPath .githooks
```

The commit-msg hook rejects invalid messages before Git creates a commit.
The tooling has its own dependencies and lockfile, separate from the app.
If you already use a custom hooks directory, add the command from
`.githooks/commit-msg` to its commit-msg hook instead of replacing your setup.

## CI enforcement

The `Commit messages` workflow checks every commit in a pull request and its
title, so squash merge messages follow the same convention. It also checks
new commits pushed to the default branch. Standard Git merge and revert
messages keep commitlint's default exemptions. Existing history is not rewritten.

In GitHub repository settings, make `Conventional commits` a required status
check for the protected default branch. A workflow failure blocks merges only
when the branch protection rule or ruleset requires that check.
