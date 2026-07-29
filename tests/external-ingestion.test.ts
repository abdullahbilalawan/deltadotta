import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectExternalSources,
  databaseDumpInvocation,
  sanitizeExternalLocator,
} from "../lib/external-ingestion";
import { writeNodeCommand } from "./helpers/write-node-command";

const execFileAsync = promisify(execFile);
const environmentKeys: string[] = [];
const originalPath = process.env.PATH;

afterEach(() => {
  environmentKeys.splice(0).forEach((key) => { delete process.env[key]; });
  process.env.PATH = originalPath;
});

describe("external knowledge connectors", () => {
  it("imports a bounded ZIP export over HTTPS-style transport while retaining entry provenance", async () => {
    const archive = new JSZip();
    archive.file("departments/roles.json", JSON.stringify({
      roles: [{ title: "Customer Operations Lead" }],
    }));
    const payload = await archive.generateAsync({ type: "nodebuffer" });
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "application/zip",
        "content-length": String(payload.length),
      });
      response.end(payload);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not expose a port");
      const sourceUrl = `http://127.0.0.1:${address.port}/company-export`;
      const result = await collectExternalSources({
        baseDirectory: ".",
        urls: [sourceUrl],
      });

      expect(result.skipped).toEqual([]);
      expect(result.sources).toEqual([
        expect.objectContaining({
          path: `${sourceUrl}!/departments/roles.json`,
          sourceConnector: "https",
          sourceLocator: sourceUrl,
          content: expect.stringContaining("Customer Operations Lead"),
        }),
      ]);
    } finally {
      await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    }
  });

  it("fetches an authenticated bounded document without retaining its token", async () => {
    const environmentKey = `DELTADOTTA_TEST_TOKEN_${Date.now()}`;
    environmentKeys.push(environmentKey);
    process.env[environmentKey] = "private-test-token";
    const payload = JSON.stringify({
      roles: [{ title: "Chief Executive Officer" }, { title: "Operations Lead" }],
    });
    const server = createServer((request, response) => {
      if (request.headers.authorization !== "Bearer private-test-token") {
        response.writeHead(401).end("unauthorized");
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(payload)),
      });
      response.end(payload);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not expose a port");
      const url = `http://127.0.0.1:${address.port}/organization.json?signature=secret`;
      const result = await collectExternalSources({
        baseDirectory: ".",
        urls: [url],
        httpTokenEnv: environmentKey,
      });

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toMatchObject({
        sourceConnector: "https",
        sourceType: "document",
        sourceLocator: `http://127.0.0.1:${address.port}/organization.json`,
      });
      expect(JSON.stringify(result)).not.toContain("private-test-token");
      expect(JSON.stringify(result)).not.toContain("signature=secret");
      expect(result.sources[0].content).toContain("Operations Lead");
    } finally {
      await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    }
  });

  it("fetches independent HTTP exports concurrently while preserving input order", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const server = createServer((request, response) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      const path = request.url ?? "/unknown.txt";
      const delay = path.includes("first") ? 60 : path.includes("second") ? 30 : 5;
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end(`Role: ${path.includes("first") ? "Finance Lead" : path.includes("second") ? "Operations Lead" : "Engineering Lead"}`);
        activeRequests -= 1;
      }, delay);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("concurrency server did not expose a port");
      const urls = ["first.txt", "second.txt", "third.txt"]
        .map((name) => `http://127.0.0.1:${address.port}/${name}`);
      const result = await collectExternalSources({ baseDirectory: ".", urls });

      expect(maxActiveRequests).toBeGreaterThanOrEqual(2);
      expect(result.sources.map((source) => source.sourceLocator)).toEqual(urls);
      expect(result.sources.map((source) => source.content)).toEqual([
        "Role: Finance Lead",
        "Role: Operations Lead",
        "Role: Engineering Lead",
      ]);
    } finally {
      await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    }
  });

  it("rejects excessive connector fan-out before any network request", async () => {
    await expect(collectExternalSources({
      baseDirectory: ".",
      urls: Array.from({ length: 51 }, (_, index) => `https://example.invalid/export-${index}.json`),
    })).rejects.toThrow("at most 50 connector inputs");
  });

  it("creates a shallow revision-pinned snapshot of a Git repository", async () => {
    const repository = await mkdtemp(join(tmpdir(), "deltadotta-external-git-"));
    await execFileAsync("git", ["init", "-q", repository]);
    await execFileAsync("git", ["-C", repository, "config", "user.email", "test@example.com"]);
    await execFileAsync("git", ["-C", repository, "config", "user.name", "DeltaDotta Test"]);
    await writeFile(join(repository, "roles.md"), "Role: Chief Technology Officer\nRole: Engineering Lead\n");
    await execFileAsync("git", ["-C", repository, "add", "roles.md"]);
    await execFileAsync("git", ["-C", repository, "commit", "-qm", "Add roles"]);
    const revision = (await execFileAsync("git", ["-C", repository, "rev-parse", "HEAD"])).stdout.trim();

    const result = await collectExternalSources({
      baseDirectory: ".",
      gitRepositories: [repository],
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      sourceConnector: "git",
      sourceRevision: revision,
      sourceType: "document",
    });
    expect(
      process.platform === "win32"
        ? result.sources[0].sourceLocator?.toLowerCase()
        : result.sources[0].sourceLocator,
    ).toBe(process.platform === "win32" ? repository.toLowerCase() : repository);
    expect(result.sources[0].path).toContain(revision.slice(0, 12));
    expect(result.sources[0].content).toContain("Engineering Lead");
  });

  it("drops authorization when an allowed redirect crosses origins", async () => {
    const environmentKey = `DELTADOTTA_REDIRECT_TOKEN_${Date.now()}`;
    environmentKeys.push(environmentKey);
    process.env[environmentKey] = "redirect-secret";
    let redirectedAuthorization: string | undefined;
    const destination = createServer((request, response) => {
      redirectedAuthorization = request.headers.authorization;
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("Role: Security Engineer");
    });
    await new Promise<void>((done) => destination.listen(0, "127.0.0.1", done));
    const destinationAddress = destination.address();
    if (!destinationAddress || typeof destinationAddress === "string") throw new Error("destination server did not expose a port");
    const source = createServer((_request, response) => {
      response.writeHead(302, { location: `http://127.0.0.1:${destinationAddress.port}/roles.txt` });
      response.end();
    });
    await new Promise<void>((done) => source.listen(0, "127.0.0.1", done));
    try {
      const sourceAddress = source.address();
      if (!sourceAddress || typeof sourceAddress === "string") throw new Error("source server did not expose a port");
      const result = await collectExternalSources({
        baseDirectory: ".",
        urls: [`http://127.0.0.1:${sourceAddress.port}/redirect`],
        httpTokenEnv: environmentKey,
      });

      expect(result.sources).toHaveLength(1);
      expect(redirectedAuthorization).toBeUndefined();
    } finally {
      await Promise.all([
        new Promise<void>((done, reject) => source.close((error) => error ? reject(error) : done())),
        new Promise<void>((done, reject) => destination.close((error) => error ? reject(error) : done())),
      ]);
    }
  });

  it("keeps database passwords out of schema-only command arguments", () => {
    const postgres = databaseDumpInvocation("postgresql://analyst:p%40ss@db.example.com:5433/company?sslmode=require", { NODE_ENV: "test" });
    expect(postgres.command).toBe("pg_dump");
    expect(postgres.args).toContain("--schema-only");
    expect(postgres.args.join(" ")).not.toContain("p%40ss");
    expect(postgres.args.join(" ")).not.toContain("p@ss");
    expect(postgres.env.PGPASSWORD).toBe("p@ss");
    expect(postgres.locator).toBe("postgresql://db.example.com:5433/company");

    const mysql = databaseDumpInvocation("mysql://reader:secret@mysql.example.com:3307/operations", { NODE_ENV: "test" });
    expect(mysql.command).toBe("mysqldump");
    expect(mysql.args).toContain("--no-data");
    expect(mysql.args.join(" ")).not.toContain("secret");
    expect(mysql.env.MYSQL_PWD).toBe("secret");
    expect(mysql.locator).toBe("mysql://mysql.example.com:3307/operations");
    expect(() => databaseDumpInvocation("postgresql://reader@db.example.com/company?password=secret", { NODE_ENV: "test" }))
      .toThrow("credentials in URL query parameters are not accepted");
  });

  it("captures only schema output from the PostgreSQL connector command", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "deltadotta-pgdump-test-"));
    const bin = join(workspace, "bin");
    await mkdir(bin);
    await writeNodeCommand(bin, "pg_dump", `
if (process.argv.join(" ").includes("database-password")) process.exit(9);
process.stdout.write("CREATE TABLE departments (id bigint, owner_role text);\\n");
`);
    process.env.PATH = `${bin}${delimiter}${originalPath ?? ""}`;

    const result = await collectExternalSources({
      baseDirectory: ".",
      databaseUrls: ["postgresql://reader:database-password@db.example.com/company"],
    });

    expect(result.skipped).toEqual([]);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      sourceConnector: "postgresql",
      sourceType: "database",
      sourceLocator: "postgresql://db.example.com/company",
      content: "CREATE TABLE departments (id bigint, owner_role text);",
    });
    expect(JSON.stringify(result)).not.toContain("database-password");
  });

  it("removes URL credentials, query tokens, and fragments from provenance", () => {
    expect(sanitizeExternalLocator("https://user:secret@example.com/handbook.pdf?token=abc#page=2"))
      .toBe("https://example.com/handbook.pdf");
  });

  it("rejects credentials embedded in HTTPS Git URLs", async () => {
    const result = await collectExternalSources({
      baseDirectory: ".",
      gitRepositories: ["https://token:secret@example.com/private/repository.git"],
    });

    expect(result.sources).toEqual([]);
    expect(result.skipped[0].reason).toContain("use a Git credential manager");
    expect(JSON.stringify(result)).not.toContain("token:secret");
  });
});
