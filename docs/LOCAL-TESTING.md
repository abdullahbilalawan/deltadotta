# Test DeltaDotta locally

This guide starts with fictional files from `docs/demo-workspace`. It does not
upload anything or require a Claude or ChatGPT account.

## Requirements

- Node.js 22.13 or later
- Corepack, included with supported Node.js releases
- Docker only if you want to test the container

Confirm the local tools:

```bash
node --version
corepack --version
```

## Install and verify the repository

From the DeltaDotta repository:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` runs the type checker, builds the CLI, runs the automated test
suite, and creates a production web build.

## Test the exact public package

Run:

```bash
pnpm test:public-install
```

This test packs the same files npm will receive, installs that tarball into a
new temporary consumer project, runs the installed CLI, builds a fictional
organization package, validates its archive, and confirms that an unreviewed
organization is blocked from provider installation.

The test removes its temporary files after success. To inspect them:

```bash
DELTADOTTA_KEEP_SMOKE_TEMP=1 pnpm test:public-install
```

In PowerShell:

```powershell
$env:DELTADOTTA_KEEP_SMOKE_TEMP = "1"
pnpm test:public-install
```

The last line prints the retained temporary folder.

## Run onboarding yourself

Use the fictional demo workspace:

```bash
pnpm cli -- \
  --repo ./docs/demo-workspace \
  --source . \
  --name "Local Test Company" \
  --provider chatgpt \
  --output ./.deltadotta/manual-test \
  --yes \
  --no-open
```

The command should:

1. Say that the package is ready for human review.
2. Create `.deltadotta/manual-test` and
   `.deltadotta/manual-test.zip`.
3. Report `needs-review`.
4. Exit successfully after writing the reviewable package. The separate
   `validate` command below returns status `2` until an accountable person
   completes the review.

Inspect these files first:

- `.deltadotta/manual-test/organization-map.html`
- `.deltadotta/manual-test/ORGANIZATION.md`
- `.deltadotta/manual-test/GAPS.md`
- `.deltadotta/manual-test/review/organization.review.json`
- `.deltadotta/manual-test/validation/readiness.md`

Re-run the deterministic gate:

```bash
pnpm cli -- validate --package ./.deltadotta/manual-test
```

It should also report `needs-review` and exit with status `2` until an
accountable person completes the canonical review.

## Test the installed CLI as a customer

Build and install the same tarball npm will receive:

```bash
cd deltadotta
npm pack
npm install --global ./deltadotta-0.1.1.tgz
```

Then copy the fictional workspace outside the DeltaDotta source folder and
enter that customer folder before starting the one-command flow:

```bash
CUSTOMER_TEST_ROOT="$(mktemp -d)"
cp -R docs/demo-workspace "$CUSTOMER_TEST_ROOT/Demo Workspace"
cd "$CUSTOMER_TEST_ROOT/Demo Workspace"
deltadotta
```

The command does not ask setup questions. It uses `Demo Workspace` as the
organization name and ChatGPT as the first provider target. Supply
`--name "Flameco"` or `--provider claude` only when you want to override those
defaults.

Do not start the customer walkthrough from the DeltaDotta source folder. That
folder contains DeltaDotta's own test fixtures, example credential strings,
screenshots, and demo videos rather than one customer's organization knowledge.

## Test the web workspace

```bash
pnpm dev
```

Open <http://localhost:3000>. The health endpoint is
<http://localhost:3000/api/health>.

To test the production container:

```bash
docker compose up --build
```

Stop it with `Ctrl+C`.

## Test a real Claude or ChatGPT project

Use only fictional or sanitized organization material for the first provider
test.

1. Build the package and complete
   `review/organization.review.json`.
2. Run `refine`, then `validate`, and continue only when readiness is `ready`
   with zero blockers.
3. Run `install` for one provider:

   ```bash
   pnpm cli -- install \
     --provider chatgpt \
     --package ./.deltadotta/manual-test
   ```

4. Follow the generated `providers/chatgpt/INSTALL.md`. Upload only files named
   by `providers/chatgpt/UPLOAD-MANIFEST.md`; never upload the complete ZIP.
5. Run every case in
   `validation/provider-evaluation-cases.md` in a fresh project chat.
6. Save the raw results in the generated
   `providers/chatgpt/EVALUATION-RESPONSES.json`.
7. Evaluate them:

   ```bash
   pnpm cli -- evaluate \
     --package ./.deltadotta/manual-test \
     --results ./.deltadotta/manual-test/providers/chatgpt/EVALUATION-RESPONSES.json
   ```

Repeat with `--provider claude` and the generated Claude install guide. A public
release candidate should have a real, sanitized pass from both providers; the
automated suite cannot substitute for those product-interface checks.

## Before testing real company data

- Start with a copy or export, not a live writable system.
- Use read-only database credentials.
- Remove secrets and personal data that are not needed for organization
  onboarding.
- Review the generated upload manifest before sending any file to a provider.
- Keep the complete ZIP local because it contains operational metadata that is
  not provider knowledge.
