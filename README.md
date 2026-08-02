<p align="center">
  <img src="public/deltadotta-logo.svg" width="420" alt="DeltaDotta" />
</p>

<h1 align="center">DeltaDotta</h1>

<p align="center">
  Shared, reviewed company context for Claude and ChatGPT.
</p>

<p align="center">
  <a href="LICENSE">Apache-2.0</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="SECURITY.md">Security</a>
</p>

Companies often use Claude and ChatGPT in isolated sessions, forcing every
employee to rebuild company context from scratch. DeltaDotta turns scattered
organizational knowledge into a shared, reviewed AI context package so teams
can get consistent, company-aware answers without weeks of manual setup.

## Quick start

Requires Node.js 22.13 or later.

```bash
cd /path/to/company-folder
npx --yes deltadotta
```

DeltaDotta scans the current folder locally and writes the package to:

```text
.deltadotta/onboarding/
```

Nothing is uploaded automatically.

## Demo

[Watch the 35-second end-to-end usage demo](docs/demos/deltadotta-usage-demo.mp4).

It shows onboarding, human-review refinement, validation, and ChatGPT project
setup using the real CLI.

### Example organization map

```mermaid
flowchart TB
    GM["General Manager<br/>Company priorities and final escalations"]
    DC["Dispatch Coordinator<br/>Daily dispatch and delivery exceptions"]
    SO["Safety Officer<br/>Field safety and stop-work authority"]

    GM --> DC
    GM --> SO
    DC -. "Safety handoff" .-> SO
```

## How it works

1. **Scan**
   Read selected documents, code, database knowledge, Git repositories, and
   HTTPS sources.

2. **Map**
   Create a draft organization map with roles, ownership, authority, handoffs,
   escalation paths, source evidence, and fingerprints.

3. **Review**
   A human confirms the organization and resolves gaps or conflicting sources.

4. **Install**
   Add the reviewed instructions and knowledge files to a Claude or ChatGPT
   Project.

## Review and validate

The first package is expected to report `needs-review`.

Edit:

```text
.deltadotta/onboarding/review/organization.review.json
```

Then run:

```bash
npx --yes deltadotta refine --package .deltadotta/onboarding
npx --yes deltadotta validate --package .deltadotta/onboarding
```

When validation reports `ready`, start the guided provider setup:

```bash
npx --yes deltadotta install \
  --provider chatgpt \
  --package .deltadotta/onboarding
```

Use `--provider claude` for Claude Projects.

## What it creates

- A reviewable organization map
- Role-specific skills and authority boundaries
- Source evidence with content fingerprints
- Gaps, conflicts, and readiness reports
- Claude and ChatGPT project packages
- A portable local ZIP archive

## Supported knowledge

- Documents, spreadsheets, presentations, PDFs, Markdown, CSV, JSON, and YAML
- Source code, configuration, workflows, ownership files, and runbooks
- SQL, Prisma, DBML, DDL, and SQLite schemas
- Selected read-only PostgreSQL and MySQL query results
- HTTPS documents, ZIP exports, and Git repositories

## Safety

- Inferred roles and authority remain drafts until reviewed by a human.
- Local sources stay local unless a user explicitly uploads reviewed files.
- Potential credential patterns block package creation by default.
- Database collection is limited to schemas and explicitly selected read-only rows.
- DeltaDotta describes permissions but does not enforce provider or tool access.

## Commands

Run `npx --yes deltadotta --help` for the complete command and option reference.

## Documentation

- [Local testing](docs/LOCAL-TESTING.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Support](SUPPORT.md)
- [Release process](docs/RELEASING.md)

## License

Apache License 2.0. See [LICENSE](LICENSE).
