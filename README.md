<p align="center">
  <img src="public/deltadotta-logo.svg" width="420" alt="DeltaDotta" />
</p>

<h1 align="center">DeltaDotta</h1>

<p align="center">
  Onboard an organization’s documents, code, and database knowledge into Claude and ChatGPT.
</p>

<p align="center">
  <a href="LICENSE">Apache-2.0</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="SECURITY.md">Security</a>
</p>

DeltaDotta is a local-first CLI for turning scattered company knowledge into a
reviewable organization map and provider-ready operating context. It scans
documents, codebases, database schemas, and explicitly selected read-only
database rows; detects role signals; preserves source evidence; and prepares
compact onboarding bundles for Claude Projects and ChatGPT Projects or custom
GPTs.

Inferred roles remain drafts. DeltaDotta does not invent decision authority or
silently upload company data.

Role titles may use any writing system. Generated skill names, paths, review
identifiers, and behavioral case IDs use readable Latin slugs when possible and
stable hashed fallbacks otherwise; colliding titles never overwrite each other.

## Start here

| Goal                                       | Read                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| Build a first organization package         | [Quick start](#quick-start)                                                         |
| Test the packed CLI without real data      | [Local testing](docs/LOCAL-TESTING.md)                                              |
| See supported inputs and safety limits     | [Supported sources and limits](#supported-sources-and-limits)                       |
| Review the complete CLI surface            | [Commands](#commands)                                                               |
| Combine separately onboarded teams         | [Combine onboarded teams](#combine-onboarded-teams)                                 |
| Keep a package current                     | [Refresh changing organization knowledge](#refresh-changing-organization-knowledge) |
| Approve an inferred organization           | [Human review and readiness](#human-review-and-readiness)                           |
| Install and test Claude or ChatGPT context | [Provider onboarding](#provider-onboarding)                                         |
| Contribute or get help                     | [Project documentation](#project-documentation)                                     |

## Quick start

**Requirements:** Node.js 22.13+ and Corepack.

```bash
git clone https://github.com/abdullahbilalawan/deltadotta.git
cd deltadotta
corepack enable
pnpm install --frozen-lockfile
pnpm test:public-install
pnpm cli -- onboard \
  --repo ./docs/demo-workspace \
  --source . \
  --name "Local Test Company" \
  --provider chatgpt \
  --output ./.deltadotta/quick-start \
  --yes \
  --no-open
```

The smoke test installs the exact npm tarball in a clean temporary consumer
project. The onboarding command uses only fictional repository data. It should
report `needs-review` and exit with status `2`; that is the expected safety gate
for an inferred organization that no accountable person has approved.

Read [the local testing guide](docs/LOCAL-TESTING.md) for the generated files,
web and Docker checks, and a sanitized live-provider test.

`onboard` is optional, so options can come first. With no options, `pnpm cli`
starts the guided organization onboarding flow and scans the current folder.
Generated files are written to:

```text
<workspace>/.deltadotta/onboarding/
```

Use `--source` more than once to combine folders and files. Use `--database` for
SQL, Prisma, DBML, DDL, JSON, or CSV schema exports.

CLI options are strict: a misspelled or unknown option, a missing value, or a
duplicate single-use option stops before any source scan or package write.
Repeatable options such as `--source`, `--url`, and `--git` may be supplied more
than once. Both `--source ./handbook` and `--source=./handbook` work.

External company knowledge can be mixed into the same command:

```bash
export DELTADOTTA_DOC_TOKEN="your short-lived document token"
export COMPANY_DATABASE_URL="postgresql://readonly@db.example.com/company?sslmode=require"

pnpm cli -- onboard \
  --git "git@github.com:acme/internal-handbook.git#main" \
  --url "https://knowledge.example.com/org-roles.docx" \
  --http-token-env DELTADOTTA_DOC_TOKEN \
  --database-url-env COMPANY_DATABASE_URL \
  --name "Acme Company" \
  --provider claude \
  --yes
```

Private Git repositories use your existing Git credential manager or SSH agent.
PostgreSQL requires `pg_dump`; MySQL requires `mysqldump`. Use a read-only
database account and prefer `--database-url-env` so credentials do not enter
shell history.

To include selected organizational data instead of only a schema, use a query
manifest whose connection URL is named—not stored—in the file:

```json
{
  "schemaVersion": "1.0",
  "connections": [
    {
      "name": "people-system",
      "urlEnv": "COMPANY_DATABASE_URL",
      "queries": [
        {
          "name": "role-directory",
          "sql": "SELECT title, department, reports_to, purpose, responsibilities, authority, inputs, outputs FROM ai_onboarding_role_directory"
        }
      ]
    }
  ]
}
```

```bash
export COMPANY_DATABASE_URL="postgresql://readonly@db.example.com/company?sslmode=require"

pnpm cli -- onboard \
  --database-query-manifest ./database-queries.json \
  --name "Acme Company" \
  --provider chatgpt \
  --yes
```

The manifest supports PostgreSQL and MySQL and requires `psql` or `mysql`,
respectively. Prefer a dedicated, least-privilege account with `SELECT` access
only to reviewed onboarding views.

## Demo

<img src="docs/demos/software-launchpad.gif" width="720" alt="DeltaDotta running in a Mac terminal: scanning a software repository, confirming team decisions, and preflighting a generated role package." />

The demo uses only sample data from
[`docs/demo-workspace`](docs/demo-workspace/README.md). The
[recording storyboard](docs/demos/CLAUDE-DEMO-STORYBOARD.md) documents the
expected flow and safety rules.

## What it generates

```text
.deltadotta/onboarding/
├── ORGANIZATION.md
├── KNOWLEDGE-PROCESS.md
├── GAPS.md
├── PROVIDER-IMPORT.md
├── manifest.yaml
├── graph.json
├── providers/
│   ├── chatgpt/
│   │   ├── PROJECT-INSTRUCTIONS.md
│   │   ├── GPT-INSTRUCTIONS.md
│   │   ├── KNOWLEDGE.md
│   │   ├── UPLOAD-MANIFEST.md
│   │   ├── INSTALL.md
│   │   └── EVALUATION-RESPONSES.json
│   └── claude/
│       ├── PROJECT-INSTRUCTIONS.md
│       ├── KNOWLEDGE.md
│       ├── UPLOAD-MANIFEST.md
│       ├── INSTALL.md
│       └── EVALUATION-RESPONSES.json
├── review/
│   └── organization.review.json
├── validation/
│   ├── generated-files.json
│   ├── readiness.json
│   ├── readiness.md
│   ├── source-ingestion.json
│   ├── source-ingestion.md
│   ├── source-plans.json
│   ├── source-plans.md
│   ├── provider-evaluation-cases.json
│   ├── provider-evaluation-cases.md
│   └── provider-knowledge.json
├── roles/<role>/SKILL.md
├── contracts/<role>.md
└── policies/
    ├── authority.md
    ├── escalations.md
    └── handoffs.md
```

Large provider context is split into numbered `KNOWLEDGE-002.md`,
`KNOWLEDGE-003.md`, and later parts as needed. The adjacent
`<output-folder>.zip` contains the complete operational package; it is not a
provider upload bundle. Source-plan files appear when the selected inputs can be
replayed by `refresh`.

| Output                | Purpose                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization map      | Records role ownership, reporting lines, handoffs, and escalation paths.                                                                       |
| Role skills           | Gives Claude, ChatGPT, Codex, or Claude Code focused instructions tied to source evidence.                                                     |
| Confidence report     | Separates verified sources, template assumptions, and unresolved gaps.                                                                         |
| Provider bundles      | Separates behavior instructions from compact organization knowledge for Claude and ChatGPT Projects.                                           |
| Canonical review      | Lets an accountable reviewer remove false positives, add missing roles, and explicitly confirm authority, reporting, escalation, and evidence. |
| Readiness report      | Blocks provider onboarding until the reviewed organization and generated artifacts pass deterministic integrity checks.                        |
| Behavioral evaluation | Generates organization-specific role-routing, authority, escalation, conflict, and source-grounding cases for the actual provider project.     |
| Portable package      | Provides reviewable Markdown, a local operational ZIP archive, and stable `manifest.yaml` and `graph.json` files.                              |

The older team-specific `launch` flow can also install a clearly marked block
in `AGENTS.md` or `CLAUDE.md`. It only updates that block and can be run without
installing provider context.

## Supported sources and limits

### Sources

- Documents: PDF, DOCX, XLSX, PPTX, ODT/ODS/ODP, RTF, Markdown, text,
  CSV/TSV, JSON/JSONL, YAML, TOML, XML, HTML, and RST.
- Export bundles: local, HTTPS, or Git-hosted ZIP files containing supported
  documents, code, or schema exports.
- Custom Markdown role cards: any heading can define a role when its section
  provides labeled purpose, department, reporting, responsibilities, authority,
  inputs, outputs, or collaborators. No predefined team template is required.
- Organization tables and people directories: CSV/TSV or Markdown tables and
  bounded YAML `roles`/`people` collections retain titles, departments,
  reporting, ownership, inputs, outputs, collaborators, and authority.
- Plain-language reporting statements such as “Release Captain reports to Head
  of Operations” are linked to detected ownership and authority sentences while
  remaining draft evidence for accountable review.
- Codebases: common source files, configuration, workflows, ownership files,
  Dockerfiles, and runbooks.
- Database knowledge: local SQLite files (schema only), SQL/DDL, Prisma, DBML,
  schema text, JSON and CSV exports, plus explicitly selected read-only
  PostgreSQL/MySQL query results.
- External sources: HTTPS documents/exports, shallow Git snapshots, and
  PostgreSQL or MySQL schema snapshots and selected query results.

### Local and archive limits

The final combined scan is bounded to 500 retained sources and 4 MB of
extracted text across local files, external connectors, schemas, and selected
database rows. Local text is additionally bounded to 128 KB per file and binary
documents to 25 MB per input. Dependency, build, coverage, generated
DeltaDotta, and version-control folders are skipped. Symlinks are not followed.
The selected output folder and ZIP are also recorded as scan exclusions, so
rerunning onboarding into a custom in-repository destination cannot ingest its
own prior package. An output cannot replace the source root or one of its
ancestors. Image OCR is disabled, so parsing remains local and deterministic.

Imported and merged organization graphs fail closed on malformed entries and
are structurally bounded to 10,000 roles, 25,000 evidence records, 50,000 source
conflicts, and 50 replay plans. Nested role fields, conflict claims, warnings,
and replay lists also have explicit limits. Artifact writes use bounded
concurrency, so a large but valid organization does not attempt to open every
role file simultaneously.

ZIP imports accept at most 1,000 entries and 25 MB of declared expanded data.
Absolute paths, parent-directory traversal, duplicate or portable-filesystem
colliding paths, symbolic links, nested ZIP files, and CRC checksum failures are
rejected before extraction.
Supported entries retain their `archive.zip!/entry` provenance while change
detection fingerprints the whole archive container.

Legacy DOC/XLS/PPT files are reported as skipped rather than silently ignored.
Convert them to a supported format first. SQLite databases are opened read-only
and only `sqlite_schema` is queried; application rows are not copied.

### External connector limits

External HTTP downloads are limited to five redirects, 30 seconds, 25 MB for a
binary document, and 1 MB of extracted text per source. HTTPS is required except
for localhost. Authorization is read from the named environment variable and is
dropped if a redirect crosses origins. Query tokens and passwords are removed
from generated provenance. A run accepts at most 50 external connector inputs.
Independent HTTP exports are fetched with at most four concurrent requests and
are merged in the original command-line order, so latency improves without
making evidence order nondeterministic. The measured ingestion duration is
stored in the graph, manifest, and source-ingestion reports.

Git connectors make a depth-one, single-branch snapshot without tags or
submodules and record the commit revision. Schema connectors use `pg_dump
--schema-only` for PostgreSQL and `mysqldump --no-data` for MySQL.

Selected-row manifests accept at most 10 connections and 50 queries. Every
query must be one `SELECT` or read-only CTE; comments, additional statements,
writes, DDL, locks, `SELECT INTO`, session mutation, file-reading functions, and
known side-effect functions are rejected. Database-level read-only mode remains
enabled as a second guard. Each result is limited to 500 rows, 1 MB, and 15
seconds, with a 4 MB aggregate limit. The generated evidence records a sanitized
database locator, query name, query fingerprint, content fingerprint, and
truncation warning. Connection URLs and passwords are not written to the
package.

One onboarding run accepts at most 10 query manifest files and executes at most
two manifest collectors concurrently, preventing repeatable flags from creating
unbounded database fan-out.

### Completeness and secret checks

If a requested local path, HTTPS export, Git repository, database schema, or
selected query cannot be read completely within the documented bounds,
onboarding fails before writing a package. The same rule applies when otherwise
valid connector results exceed the combined 500-source or 4 MB budget.
Truncation that retains bounded evidence remains visible as a warning. This
prevents a successful-looking organization map from silently omitting a
requested system of record.

Every retained warning is also written to
`validation/source-ingestion.json`, `validation/source-ingestion.md`,
`graph.json`, `manifest.yaml`, and `GAPS.md`, so it survives review, ZIP
packaging, and handoff to another operator.

Before writing a package, DeltaDotta also checks selected text for
high-confidence private-key, provider-token, cloud-key, and credential-bearing
connection-URL patterns. It reports only the source and credential category, not
the matched value. Redact the source first. The
`--allow-secret-patterns` override exists for reviewed test fixtures and should
not be used casually.

## How it works

1. Reads only the local paths and external connectors selected by the user.
2. Classifies evidence as document, codebase, or database knowledge and records
   a SHA-256 content fingerprint.
3. Detects roles across common company functions and creates a general
   organization draft.
4. Generates Claude and ChatGPT instructions, compact provider knowledge, role
   skills, policies, a confidence report, and a portable ZIP.
5. Generates `review/organization.review.json`; inferred roles remain drafts
   until an accountable reviewer confirms the canonical scope.
6. Rebuilds the package with `refine` and requires `validate` to report ready
   with zero blockers before provider onboarding.
7. Guides the visible provider setup with `install`, then scores raw responses
   from the actual project with `evaluate`.

The package does not run a live model or enforce permissions inside Claude,
ChatGPT, Codex, or connected tools.

## Commands

| Command                                                              | Description                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm cli`                                                           | Build and run guided mixed-source organization onboarding.                                        |
| `pnpm cli -- --source ...`                                           | Run scripted onboarding with the optional `onboard` command omitted.                              |
| `pnpm cli -- onboard ...`                                            | Run the same scripted onboarding with an explicit command.                                        |
| `pnpm cli -- merge --package <base> --with <team> ...`               | Combine independently onboarded teams into one freshly reviewed organization.                     |
| `pnpm cli -- refresh --package <folder>`                             | Re-ingest recorded source plans into a new package and require fresh review.                      |
| `pnpm cli -- refine --package <folder>`                              | Apply the edited canonical review and rebuild the package.                                        |
| `pnpm cli -- validate --package <folder>`                            | Recompute readiness from the graph and actual provider artifacts.                                 |
| `pnpm cli -- install --provider chatgpt --package <folder>`          | Validate, open the official project surface, and print exact setup paths.                         |
| `pnpm cli -- evaluate --package <folder> --results <responses.json>` | Score raw responses from the installed Claude or ChatGPT Project.                                 |
| `pnpm cli -- check`                                                  | Verify bounded local fingerprints and require refresh verification for external snapshots.        |
| `pnpm cli -- launch`                                                 | Run the software or manufacturing team Launchpad.                                                 |
| `pnpm cli -- init`                                                   | Run the open-ended organization interview.                                                        |
| `pnpm benchmark:cli`                                                 | Benchmark a complete 500-source organization import and verify every selected source is retained. |
| `pnpm test:public-install`                                           | Pack, install, and exercise the exact public CLI payload in a clean temporary project.            |
| `pnpm dev`                                                           | Start the local web workspace.                                                                    |
| `pnpm verify`                                                        | Run type checks, CLI build, tests, and the production build.                                      |

Run `pnpm cli -- --help` to view all CLI options or `pnpm cli -- --version` to
print the installed version.

### CLI performance benchmark

`pnpm benchmark:cli` creates a temporary 500-source organization, runs the
actual built CLI through package and ZIP generation, verifies that all 500
sources survived, runs full package validation, reports ingestion, validation,
and end-to-end timing plus artifact sizes, and removes the fixture. Set
`DELTADOTTA_BENCHMARK_MAX_MS` when a particular machine or CI runner has an
established regression budget.

## Combine onboarded teams

Merge up to 25 independently onboarded team packages in a deterministic order:

```bash
pnpm cli -- merge \
  --package .deltadotta/company-core \
  --with .deltadotta/engineering \
  --with .deltadotta/operations \
  --name "Acme Company" \
  --output .deltadotta/complete-organization \
  --no-open
```

The destination must be new or empty and cannot replace an input package.
Common executive title aliases are matched, source evidence is preserved, and
department, reporting, and explicit allow/deny authority disagreements created
by the combination become review blockers. Every prior role and organization
attestation is invalidated so the complete organization receives one fresh
accountable review.

## Refresh changing organization knowledge

Every new onboarding package records a local-only source replay plan. Team
merges retain all plans, including each team's original base folder. Refreshing
re-ingests documents, code, Git snapshots, schemas, and selected read-only query
manifests before building a new draft:

```bash
pnpm cli -- refresh \
  --package .deltadotta/complete-organization \
  --output .deltadotta/complete-organization-refreshed \
  --no-open
```

DeltaDotta writes to a new or empty destination so the reviewed prior package
remains available for comparison. The refreshed organization has no inherited
review approval: every role, warning, and newly detected conflict must be
reviewed again.

`validation/source-plans.json` stores local base paths, connector locations,
and environment-variable names. It never stores HTTP token values, database
URLs, passwords, or selected database rows and must not be uploaded as provider
knowledge. Signed/query-bearing URLs and direct `--database-url` inputs are
marked non-replayable instead of being stored; use stable URLs with
`--http-token-env` and database URLs supplied through `--database-url-env` for
automatic refresh.

`deltadotta check --package <folder>` verifies local files against their
recorded source base even when run from another directory. The quick check never
claims that HTTPS, Git, or database snapshots are current without fetching them:
it exits with status 2 and directs replayable packages to `refresh`. Local
freshness reads are bounded to the same text/binary limits used during
ingestion, so a source that grew unexpectedly cannot exhaust memory.

Package and ZIP updates are staged completely before replacement. A
traversal-safe generated-file inventory lets `refine` remove obsolete role
skills and old evaluation artifacts while preserving files it does not own.
Validation and provider-evaluation reports use the same rollback-safe artifact
update path and synchronize the portable ZIP. If replacement fails, DeltaDotta
restores the previous files and archive instead of leaving a partially updated
organization.

## Human review and readiness

An inferred map is useful evidence, not an authoritative organization. Complete
the review loop before importing it into a provider:

1. Open `review/organization.review.json`.
2. Remove false-positive roles and add any missing roles.
3. Confirm purpose, ownership, permissions, reporting, escalation, inputs,
   outputs, collaborators, and linked evidence.
4. Review every entry in `organization.ingestionWarnings` against
   `validation/source-ingestion.md`; set `acknowledged` to `true` only after the
   canonical role scope accounts for the skipped or bounded material.
5. Resolve every entry in `organization.sourceConflicts`. The resolution must
   exactly match the selected canonical department, reporting value, or
   permission; removing a false-positive role requires the explicit resolution
   `Role removed from canonical scope`.
6. Fill `reviewedBy` and `reviewedAt`, and set `confirmed` to `true` only for
   roles an accountable owner has checked.
7. Run:

```bash
pnpm cli -- refine --package .deltadotta/onboarding
pnpm cli -- validate --package .deltadotta/onboarding
```

Readiness remains blocked when evidence is missing, roles are unconfirmed,
authority is empty, reporting is invalid or circular, escalation is unresolved,
structured sources disagree about a department, reporting line, or an explicit
positive/negative authority claim, credentials are detected, or required
Claude/ChatGPT artifacts are absent. Unacknowledged ingestion warnings also
block readiness; acknowledged warnings remain visible as warnings rather than
being erased. Conflicting
claims and their exact source names remain visible in `GAPS.md`; a fingerprinted
review records the canonical decision instead of silently overwriting a source.
Warnings remain visible for weaker source diversity, ambiguous handoffs, or
multiple top-level roles.

## Provider onboarding

Continue only after `validation/readiness.md` reports `ready` with zero
blockers. DeltaDotta uses only documented provider surfaces: current ChatGPT and
Claude documentation describes creating projects, adding instructions, and
uploading knowledge through their product interfaces. DeltaDotta therefore opens
the official surface and guides those visible actions instead of calling
undocumented private endpoints.

```bash
pnpm cli -- install \
  --provider chatgpt \
  --package .deltadotta/onboarding
```

For ChatGPT, follow `providers/chatgpt/INSTALL.md`. The bundle includes separate
Project/custom-GPT instructions and bounded text-forward knowledge parts. Every
part is listed in the upload manifest and fingerprinted in
`validation/provider-knowledge.json`. The same manifest authenticates project
instructions, upload manifests, install guides, organization/gaps summaries,
and behavioral test cases; installation independently recomputes readiness.
ChatGPT’s
official guidance distinguishes behavioral instructions from uploaded
knowledge: [creating a GPT](https://help.openai.com/en/articles/8554397-creating-a-gpt)
and [ChatGPT Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt).

For Claude, follow `providers/claude/INSTALL.md`. It includes project
instructions, bounded knowledge parts, and reviewable role skills. See
Anthropic’s guidance for [project file uploads](https://support.claude.com/en/articles/8241126-upload-files-to-claude),
[Claude Projects](https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects),
and [Claude Skills](https://support.claude.com/en/articles/12512180-use-skills-in-claude).

For either provider, upload only the files listed in its
`UPLOAD-MANIFEST.md`. Keep the full portable ZIP local: it includes the graph,
review scaffolding, source replay plans, and other operational metadata that are
needed for refresh and audit but are not provider knowledge.

### Verify the installed project

Run every generated case in a fresh chat inside the installed project, preserving
the raw JSON responses:

```bash
pnpm cli -- evaluate \
  --package .deltadotta/onboarding \
  --results .deltadotta/onboarding/providers/chatgpt/EVALUATION-RESPONSES.json
```

Evaluation covers every reviewed role and verifies exact routing,
authority-boundary decisions, escalation, source naming, embedded-instruction
resistance, and absence of unsupported claims. The submission
must identify the tested official provider project, evaluator, and timestamp;
DeltaDotta fingerprints it and writes `validation/provider-evaluation.md`.
Failures remain failures—responses are never rewritten or graded from vague
similarity.

## Web workspace

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to edit Software or
Manufacturing templates, import packages, and export ZIP files.

The web workspace uses the same safe merge behavior as the CLI.

To run the web workspace with Docker:

```bash
docker compose up --build
```

The container runs as a non-root user and exposes a health check at
`/api/health`.

## Safety and privacy

- Parsing and package generation run locally. Network access occurs only for
  explicit `--url`, `--git`, or `--database-url[-env]` inputs.
- Selected evidence and assumptions remain visible in the generated package.
- No source is sent to Claude, ChatGPT, or another AI provider by the CLI.
- SQLite ingestion is schema-only and opens the database in read-only mode.
- PostgreSQL and MySQL schema connectors invoke schema-only dump modes.
  Selected-row manifests run only validated, bounded `SELECT`/CTE queries in
  database-level read-only mode. In both cases, use an account whose server
  permissions independently allow access only to reviewed schemas, tables, or
  views.
- HTTP tokens and database passwords are not written to generated packages.
- Source replay plans are local operational metadata and are excluded from the
  documented Claude/ChatGPT upload list. They contain filesystem locations and
  environment-variable names, but no environment-variable values.
- Generated package replacement is transactional. Cleanup is restricted to
  recognized DeltaDotta artifact paths; user-authored files are preserved.
- Control files and managed package artifacts have explicit byte limits and are
  read with bounded concurrency during validation.
- Imported graphs and canonical reviews reject malformed, non-string, or
  structurally oversized arrays rather than silently dropping part of the
  organization.
- Query output is company data even when the query is read-only. Select only the
  fields needed for onboarding and review generated evidence before provider
  upload.
- Package creation stops when selected source text matches a high-confidence
  credential pattern unless the user supplies an explicit reviewed-fixture
  override.
- Inferred roles are drafts and inferred authority is left empty for review.
- Human review is explicitly attested in the graph. The canonical packaged
  review has a SHA-256 fingerprint shared by every reviewed role, conflict
  decision, and warning acknowledgement. Missing or modified review artifacts
  block readiness.
- Installation and provider evaluation refuse stale readiness reports until
  `deltadotta validate` regenerates both machine-readable and human-readable
  results. Validation restores either readiness artifact if it is missing and
  synchronizes the portable ZIP in the same run.
- First-shift preflight is read-only and does not deploy, access production
  credentials, or modify operational systems.
- Provider permissions, approvals, logging, and revocation must be configured
  separately.
- Provider project creation and file upload remain visible user actions; the CLI
  does not use undocumented project endpoints.
- Provider verification stores raw model responses and an evaluator attestation
  so behavioral claims remain auditable.
- Real organization exports, credentials, and provider tokens should not be
  committed.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Project documentation

- [Local testing](docs/LOCAL-TESTING.md): verify the packed CLI, demo workflow,
  web workspace, Docker image, and real provider installation.
- [Contributing](CONTRIBUTING.md): local setup and pull-request expectations.
- [Support](SUPPORT.md): where to ask questions and report reproducible bugs.
- [Security](SECURITY.md): private vulnerability reporting and trust boundaries.
- [Governance](GOVERNANCE.md): project decisions, maintainers, and releases.
- [Releasing](docs/RELEASING.md): maintainer checks, npm publication, and
  post-release verification.
- [Changelog](CHANGELOG.md): user-visible changes by release.
- [Code of Conduct](CODE_OF_CONDUCT.md): community participation standards.
- [Trademark](TRADEMARK.md): permitted use of the DeltaDotta name and logo.

## License

The source code is licensed under [Apache-2.0](LICENSE). Use of the DeltaDotta
name and visual identity is covered by [TRADEMARK.md](TRADEMARK.md).
