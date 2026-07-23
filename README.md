<p align="center">
  <img src="public/deltadotta-logo.svg" width="420" alt="DeltaDotta" />
</p>

<h1 align="center">DeltaDotta</h1>

<p align="center">
  Generate evidence-backed role instructions for Codex and Claude Code.
</p>

<p align="center">
  <a href="LICENSE">Apache-2.0</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="SECURITY.md">Security</a>
</p>

DeltaDotta scans repository knowledge, maps ownership and escalation paths, and
exports portable role packages for AI-assisted work. It runs locally and keeps
the source evidence visible for human review.

## Quick start

**Requirements:** Node.js 20+ and pnpm.

```bash
git clone https://github.com/abdullahbilalawan/deltadotta.git
cd deltadotta
corepack enable
pnpm install --frozen-lockfile
pnpm cli
```

The guided Launchpad asks for a workspace, team type, owner, authority boundary,
escalation path, and handoff. Generated files are written to:

```text
<workspace>/.deltadotta/launchpad/
```

To try the included Northstar Checkout example, enter
`docs/demo-workspace` when Launchpad asks for a workspace.

## Demo

<img src="docs/demos/software-launchpad.gif" width="720" alt="DeltaDotta running in a Mac terminal: scanning a software repository, confirming team decisions, and preflighting a generated role package." />

The demo uses only sample data from
[`docs/demo-workspace`](docs/demo-workspace/README.md).

## What it generates

```text
.deltadotta/launchpad/
├── ORGANIZATION.md
├── KNOWLEDGE-PROCESS.md
├── GAPS.md
├── manifest.yaml
├── graph.json
├── roles/
├── contracts/
├── policies/
└── PROVIDER-IMPORT.md
```

| Output | Purpose |
| --- | --- |
| Organization map | Records role ownership, reporting lines, handoffs, and escalation paths. |
| Role skills | Gives Codex or Claude Code focused instructions tied to repository evidence. |
| Confidence report | Separates verified sources, template assumptions, and unresolved gaps. |
| Portable package | Provides reviewable Markdown plus stable `manifest.yaml` and `graph.json` files. |

DeltaDotta can install a clearly marked block in `AGENTS.md` or `CLAUDE.md`.
It only updates that block and can be run without installing provider context.

## How it works

1. Scans bounded repository files such as READMEs, runbooks, CODEOWNERS, and
   workflow configuration.
2. Links evidence to owners, authority boundaries, handoffs, and escalation
   rules.
3. Generates provider-ready role instructions and a portable organization
   package.
4. Runs deterministic, read-only checks against the first role contract.

Preflight confirms that the generated package is internally complete. It does
not run a live model or enforce permissions inside Codex, Claude Code, or other
providers.

## Commands

| Command | Description |
| --- | --- |
| `pnpm cli` | Build and run the guided Launchpad from this checkout. |
| `pnpm cli check` | Report source evidence that moved, changed, or disappeared. |
| `pnpm cli init` | Run the open-ended organization interview. |
| `pnpm dev` | Start the local web workspace. |
| `pnpm verify` | Run type checks, CLI build, tests, and the production build. |

Run `pnpm cli --help` to view all CLI options.

## Web workspace

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to edit Software or
Manufacturing templates, import packages, and export ZIP files.

To run the web workspace with Docker:

```bash
docker compose up --build
```

The container runs as a non-root user and exposes a health check at
`/api/health`.

## Safety and privacy

- Repository scanning and package generation run locally.
- Scanned evidence and assumptions remain visible in the generated package.
- First-shift preflight is read-only and does not deploy, access production
  credentials, or modify operational systems.
- Provider permissions, approvals, logging, and revocation must be configured
  separately.
- Real organization exports, credentials, and provider tokens should not be
  committed.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Community
standards and project decisions are documented in
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [GOVERNANCE.md](GOVERNANCE.md).

## License

The source code is licensed under [Apache-2.0](LICENSE). Use of the DeltaDotta
name and visual identity is covered by [TRADEMARK.md](TRADEMARK.md).
