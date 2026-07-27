import { describe, expect, it } from "vitest";
import {
  collectDatabaseKnowledge,
  databaseKnowledgeInvocation,
  parseDatabaseKnowledgeManifest,
  validateReadOnlyQuery,
} from "../lib/database-knowledge";

describe("read-only database knowledge queries", () => {
  it("accepts a single SELECT/CTE and rejects writes, multiple statements, comments, locks, and side-effect functions", () => {
    expect(validateReadOnlyQuery("SELECT title, department FROM role_directory LIMIT 100;"))
      .toBe("SELECT title, department FROM role_directory LIMIT 100");
    expect(validateReadOnlyQuery("WITH active AS (SELECT * FROM teams) SELECT * FROM active"))
      .toContain("WITH active");
    expect(validateReadOnlyQuery("SELECT 'delete is only text' AS note"))
      .toContain("delete is only text");

    expect(() => validateReadOnlyQuery("DELETE FROM role_directory")).toThrow("must start with SELECT or WITH");
    expect(() => validateReadOnlyQuery("SELECT * FROM teams; DROP TABLE teams")).toThrow("exactly one statement");
    expect(() => validateReadOnlyQuery("SELECT * FROM teams -- all teams")).toThrow("cannot contain SQL comments");
    expect(() => validateReadOnlyQuery("SELECT * FROM teams FOR UPDATE")).toThrow("forbidden operation");
    expect(() => validateReadOnlyQuery("SELECT * INTO copied_teams FROM teams")).toThrow("forbidden operation");
    expect(() => validateReadOnlyQuery("SELECT set_config('statement_timeout', '0', false)")).toThrow("forbidden function");
    expect(() => validateReadOnlyQuery("SELECT pg_read_file('/etc/passwd')")).toThrow("forbidden function");
    expect(() => validateReadOnlyQuery("SELECT pg_sleep(30)")).toThrow("forbidden function");
    expect(() => validateReadOnlyQuery("SELECT pg_try_advisory_lock(42)")).toThrow("forbidden function");
    expect(() => validateReadOnlyQuery("SELECT pg_advisory_lock(42)")).toThrow("forbidden function");
  });

  it("requires short, unambiguous connection and query names", () => {
    expect(() => parseDatabaseKnowledgeManifest({
      schemaVersion: "1.0",
      connections: [
        { name: "people/system", urlEnv: "FIRST_URL", queries: [{ name: "roles", sql: "SELECT 1" }] },
      ],
    })).toThrow("cannot contain control characters or path separators");
    expect(() => parseDatabaseKnowledgeManifest({
      schemaVersion: "1.0",
      connections: [
        { name: "People", urlEnv: "FIRST_URL", queries: [{ name: "roles", sql: "SELECT 1" }] },
        { name: "people", urlEnv: "SECOND_URL", queries: [{ name: "teams", sql: "SELECT 1" }] },
      ],
    })).toThrow("duplicate connection name");
  });

  it("constructs password-free PostgreSQL and MySQL child arguments with read-only guards", () => {
    const postgres = databaseKnowledgeInvocation(
      "postgresql://reader:secret@db.example.com/company",
      "roles",
      "SELECT title FROM role_directory",
      { environment: { NODE_ENV: "test" }, maxRows: 25, timeoutMs: 4_000 },
    );
    expect(postgres.command).toBe("psql");
    expect(postgres.args.join(" ")).not.toContain("secret");
    expect(postgres.args.join(" ")).toContain("LIMIT 26");
    expect(postgres.env.PGPASSWORD).toBe("secret");
    expect(postgres.env.PGOPTIONS).toContain("default_transaction_read_only=on");
    expect(postgres.env.PGOPTIONS).toContain("statement_timeout=4000");

    const mysql = databaseKnowledgeInvocation(
      "mysql://reader:secret@db.example.com/company",
      "roles",
      "SELECT title FROM role_directory",
      { environment: { NODE_ENV: "test" }, maxRows: 25, timeoutMs: 4_000 },
    );
    expect(mysql.command).toBe("mysql");
    expect(mysql.args.join(" ")).not.toContain("secret");
    expect(mysql.args.join(" ")).toContain("START TRANSACTION READ ONLY");
    expect(mysql.args.join(" ")).toContain("MAX_EXECUTION_TIME=4000");
    expect(mysql.env.MYSQL_PWD).toBe("secret");
  });

  it("bounds PostgreSQL query rows and records credential-free provenance", async () => {
    const manifest = {
      schemaVersion: "1.0",
      connections: [{
        name: "people-system",
        urlEnv: "COMPANY_DB_URL",
        queries: [{
          name: "role-directory",
          sql: "SELECT title, department, reports_to, authority FROM role_directory",
        }],
      }],
    };
    const result = await collectDatabaseKnowledge(manifest, {
      environment: {
        NODE_ENV: "test",
        COMPANY_DB_URL: "postgresql://reader:database-password@db.example.com/company",
      },
      maxRows: 2,
      runner: async (command, args) => {
        expect(command).toBe("psql");
        expect(args.join(" ")).not.toContain("database-password");
        return {
          stdout: `${JSON.stringify([
            { title: "Chief Executive Officer", department: "Leadership", authority: "Approve strategy" },
            { title: "Operations Lead", department: "Operations", authority: "Stop unsafe work" },
            { title: "Finance Lead", department: "Finance", authority: "Approve budget" },
          ])}\n`,
          stderr: "",
        };
      },
    });

    expect(result.sources).toHaveLength(1);
    expect(JSON.parse(result.sources[0].content)).toHaveLength(2);
    expect(result.sources[0]).toMatchObject({
      sourceConnector: "postgresql",
      sourceType: "database",
      sourceLocator: "postgresql://db.example.com/company#query=role-directory",
    });
    expect(result.skipped).toContainEqual({
      path: "people-system/role-directory",
      reason: "query result truncated at 2 rows",
    });
    expect(JSON.stringify(result)).not.toContain("database-password");
  });

  it("bounds MySQL tabular output while preserving headers for structured role extraction", async () => {
    const result = await collectDatabaseKnowledge({
      schemaVersion: "1.0",
      connections: [{
        name: "people-system",
        urlEnv: "COMPANY_DB_URL",
        queries: [{ name: "roles", sql: "SELECT title, department FROM role_directory" }],
      }],
    }, {
      environment: {
        NODE_ENV: "test",
        COMPANY_DB_URL: "mysql://reader:secret@db.example.com/company",
      },
      maxRows: 2,
      runner: async () => ({
        stdout: "title\tdepartment\nChief Executive Officer\tLeadership\nOperations Lead\tOperations\nFinance Lead\tFinance\n",
        stderr: "",
      }),
    });

    expect(result.sources[0].content).toBe("title\tdepartment\nChief Executive Officer\tLeadership\nOperations Lead\tOperations");
    expect(result.skipped[0].reason).toBe("query result truncated at 2 rows");
  });

  it("enforces one aggregate byte budget across all selected queries", async () => {
    let calls = 0;
    const result = await collectDatabaseKnowledge({
      schemaVersion: "1.0",
      connections: [{
        name: "people-system",
        urlEnv: "COMPANY_DB_URL",
        queries: [
          { name: "first", sql: "SELECT title FROM first_roles" },
          { name: "second", sql: "SELECT title FROM second_roles" },
          { name: "third", sql: "SELECT title FROM third_roles" },
        ],
      }],
    }, {
      environment: { NODE_ENV: "test", COMPANY_DB_URL: "postgresql://reader:secret@db.example.com/company" },
      maxTotalBytes: 70,
      runner: async () => {
        calls += 1;
        return { stdout: `${JSON.stringify([{ title: `Role ${calls}` }])}\n`, stderr: "" };
      },
    });

    expect(result.sources).toHaveLength(2);
    expect(calls).toBe(3);
    expect(result.totalBytes).toBeLessThanOrEqual(70);
    expect(result.skipped).toContainEqual({
      path: "people-system/third",
      reason: "query output would exceed the aggregate 70-byte database knowledge limit",
      severity: "error",
    });
  });

  it("redacts connection credentials from query failures", async () => {
    const result = await collectDatabaseKnowledge({
      schemaVersion: "1.0",
      connections: [{
        name: "people-system",
        urlEnv: "COMPANY_DB_URL",
        queries: [{ name: "roles", sql: "SELECT title FROM role_directory" }],
      }],
    }, {
      environment: { NODE_ENV: "test", COMPANY_DB_URL: "postgresql://reader:highly-sensitive@db.example.com/company" },
      runner: async () => {
        throw new Error("connection failed for highly-sensitive");
      },
    });

    expect(result.skipped[0].reason).toBe("read-only query failed: connection failed for [redacted]");
    expect(JSON.stringify(result)).not.toContain("highly-sensitive");
  });
});
