import { describe, expect, it } from "vitest";
import { renderOrganizationMap } from "../lib/cli-viewer";
import { applyFirstShiftReport, compilePackage, createEngineeringLaunchpad, createOrganization, createOrganizationFromEvidence, createTeamLaunchpad, evidenceHash, extractRoleSignals, knowledgeEvidence, lintOrganization, markPlatformInstalled, mergeOrganization, organizationFromInterview, organizationStructureLimits, parseImportedPackage, repositoryEvidence, starterOrganization, verifyPlatformFirstShift } from "../lib/organization";
import { applyOrganizationReview, createOrganizationReviewTemplate } from "../lib/organization-review";
import { evaluateOrganizationReadiness } from "../lib/readiness";

describe("DeltaDotta organization compiler", () => {
  it("fails closed on malformed or structurally oversized imported organization graphs", () => {
    const graph = JSON.parse(compilePackage(starterOrganization)["graph.json"]);
    const malformedRole = structuredClone(graph);
    malformedRole.organization.roles.push(null);
    expect(() => parseImportedPackage(malformedRole))
      .toThrow("is not a usable role");

    const malformedEvidence = structuredClone(graph);
    malformedEvidence.organization.evidence.push(null);
    expect(() => parseImportedPackage(malformedEvidence))
      .toThrow("must be an object");

    const duplicateRoleId = structuredClone(graph);
    duplicateRoleId.organization.roles[1].id = duplicateRoleId.organization.roles[0].id;
    expect(() => parseImportedPackage(duplicateRoleId))
      .toThrow("organization.roles contains duplicate id");

    const oversized = structuredClone(graph);
    oversized.organization.roles = Array.from(
      { length: organizationStructureLimits.roles + 1 },
      () => graph.organization.roles[0],
    );
    expect(() => parseImportedPackage(oversized))
      .toThrow(`supported maximum is ${organizationStructureLimits.roles}`);

    const oversizedNestedField = structuredClone(graph);
    oversizedNestedField.organization.roles[0].permissions = Array.from(
      { length: organizationStructureLimits.itemsPerRoleField + 1 },
      () => "May approve a bounded decision",
    );
    expect(() => parseImportedPackage(oversizedNestedField))
      .toThrow(`supported maximum is ${organizationStructureLimits.itemsPerRoleField}`);
  });

  it("uses standard SHA-256 evidence fingerprints and preserves legacy imported hashes", () => {
    expect(evidenceHash("")).toBe("sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(evidenceHash("abc")).toBe("sha256-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

    const legacyGraph = JSON.parse(compilePackage(starterOrganization)["graph.json"]);
    legacyGraph.organization.evidence[0].sourceHash = "fnv1a-12345678";

    expect(parseImportedPackage(legacyGraph).organization.evidence[0].sourceHash).toBe("fnv1a-12345678");
  });

  it("exports a complete portable package for the starter organization", () => {
    const packageFiles = compilePackage(starterOrganization);

    expect(packageFiles["manifest.yaml"]).toContain("schema_version: \"1.0\"");
    expect(packageFiles["ORGANIZATION.md"]).toContain("Northstar Studio");
    expect(packageFiles["GAPS.md"]).toContain("Confidence and gaps report");
    expect(packageFiles["GAPS.md"]).toContain("provider-side permissions");
    expect(packageFiles["roles/product-lead/SKILL.md"]).toContain("## Authority");
    expect(packageFiles["roles/product-lead/SKILL.md"]).toContain("name: product-lead");
    expect(packageFiles["roles/product-lead/SKILL.md"]).toContain("description:");
    expect(packageFiles["policies/escalations.md"]).toContain("Product Lead");
    expect(packageFiles["PROVIDER-IMPORT.md"]).toContain("providers/chatgpt/");
    expect(packageFiles["validation/source-ingestion.json"]).toContain("\"schemaVersion\": \"1.0\"");
    expect(packageFiles["validation/source-ingestion.md"]).toContain("Source ingestion report");
    expect(packageFiles["manifest.yaml"]).toContain("ingestion_status:");
    expect(packageFiles["providers/chatgpt/INSTALL.md"]).toContain("ChatGPT Project");
    expect(packageFiles["providers/claude/INSTALL.md"]).toContain("Claude Project");
    expect(packageFiles["providers/chatgpt/UPLOAD-MANIFEST.md"]).toContain("Keep local; do not upload");
    expect(packageFiles["providers/chatgpt/UPLOAD-MANIFEST.md"]).toContain("validation/source-plans.json");
    expect(packageFiles["providers/claude/UPLOAD-MANIFEST.md"]).toContain("providers/claude/KNOWLEDGE.md");
    expect(packageFiles["PROVIDER-IMPORT.md"]).toContain("Do not upload the full portable ZIP");
  });

  it("shards large provider knowledge without omissions and blocks missing, modified, or over-capacity manifests", () => {
    const organization = structuredClone(starterOrganization);
    organization.evidence[0].excerpt = "Bounded organization knowledge. ".repeat(125_000);
    const packageFiles = compilePackage(organization);
    const chatgptPaths = Object.keys(packageFiles)
      .filter((path) => /^providers\/chatgpt\/KNOWLEDGE(?:-\d{3})?\.md$/.test(path))
      .sort();
    const providerManifest = JSON.parse(packageFiles["validation/provider-knowledge.json"]);

    expect(chatgptPaths.length).toBeGreaterThan(1);
    expect(chatgptPaths).toEqual(providerManifest.providers.chatgpt.files.map((file: { path: string }) => file.path).sort());
    expect(providerManifest.providers.chatgpt.handoffFiles.map((file: { path: string }) => file.path)).toEqual(expect.arrayContaining([
      "providers/chatgpt/PROJECT-INSTRUCTIONS.md",
      "providers/chatgpt/GPT-INSTRUCTIONS.md",
      "providers/chatgpt/UPLOAD-MANIFEST.md",
      "ORGANIZATION.md",
      "GAPS.md",
      "validation/provider-evaluation-cases.json",
      "validation/provider-evaluation-cases.md",
    ]));
    expect(chatgptPaths.every((path) => new TextEncoder().encode(packageFiles[path]).length <= 1_800_000)).toBe(true);
    expect(packageFiles["providers/chatgpt/UPLOAD-MANIFEST.md"]).toContain("providers/chatgpt/KNOWLEDGE-002.md");
    for (const evidence of organization.evidence) {
      expect(chatgptPaths.map((path) => packageFiles[path]).join("\n")).toContain(`- Evidence id: ${evidence.id}`);
    }

    expect(evaluateOrganizationReadiness(organization, packageFiles).checks).toContainEqual(expect.objectContaining({
      id: "provider-knowledge-integrity",
      status: "pass",
    }));
    expect(evaluateOrganizationReadiness(organization, packageFiles).checks).toContainEqual(expect.objectContaining({
      id: "provider-handoff-integrity",
      status: "pass",
    }));

    const missingPart = { ...packageFiles };
    delete missingPart[chatgptPaths.at(-1)!];
    expect(evaluateOrganizationReadiness(organization, missingPart).checks).toContainEqual(expect.objectContaining({
      id: "provider-knowledge-integrity",
      status: "blocker",
    }));

    const modifiedPart = { ...packageFiles, [chatgptPaths[0]]: `${packageFiles[chatgptPaths[0]]}\ntampered` };
    expect(evaluateOrganizationReadiness(organization, modifiedPart).checks).toContainEqual(expect.objectContaining({
      id: "provider-knowledge-integrity",
      status: "blocker",
    }));

    const relaxedLimit = { ...packageFiles };
    const relaxedLimitManifest = structuredClone(providerManifest);
    relaxedLimitManifest.providers.chatgpt.maxBytesPerKnowledgeFile = 100_000_000;
    relaxedLimit["validation/provider-knowledge.json"] = JSON.stringify(relaxedLimitManifest);
    expect(evaluateOrganizationReadiness(organization, relaxedLimit).checks).toContainEqual(expect.objectContaining({
      id: "provider-knowledge-integrity",
      status: "blocker",
    }));

    const overCapacity = { ...packageFiles };
    const overCapacityManifest = structuredClone(providerManifest);
    overCapacityManifest.providers.chatgpt.projectFileCount = 41;
    overCapacityManifest.providers.chatgpt.capacity = "exceeds-current-limits";
    overCapacity["validation/provider-knowledge.json"] = JSON.stringify(overCapacityManifest);
    expect(evaluateOrganizationReadiness(organization, overCapacity).checks).toContainEqual(expect.objectContaining({
      id: "provider-knowledge-capacity",
      status: "blocker",
    }));
  });

  it("flags a role with no purpose, ownership, authority, or evidence", () => {
    const invalid = structuredClone(starterOrganization);
    invalid.roles[0] = {
      ...invalid.roles[0],
      purpose: "",
      owns: [],
      permissions: [],
      evidenceIds: [],
    };

    const titles = lintOrganization(invalid).map((issue) => issue.title);
    expect(titles).toContain("Chief Executive Officer has no purpose");
    expect(titles).toContain("Chief Executive Officer owns nothing");
    expect(titles).toContain("Chief Executive Officer has no authority boundary");
    expect(titles).toContain("Chief Executive Officer needs evidence");
  });

  it("parses an exported graph and merges package roles without duplicate titles", () => {
    const imported = parseImportedPackage(JSON.parse(compilePackage(starterOrganization)["graph.json"]));
    const target = createOrganization("New organization", "Make handoffs clear.");
    const merged = mergeOrganization(target, imported.organization);

    expect(merged.roles.some((role) => role.title === "Product Lead")).toBe(true);
    expect(merged.roles.filter((role) => role.title === "Chief Executive Officer")).toHaveLength(1);
    expect(merged.evidence.some((evidence) => evidence.kind === "package")).toBe(true);
  });

  it("preserves source-conflict provenance when a package is imported and merged", () => {
    const conflicted = structuredClone(starterOrganization);
    conflicted.sourceConflicts = [{
      id: "source-conflict-product-lead-department",
      roleTitle: "Product Lead",
      field: "department",
      claims: [
        { value: "Product", evidenceIds: ["ev-brief"] },
        { value: "Growth", evidenceIds: ["ev-goal"] },
      ],
    }];
    conflicted.ingestion = {
      schemaVersion: "1.0",
      status: "complete-with-warnings",
      recordedAt: "2026-07-26T23:00:00Z",
      sourceCount: 2,
      totalBytes: 120,
      durationMs: 42,
      counts: { document: 2, codebase: 0, database: 0 },
      warnings: [{
        id: "source-warning-handbook-truncated",
        path: "handbook.pdf",
        reason: "extracted text truncated at the 128000-byte per-file limit",
      }],
    };
    const imported = parseImportedPackage(JSON.parse(compilePackage(conflicted)["graph.json"]));
    const merged = mergeOrganization(createOrganization("New organization", "Make handoffs clear."), imported.organization);

    expect(imported.organization.sourceConflicts).toEqual(conflicted.sourceConflicts);
    expect(imported.organization.ingestion).toEqual(conflicted.ingestion);
    expect(merged.sourceConflicts).toHaveLength(1);
    expect(merged.ingestion).toEqual(conflicted.ingestion);
    expect(merged.sourceConflicts?.[0].claims.flatMap((claim) => claim.evidenceIds))
      .toEqual(expect.arrayContaining(merged.evidence.filter((item) => item.kind === "package").map((item) => item.id)));
  });

  it("detects newly introduced package conflicts and invalidates stale organization review", () => {
    const current = createOrganization("Combined Company", "Operate one accountable organization.");
    current.evidence = [{
      id: "team-a-source",
      name: "Team A roles.json",
      kind: "document",
      excerpt: "Operations Lead is in Operations, reports to the CEO, and may approve refunds.",
      importedAt: "2026-07-26T18:00:00Z",
      sourcePath: "team-a/roles.json",
      sourceHash: "fnv1a-aaaaaaaa",
      sourceType: "document",
      sourceEncoding: "text",
      sourceConnector: "local",
    }];
    current.roles[0] = {
      ...current.roles[0],
      evidenceIds: ["team-a-source"],
      status: "ready",
      review: {
        reviewedBy: "Team A owner",
        reviewedAt: "2026-07-26T18:10:00Z",
        sourceHash: "review-team-a",
      },
    };
    current.roles.push({
      id: "operations-lead",
      title: "Operations Lead",
      department: "Operations",
      reportsTo: "ceo",
      purpose: "Own reliable customer operations.",
      owns: ["Customer operations"],
      inputs: ["Customer requests"],
      outputs: ["Resolved requests"],
      permissions: ["Approve refunds"],
      collaborators: ["Chief Executive Officer"],
      escalatesTo: "ceo",
      evidenceIds: ["team-a-source"],
      status: "ready",
      review: {
        reviewedBy: "Team A owner",
        reviewedAt: "2026-07-26T18:10:00Z",
        sourceHash: "review-team-a",
      },
    });
    current.review = {
      reviewedBy: "Team A owner",
      reviewedAt: "2026-07-26T18:10:00Z",
      sourceHash: "review-team-a",
    };

    const incoming = createOrganization("Combined Company", "Operate one accountable organization.");
    incoming.evidence = [{
      id: "team-b-source",
      name: "Team B roles.json",
      kind: "document",
      excerpt: "Operations Lead is in Customer Operations, reports to the COO, and cannot approve refunds.",
      importedAt: "2026-07-26T19:00:00Z",
      sourcePath: "team-b/roles.json",
      sourceHash: "fnv1a-bbbbbbbb",
      sourceType: "document",
      sourceEncoding: "text",
      sourceConnector: "local",
    }];
    incoming.roles[0] = {
      ...incoming.roles[0],
      title: "CEO",
      evidenceIds: ["team-b-source"],
      status: "ready",
      review: {
        reviewedBy: "Team B owner",
        reviewedAt: "2026-07-26T19:10:00Z",
        sourceHash: "review-team-b",
      },
    };
    incoming.roles.push(
      {
        id: "coo",
        title: "Chief Operating Officer",
        department: "Leadership",
        reportsTo: "ceo",
        purpose: "Own company operations.",
        owns: ["Operating system"],
        inputs: ["Company priorities"],
        outputs: ["Operating plan"],
        permissions: ["Approve operating policy"],
        collaborators: ["CEO", "Operations Lead"],
        escalatesTo: "ceo",
        evidenceIds: ["team-b-source"],
        status: "ready",
        review: {
          reviewedBy: "Team B owner",
          reviewedAt: "2026-07-26T19:10:00Z",
          sourceHash: "review-team-b",
        },
      },
      {
        id: "operations-lead",
        title: "Operations Lead",
        department: "Customer Operations",
        reportsTo: "coo",
        purpose: "Own reliable customer operations.",
        owns: ["Customer operations"],
        inputs: ["Customer requests"],
        outputs: ["Resolved requests"],
        permissions: ["Cannot approve refunds"],
        collaborators: ["Chief Operating Officer"],
        escalatesTo: "coo",
        evidenceIds: ["team-b-source"],
        status: "ready",
        review: {
          reviewedBy: "Team B owner",
          reviewedAt: "2026-07-26T19:10:00Z",
          sourceHash: "review-team-b",
        },
      },
    );
    incoming.review = {
      reviewedBy: "Team B owner",
      reviewedAt: "2026-07-26T19:10:00Z",
      sourceHash: "review-team-b",
    };

    const merged = mergeOrganization(current, incoming);
    const importedEvidenceId = merged.evidence.find((item) => item.name === "Team B roles.json")?.id;
    const conflictsByField = new Map(merged.sourceConflicts?.map((conflict) => [conflict.field, conflict]));

    expect(merged.roles.filter((role) => /^(?:CEO|Chief Executive Officer)$/i.test(role.title))).toHaveLength(1);
    expect(merged.sourceConflicts?.map((conflict) => conflict.field)).toEqual(["department", "reportsTo", "authority"]);
    expect(conflictsByField.get("department")?.claims).toEqual(expect.arrayContaining([
      { value: "Operations", evidenceIds: ["team-a-source"] },
      { value: "Customer Operations", evidenceIds: [importedEvidenceId] },
    ]));
    expect(conflictsByField.get("reportsTo")?.claims.map((claim) => claim.value))
      .toEqual(expect.arrayContaining(["Chief Executive Officer", "Chief Operating Officer"]));
    expect(conflictsByField.get("authority")?.claims.map((claim) => claim.value))
      .toEqual(expect.arrayContaining(["Approve refunds", "Cannot approve refunds"]));
    expect(merged.review).toBeUndefined();
    expect(merged.roles.every((role) => role.status === "draft" && !role.review)).toBe(true);
    expect(merged.sourceConflicts?.every((conflict) => !conflict.resolution)).toBe(true);

    const readiness = evaluateOrganizationReadiness(merged, compilePackage(merged));
    expect(readiness.checks).toContainEqual(expect.objectContaining({
      id: "source-conflicts",
      status: "blocker",
      detail: expect.stringContaining("3 conflicting"),
    }));
    expect(readiness.checks).toContainEqual(expect.objectContaining({
      id: "human-review",
      status: "blocker",
    }));

    const review = createOrganizationReviewTemplate(merged);
    review.reviewedBy = "Morgan Chen, COO";
    review.reviewedAt = "2026-07-26T20:00:00Z";
    review.organization.roles.forEach((role) => { role.confirmed = true; });
    const reviewedOperations = review.organization.roles.find((role) => role.title === "Operations Lead")!;
    reviewedOperations.department = "Operations";
    reviewedOperations.reportsTo = "Chief Executive Officer";
    reviewedOperations.escalatesTo = "Chief Executive Officer";
    reviewedOperations.permissions = ["Cannot approve refunds"];
    review.organization.sourceConflicts.forEach((conflict) => {
      conflict.resolved = true;
      conflict.resolution = conflict.field === "department"
        ? reviewedOperations.department
        : conflict.field === "reportsTo"
          ? reviewedOperations.reportsTo!
          : reviewedOperations.permissions[0];
    });
    const reviewHash = evidenceHash(JSON.stringify(review));
    const reviewed = applyOrganizationReview(merged, review, { sourceHash: reviewHash });
    const reviewedReadiness = evaluateOrganizationReadiness(reviewed, compilePackage(reviewed));

    expect(reviewedReadiness.status).toBe("ready");
    expect(reviewed.sourceConflicts?.every((conflict) => conflict.resolution?.sourceHash === reviewed.review?.sourceHash)).toBe(true);
  });

  it("extracts reviewable role candidates from job-description text", () => {
    const roles = extractRoleSignals("Job Title: DevOps Engineer\nThe DevOps Engineer owns deployment and incident response.\nProduct Manager partners with engineering.");

    expect(roles.map((role) => role.title)).toContain("DevOps Engineer");
    expect(roles.map((role) => role.title)).toContain("Product Manager");
    expect(roles[0].excerpt).toContain("DevOps Engineer");
  });

  it("extracts arbitrary role cards from Markdown without treating document containers as roles", () => {
    const roles = extractRoleSignals(`# Operations Handbook

This handbook describes the operating team.

## Head of Operations

- Department: Operations
- Purpose: Resolve cross-team operating tradeoffs.
- Responsibilities: Company operating cadence
- Authority: May approve operating policy
- Inputs: Company priorities
- Outputs: Operating plan

## Incident Commander

Department: Reliability
Reports to: Head of Operations
Purpose: Coordinate severe incidents from detection through recovery.

### Responsibilities

- Incident command
- Stakeholder coordination

### Authority

- May pause deployments

### Inputs

- Production alerts

### Outputs

- Incident timeline
- Recovery decision

## Release Captain

Reports to: Head of Operations
Responsibilities:
- Release coordination
Authority:
- May stop an unsafe release
`);

    expect(roles.map((role) => role.title)).toEqual([
      "Head of Operations",
      "Incident Commander",
      "Release Captain",
    ]);
    expect(roles).not.toContainEqual(expect.objectContaining({ title: "Operations Handbook" }));
    expect(roles.find((role) => role.title === "Incident Commander")).toMatchObject({
      department: "Reliability",
      reportsToTitle: "Head of Operations",
      purpose: "Coordinate severe incidents from detection through recovery.",
      owns: ["Incident command", "Stakeholder coordination"],
      permissions: ["May pause deployments"],
      inputs: ["Production alerts"],
      outputs: ["Incident timeline", "Recovery decision"],
      claimedScalarFields: ["department", "reportsTo"],
    });
  });

  it("preserves reporting, ownership, and authority from Markdown org tables and plain-language handbooks", () => {
    const content = `# Operating model

| Role | Department | Reports To | Purpose | Responsibilities | Authority |
| --- | --- | --- | --- | --- | --- |
| Chief Executive Officer | Leadership | | Set company direction | Company strategy | May approve company strategy |
| Head of Operations | Operations | Chief Executive Officer | Run the operating system | Operating cadence; cross-team delivery | May approve operating policy |

The Release Captain reports to the Head of Operations.
The Release Captain owns release coordination and rollback readiness.
The Release Captain may stop unsafe releases.
`;
    const signals = extractRoleSignals(content);
    expect(signals.map((role) => role.title)).toEqual([
      "Chief Executive Officer",
      "Head of Operations",
      "Release Captain",
    ]);
    expect(signals.find((role) => role.title === "Release Captain")).toMatchObject({
      reportsToTitle: "Head of Operations",
      owns: ["release coordination", "rollback readiness"],
      permissions: ["may stop unsafe releases"],
      claimedScalarFields: ["reportsTo"],
    });

    const organization = createOrganizationFromEvidence({
      organizationName: "Table Company",
      provider: "chatgpt",
      evidence: knowledgeEvidence([{ path: "operating-model.md", sourceType: "document", content }]),
    });
    const chiefExecutive = organization.roles.find((role) => role.title === "Chief Executive Officer")!;
    const operations = organization.roles.find((role) => role.title === "Head of Operations")!;
    const release = organization.roles.find((role) => role.title === "Release Captain")!;
    expect(operations.reportsTo).toBe(chiefExecutive.id);
    expect(release.reportsTo).toBe(operations.id);
    expect(release.permissions).toEqual(["may stop unsafe releases"]);
  });

  it("extracts complete role cards from YAML people directories without executing YAML features", () => {
    const roles = extractRoleSignals(`schema_version: "1.0"
roles:
  - title: Chief Executive Officer
    department: Leadership
    purpose: Set company direction
    responsibilities:
      - Company strategy
    authority:
      - May approve company strategy
  - title: Operations Lead
    department: Operations
    reports_to: Chief Executive Officer
    responsibilities: [Daily operations, Operating cadence]
    inputs:
      - Company priorities
    outputs:
      - Weekly operating review
    authority:
      - May stop unsafe work
metadata:
  owner: People Operations
`);

    expect(roles.map((role) => role.title)).toEqual([
      "Chief Executive Officer",
      "Operations Lead",
    ]);
    expect(roles[1]).toMatchObject({
      department: "Operations",
      reportsToTitle: "Chief Executive Officer",
      owns: ["Daily operations", "Operating cadence"],
      inputs: ["Company priorities"],
      outputs: ["Weekly operating review"],
      permissions: ["May stop unsafe work"],
      claimedScalarFields: ["department", "reportsTo"],
    });
  });

  it("turns CLI interview answers into an exportable hierarchy", () => {
    const organization = organizationFromInterview({
      name: "Atlas Works",
      mission: "Make logistics visible.",
      roles: ["Chief Executive Officer: Sets company direction.", "Operations Lead: Owns daily delivery."],
      decisions: ["Operations can reroute daily delivery."],
      handoffs: ["Operations escalates material risk to the CEO."],
    });

    expect(organization.roles).toHaveLength(2);
    expect(organization.roles[1].reportsTo).toBe("ceo");
    expect(compilePackage(organization)["roles/operations-lead/SKILL.md"]).toContain("Operations Lead");
    expect(renderOrganizationMap(organization)).toContain("Operations Lead");
  });

  it("creates a five-role engineering launchpad with template assumptions and linked repository evidence", () => {
    const evidence = repositoryEvidence([
      { path: "CODEOWNERS", content: "* @platform-team" },
      { path: ".github/workflows/deploy.yml", content: "name: Deploy\n" },
      { path: "AGENTS.md", content: "<!-- deltadotta:start -->\nGenerated role context\n<!-- deltadotta:end -->" },
      { path: "notes.bin", content: "ignored" },
    ]);
    const organization = createEngineeringLaunchpad({
      organizationName: "Atlas Engineering",
      repositoryName: "atlas-api",
      provider: "codex",
      owner: "Engineering Lead",
      deploymentAuthority: "Platform may stop unsafe deployments.",
      escalationOwner: "Engineering Lead",
      handoffTarget: "Engineering Lead",
      evidence,
    });

    expect(evidence).toHaveLength(2);
    expect(evidence[0].sourcePath).toBe("CODEOWNERS");
    expect(evidence[0].sourceHash).toBe(evidenceHash("* @platform-team"));
    expect(organization.roles).toHaveLength(5);
    expect(organization.roles.map((role) => role.title)).toEqual([
      "Engineering Lead", "DevOps / Platform Engineer", "Software Engineer", "Product Designer", "QA Engineer",
    ]);
    expect(organization.roles.filter((role) => role.id !== "platform-engineer").every((role) => role.status === "draft")).toBe(true);
    expect(organization.roles.find((role) => role.id === "platform-engineer")?.contract?.readOnly).toBe(true);
    const packageFiles = compilePackage(organization);
    expect(packageFiles["contracts/devops-platform-engineer.md"]).toContain("Safe preflight scenario");
    expect(packageFiles["GAPS.md"]).toContain("Repository: CODEOWNERS");
  });

  it("only verifies the Platform first shift after installation and all safe contract checks pass", () => {
    const launchpad = createEngineeringLaunchpad({
      organizationName: "Atlas Engineering",
      repositoryName: "atlas-api",
      provider: "claude-code",
      owner: "Engineering Lead",
      deploymentAuthority: "Platform may stop unsafe deployments.",
      escalationOwner: "Engineering Lead",
      handoffTarget: "Engineering Lead",
    });

    expect(verifyPlatformFirstShift(launchpad).passed).toBe(false);
    const installed = markPlatformInstalled(launchpad);
    const report = verifyPlatformFirstShift(installed);
    const verified = applyFirstShiftReport(installed, report);

    expect(report.readOnly).toBe(true);
    expect(report.passed).toBe(true);
    expect(verified.launch?.status).toBe("preflighted");
    expect(renderOrganizationMap(verified)).toContain("Launch: preflighted");
  });

  it("creates a manufacturing map with a safety-bounded production first shift", () => {
    const organization = createTeamLaunchpad({
      template: "manufacturing",
      organizationName: "North Plant",
      repositoryName: "plant-operations",
      provider: "codex",
      owner: "Manufacturing Director",
      operatingAuthority: "Production Operations may stop an unsafe line and authorize a controlled restart.",
      escalationOwner: "Manufacturing Director",
      handoffTarget: "Maintenance Lead",
      evidence: repositoryEvidence([{ path: "runbooks/line-stop.md", content: "Stop the line, contain the risk, and page maintenance." }]),
    });

    expect(organization.launch?.template).toBe("manufacturing");
    expect(organization.launch?.primaryRoleId).toBe("production-operations-lead");
    expect(organization.roles.map((role) => role.title)).toEqual([
      "Manufacturing Director", "Production Operations Lead", "Process Engineer", "Quality Manager", "Maintenance Lead",
    ]);
    const primaryRole = organization.roles.find((role) => role.id === "production-operations-lead");
    expect(primaryRole?.contract?.scenario).toContain("stopped production line");
    expect(primaryRole?.contract?.scenario).toContain("Do not restart equipment");
    expect(compilePackage(organization)["contracts/production-operations-lead.md"]).toContain("Safety");
  });
});
