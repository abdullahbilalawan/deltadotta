import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { collectKnowledgeSources, mergeSourceScanResults } from "../lib/source-ingestion";
import { compilePackage, createOrganizationFromEvidence, evidenceHash, knowledgeEvidence } from "../lib/organization";

function simplePdf(text: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length + 35} >>\nstream\nBT /F1 16 Tf 72 720 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { body += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

describe("mixed organization knowledge ingestion", () => {
  it("enforces one deterministic budget across independently collected connectors", () => {
    const result = mergeSourceScanResults([
      {
        sources: [
          { path: "local.md", content: "1234", sourceType: "document" },
          { path: "code.ts", content: "xx", sourceType: "codebase" },
        ],
        skipped: [],
        totalBytes: 6,
        counts: { document: 1, codebase: 1, database: 0 },
      },
      {
        sources: [
          { path: "remote.json", content: "x", sourceType: "document" },
          { path: "roles-query", content: "z", sourceType: "database" },
        ],
        skipped: [],
        totalBytes: 2,
        counts: { document: 1, codebase: 0, database: 1 },
      },
    ], { maxFiles: 2, maxTotalBytes: 5 });

    expect(result.sources.map((source) => source.path)).toEqual(["local.md", "remote.json"]);
    expect(result.totalBytes).toBe(5);
    expect(result.counts).toEqual({ document: 2, codebase: 0, database: 0 });
    expect(result.skipped).toEqual([
      expect.objectContaining({ path: "(combined scan)", severity: "error", reason: expect.stringContaining("2-file limit") }),
      expect.objectContaining({ path: "(combined scan)", severity: "error", reason: expect.stringContaining("5-byte limit") }),
    ]);
  });

  it("does not implicitly scan the base folder when no local path is selected", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "deltadotta-empty-selection-"));
    await writeFile(join(workspace, "connector-config.json"), "{\"urlEnv\":\"SECRET_DATABASE_URL\"}");

    const scan = await collectKnowledgeSources({ baseDirectory: workspace, sources: [] });

    expect(scan.sources).toEqual([]);
    expect(scan.totalBytes).toBe(0);
  });

  it("excludes generated output folders and archives from repeat scans", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "deltadotta-output-exclusion-"));
    await mkdir(join(workspace, "generated-package"), { recursive: true });
    await writeFile(join(workspace, "roles.md"), "Role: Operations Lead");
    await writeFile(join(workspace, "generated-package", "ORGANIZATION.md"), "Role: Stale Generated Role");
    await writeFile(join(workspace, "generated-package.zip"), "not a real archive");

    const scan = await collectKnowledgeSources({
      baseDirectory: workspace,
      sources: ["."],
      excludedPaths: ["generated-package", "generated-package.zip"],
    });

    expect(scan.sources.map((source) => source.path)).toEqual(["roles.md"]);
    expect(scan.skipped).toEqual([]);
  });

  it("does not report a limit failure when the selected evidence exactly fits the bound", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "deltadotta-exact-bound-"));
    await writeFile(join(workspace, "role.md"), "Role: Operations Lead");

    const scan = await collectKnowledgeSources({
      baseDirectory: workspace,
      sources: ["role.md"],
      maxFiles: 1,
      maxTotalBytes: Buffer.byteLength("Role: Operations Lead"),
    });

    expect(scan.sources).toHaveLength(1);
    expect(scan.skipped.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("classifies documents, codebase files, and database schema exports with bounded skips", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "deltadotta-sources-"));
    await mkdir(join(workspace, "handbook"), { recursive: true });
    await mkdir(join(workspace, "src"), { recursive: true });
    await mkdir(join(workspace, "database"), { recursive: true });
    await mkdir(join(workspace, "node_modules", "ignored"), { recursive: true });
    await writeFile(join(workspace, "handbook", "roles.md"), "# Roles\nRole: Chief Financial Officer\nRole: Operations Manager\n");
    await writeFile(join(workspace, "src", "service.ts"), "export const owner = 'Engineering Lead';\n");
    await writeFile(join(workspace, "database", "schema.sql"), "CREATE TABLE teams (id text, owner_role text);\n");
    await writeFile(join(workspace, "node_modules", "ignored", "roles.md"), "Role: Should Never Appear\n");
    await writeFile(join(workspace, "legacy.pdf"), Buffer.from([0, 1, 2, 3]));

    const scan = await collectKnowledgeSources({
      baseDirectory: workspace,
      sources: ["handbook", "src", "legacy.pdf"],
      databases: ["database/schema.sql"],
    });

    expect(scan.counts).toEqual({ codebase: 1, document: 1, database: 1 });
    expect(scan.sources.map((source) => source.path)).toEqual([
      "handbook/roles.md",
      "src/service.ts",
      "database/schema.sql",
    ]);
    expect(scan.skipped).toContainEqual(expect.objectContaining({ path: "legacy.pdf" }));
  }, 15_000);

  it("creates a general provider package while keeping inferred authority unconfirmed", () => {
    const evidence = knowledgeEvidence([
      { path: "handbook/roles.md", sourceType: "document", content: "Role: Chief Executive Officer\nRole: Finance Lead\nRole: Customer Success Manager" },
      { path: "database/schema.sql", sourceType: "database", content: "CREATE TABLE accounts (account_owner_role text);" },
    ]);
    const organization = createOrganizationFromEvidence({
      organizationName: "Atlas Company",
      provider: "chatgpt",
      evidence,
    });
    const files = compilePackage(organization);

    expect(organization.launch?.template).toBe("general");
    expect(organization.launch?.status).toBe("package-ready");
    expect(organization.roles.map((role) => role.title)).toEqual([
      "Chief Executive Officer",
      "Finance Lead",
      "Customer Success Manager",
    ]);
    expect(organization.roles.every((role) => role.status === "draft" && role.permissions.length === 0)).toBe(true);
    expect(files["providers/chatgpt/INSTALL.md"]).toContain("ChatGPT Project");
    expect(files["providers/chatgpt/PROJECT-INSTRUCTIONS.md"]).toContain("Stay within the selected role's documented authority");
    expect(files["providers/claude/INSTALL.md"]).toContain("Claude Project");
    expect(files["providers/chatgpt/KNOWLEDGE.md"]).toContain("CREATE TABLE accounts");
  });

  it("preserves structured JSON reporting lines, ownership, and decision rights", () => {
    const content = JSON.stringify({
      roles: [
        {
          title: "Chief Executive Officer",
          department: "Leadership",
          purpose: "Set company direction.",
          responsibilities: ["Company strategy"],
          decision_rights: ["Approve the annual plan"],
        },
        {
          title: "Finance Lead",
          department: "Finance",
          reports_to: "Chief Executive Officer",
          purpose: "Keep financial decisions grounded in current operating data.",
          owns: ["Budget", "Runway"],
          inputs: ["Department forecasts"],
          outputs: ["Monthly financial review"],
          authority: ["Approve spend within the finance policy"],
          collaborators: ["Operations Lead"],
        },
      ],
    });
    const organization = createOrganizationFromEvidence({
      organizationName: "Atlas Company",
      provider: "claude",
      evidence: knowledgeEvidence([{ path: "people/roles.json", sourceType: "document", content }]),
    });
    const chiefExecutive = organization.roles.find((role) => role.title === "Chief Executive Officer");
    const finance = organization.roles.find((role) => role.title === "Finance Lead");

    expect(finance?.reportsTo).toBe(chiefExecutive?.id);
    expect(finance).toMatchObject({
      department: "Finance",
      purpose: "Keep financial decisions grounded in current operating data.",
      owns: ["Budget", "Runway"],
      inputs: ["Department forecasts"],
      outputs: ["Monthly financial review"],
      permissions: ["Approve spend within the finance policy"],
      collaborators: ["Operations Lead"],
      status: "draft",
    });
    expect(chiefExecutive?.permissions).toEqual(["Approve the annual plan"]);
  });

  it("parses quoted CSV role fields without losing embedded commas", () => {
    const content = [
      "title,department,reports_to,purpose,owns,authority",
      'Chief Executive Officer,Leadership,,Set company direction,Company strategy,"Approve strategy, budget, and hiring"',
      'Operations Lead,Operations,Chief Executive Officer,"Coordinate people, systems, and daily delivery","Daily delivery;Incident response","Stop unsafe work"',
    ].join("\n");
    const organization = createOrganizationFromEvidence({
      organizationName: "Atlas Company",
      provider: "chatgpt",
      evidence: knowledgeEvidence([{ path: "people/roles.csv", sourceType: "document", content }]),
    });
    const chiefExecutive = organization.roles.find((role) => role.title === "Chief Executive Officer");
    const operations = organization.roles.find((role) => role.title === "Operations Lead");

    expect(operations?.reportsTo).toBe(chiefExecutive?.id);
    expect(operations?.purpose).toBe("Coordinate people, systems, and daily delivery");
    expect(operations?.owns).toEqual(["Daily delivery", "Incident response"]);
    expect(operations?.permissions).toEqual(["Stop unsafe work"]);
    expect(chiefExecutive?.permissions).toEqual(["Approve strategy, budget, and hiring"]);
  });

  it("keeps full supported text content in the portable evidence package", async () => {
    const body = `Role: Legal Counsel\n${"policy line\n".repeat(2_000)}`;
    const evidence = knowledgeEvidence([{ path: "legal/policy.txt", sourceType: "document", content: body }]);
    expect(evidence[0].excerpt).toBe(body.trim());

    const workspace = await mkdtemp(join(tmpdir(), "deltadotta-package-"));
    await writeFile(join(workspace, "knowledge.json"), JSON.stringify(evidence));
    expect(JSON.parse(await readFile(join(workspace, "knowledge.json"), "utf8"))[0].excerpt).toContain("policy line");
  });

  it("extracts local text from a DOCX without OCR or network upload", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "deltadotta-docx-"));
    const document = new JSZip();
    document.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      </Types>`);
    document.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
      </Relationships>`);
    document.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body><w:p><w:r><w:t>Role: Chief People Officer</w:t></w:r></w:p></w:body>
      </w:document>`);
    await writeFile(join(workspace, "people.docx"), await document.generateAsync({ type: "nodebuffer" }));

    const scan = await collectKnowledgeSources({ baseDirectory: workspace, sources: ["people.docx"] });

    expect(scan.sources, JSON.stringify(scan.skipped)).toHaveLength(1);
    expect(scan.sources[0].content).toContain("Chief People Officer");
    expect(scan.sources[0].sourceEncoding).toBe("binary");
    expect(scan.sources[0].sourceHash).toMatch(/^sha256-[a-f0-9]{64}$/);
  });

  it("imports supported files from a bounded ZIP company export with container provenance", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "deltadotta-zip-export-"));
    const archive = new JSZip();
    archive.file("people/roles.json", JSON.stringify({
      roles: [{ title: "Chief People Officer", authority: ["Approve people policies"] }],
    }));
    archive.file("services/ownership.ts", "export const owner = 'Platform Lead';");
    archive.file("assets/logo.png", Buffer.from([0, 1, 2, 3]));
    const archiveBytes = await archive.generateAsync({ type: "nodebuffer" });
    await writeFile(join(workspace, "company-export.zip"), archiveBytes);

    const scan = await collectKnowledgeSources({ baseDirectory: workspace, sources: ["company-export.zip"] });

    expect(scan.sources.map((source) => source.path)).toEqual([
      "company-export.zip!/people/roles.json",
      "company-export.zip!/services/ownership.ts",
    ]);
    expect(scan.counts).toEqual({ document: 1, codebase: 1, database: 0 });
    expect(new Set(scan.sources.map((source) => source.sourceHash))).toEqual(new Set([evidenceHash(archiveBytes.toString("base64"))]));
    expect(scan.sources.every((source) => source.sourceEncoding === "binary")).toBe(true);
    expect(scan.skipped).toEqual([]);
  });

  it("rejects traversal paths in ZIP exports before extracting any entry", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "deltadotta-zip-traversal-"));
    const archive = new JSZip();
    archive.file("../outside.md", "Role: Unauthorized Archive Role");
    await writeFile(join(workspace, "unsafe.zip"), await archive.generateAsync({ type: "nodebuffer" }));

    const scan = await collectKnowledgeSources({ baseDirectory: workspace, sources: ["unsafe.zip"] });

    expect(scan.sources).toEqual([]);
    expect(scan.skipped).toContainEqual(expect.objectContaining({
      path: "unsafe.zip",
      severity: "error",
      reason: expect.stringContaining("unsafe archive entry path"),
    }));
  });

  it("rejects ZIP paths that collide on portable filesystems", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "deltadotta-zip-collision-"));
    const archive = new JSZip();
    archive.file("People/Roles.md", "Role: Operations Lead");
    archive.file("people/roles.md", "Role: Finance Lead");
    await writeFile(join(workspace, "colliding.zip"), await archive.generateAsync({ type: "nodebuffer" }));

    const scan = await collectKnowledgeSources({ baseDirectory: workspace, sources: ["colliding.zip"] });

    expect(scan.sources).toEqual([]);
    expect(scan.skipped).toContainEqual(expect.objectContaining({
      path: "colliding.zip",
      severity: "error",
      reason: expect.stringContaining("collides on case-insensitive"),
    }));
  });

  it("extracts text from a local PDF", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "deltadotta-pdf-"));
    await writeFile(join(workspace, "legal.pdf"), simplePdf("Role: Legal Counsel"));

    const scan = await collectKnowledgeSources({ baseDirectory: workspace, sources: ["legal.pdf"] });

    expect(scan.sources, JSON.stringify(scan.skipped)).toHaveLength(1);
    expect(scan.sources[0].content).toContain("Legal Counsel");
    expect(scan.sources[0].sourceEncoding).toBe("binary");
  });

  it("reads only schema metadata from a local SQLite database", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "deltadotta-sqlite-"));
    const databasePath = join(workspace, "operations.sqlite");
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE teams (
        id INTEGER PRIMARY KEY,
        role TEXT NOT NULL,
        private_note TEXT
      );
      INSERT INTO teams (role, private_note) VALUES ('Operations Lead', 'do not export this row');
    `);
    database.close();

    const scan = await collectKnowledgeSources({
      baseDirectory: workspace,
      sources: [],
      databases: ["operations.sqlite"],
    });

    expect(scan.sources, JSON.stringify(scan.skipped)).toHaveLength(1);
    expect(scan.sources[0].content).toContain("CREATE TABLE teams");
    expect(scan.sources[0].content).not.toContain("do not export this row");
    expect(scan.sources[0].sourceEncoding).toBe("sqlite-schema");
  });

  it("truncates multibyte extracted text at a real UTF-8 byte boundary", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "deltadotta-utf8-bound-"));
    const databasePath = join(workspace, "unicode.sqlite");
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec(`CREATE TABLE "${"é".repeat(40)}" (id INTEGER);`);
    database.close();

    const scan = await collectKnowledgeSources({
      baseDirectory: workspace,
      sources: [],
      databases: ["unicode.sqlite"],
      maxBytesPerFile: 47,
      maxTotalBytes: 47,
    });

    expect(scan.sources).toHaveLength(1);
    expect(Buffer.byteLength(scan.sources[0].content)).toBeLessThanOrEqual(47);
    expect(scan.sources[0].content).not.toContain("�");
    expect(scan.skipped).toContainEqual(expect.objectContaining({
      path: "unicode.sqlite",
      reason: expect.stringContaining("truncated"),
    }));
  });
});
