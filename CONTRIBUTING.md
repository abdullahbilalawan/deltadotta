# Contributing to DeltaDotta

Thanks for helping make organization onboarding easier to trust and reuse.

## Before you begin

- Read the [Code of Conduct](CODE_OF_CONDUCT.md).
- Search existing issues and pull requests before opening a new one.
- For a security concern, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Local setup

DeltaDotta supports Node.js 22.13 or later and uses pnpm.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm test:public-install
pnpm dev
```

The clean-install smoke test packs and installs the same payload npm will
receive. The web workspace runs at `http://localhost:3000`. To exercise the
one-command CLI:

```bash
pnpm cli:build
node dist/bin/deltadotta.js
```

## Pull requests

Keep each pull request focused. Explain the problem, include tests for behavior
changes, and update user-facing documentation when commands or exported package
formats change. Run `pnpm release:check` before requesting review for a release
candidate.

Do not add credentials, private organization material, production exports, or
generated `.deltadotta/` launch folders to the repository.

## Design principles

- Make the first useful result fast and understandable.
- Keep evidence local and make generated claims traceable.
- Default agent verification to read-only behavior.
- Preserve package portability: `manifest.yaml` and `graph.json` are public
  contracts and require backward-compatible changes or a schema-version bump.

## Community decisions

Maintainers use the process in [GOVERNANCE.md](GOVERNANCE.md). Opening an issue
with a concrete example is the best way to propose a template, adapter, or
package-format change.
