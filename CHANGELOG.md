# Changelog

All notable changes to DeltaDotta are documented in this file.

## 0.1.0 - 2026-07-28

### Added

- Build reviewable organization packages from selected documents, code,
  database schemas, bounded read-only database rows, HTTPS exports, Git
  snapshots, and supported archives.
- Generate provider-ready Claude and ChatGPT instructions, bounded knowledge
  parts, upload manifests, role skills, policies, and behavioral evaluation
  cases.
- Require fingerprinted human review, deterministic readiness validation, and
  visible provider installation before an inferred organization can be treated
  as approved.
- Merge independently onboarded teams, refresh replayable source plans, detect
  source drift, and preserve generated packages with transactional updates.
- Provide a local web workspace, Docker image, 500-source performance
  benchmark, and clean public-package installation test.

### Safety

- Keep parsing and package generation local unless the user explicitly selects
  a network or database connector.
- Reject unsafe archives, writable database statements, unbounded inputs,
  credential patterns, stale readiness reports, and incomplete source
  ingestion.
- Keep provider uploads visible and restrict them to fingerprinted upload
  manifests; the complete operational ZIP remains local.

See [docs/LOCAL-TESTING.md](docs/LOCAL-TESTING.md) for a fictional local test
and [docs/RELEASING.md](docs/RELEASING.md) for the maintainer release gate.
