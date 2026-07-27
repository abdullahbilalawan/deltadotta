import { describe, expect, it } from "vitest";
import { compilePackage, createOrganizationFromEvidence, evidenceHash, knowledgeEvidence, organizationStructureLimits } from "../lib/organization";
import { applyOrganizationReview, createOrganizationReviewTemplate } from "../lib/organization-review";
import { evaluateOrganizationReadiness } from "../lib/readiness";

function inferredOrganization() {
  const content = JSON.stringify({
    roles: [
      {
        title: "Chief Executive Officer",
        department: "Leadership",
        purpose: "Set company direction.",
        responsibilities: ["Company strategy"],
        authority: ["Approve company strategy"],
      },
      {
        title: "Operations Lead",
        department: "Operations",
        reports_to: "Chief Executive Officer",
        purpose: "Coordinate daily operations.",
        responsibilities: ["Daily operations"],
        authority: ["Stop unsafe work"],
        inputs: ["Company priorities"],
        outputs: ["Operating review"],
      },
    ],
  });
  return createOrganizationFromEvidence({
    organizationName: "Atlas Company",
    provider: "chatgpt",
    evidence: knowledgeEvidence([{ path: "roles.json", sourceType: "document", content }]),
  });
}

function conflictingOrganization() {
  const first = JSON.stringify({
    roles: [
      {
        title: "Chief Executive Officer",
        department: "Leadership",
        purpose: "Set company direction.",
        responsibilities: ["Company strategy"],
        authority: ["Approve company strategy"],
      },
      {
        title: "Operations Lead",
        department: "Operations",
        reports_to: "Chief Executive Officer",
        purpose: "Coordinate daily operations.",
        responsibilities: ["Daily operations"],
        authority: ["Stop unsafe work"],
        inputs: ["Company priorities"],
        outputs: ["Operating review"],
      },
    ],
  });
  const second = JSON.stringify({
    roles: [{
      title: "Operations Lead",
      department: "Customer Operations",
      reports_to: "Chief Operating Officer",
      purpose: "Coordinate customer operations.",
      responsibilities: ["Customer operations"],
      authority: ["Approve customer recovery workflow"],
      inputs: ["Customer health"],
      outputs: ["Customer operations review"],
    }],
  });
  return createOrganizationFromEvidence({
    organizationName: "Conflicted Company",
    provider: "chatgpt",
    evidence: knowledgeEvidence([
      { path: "handbook.json", sourceType: "document", content: first },
      { path: "people-system.json", sourceType: "database", content: second },
    ]),
  });
}

function authorityConflictOrganization(secondAuthority = "Cannot approve refunds") {
  const executive = {
    title: "Chief Executive Officer",
    department: "Leadership",
    purpose: "Set company direction.",
    responsibilities: ["Company strategy"],
    authority: ["Approve company strategy"],
  };
  const operations = (authority: string) => ({
    title: "Operations Lead",
    department: "Operations",
    reports_to: "Chief Executive Officer",
    purpose: "Coordinate daily operations.",
    responsibilities: ["Daily operations"],
    authority: [authority],
    inputs: ["Company priorities"],
    outputs: ["Operating review"],
  });
  return createOrganizationFromEvidence({
    organizationName: "Authority Company",
    provider: "chatgpt",
    evidence: knowledgeEvidence([
      {
        path: "policy.json",
        sourceType: "document",
        content: JSON.stringify({ roles: [executive, operations("Approve refunds")] }),
      },
      {
        path: "controls.json",
        sourceType: "database",
        content: JSON.stringify({ roles: [operations(secondAuthority)] }),
      },
    ]),
  });
}

describe("organization review and readiness", () => {
  it("rejects structurally oversized review payloads before role processing", () => {
    const organization = inferredOrganization();
    const review = createOrganizationReviewTemplate(organization);
    review.reviewedBy = "Jordan Lee";
    review.reviewedAt = "2026-07-26";
    review.organization.roles = Array.from(
      { length: organizationStructureLimits.roles + 1 },
      () => structuredClone(review.organization.roles[0]),
    );

    expect(() => applyOrganizationReview(organization, review))
      .toThrow(`supported maximum is ${organizationStructureLimits.roles}`);
  });

  it("detects duplicate canonical titles and reporting cycles in wide graphs", () => {
    const duplicate = inferredOrganization();
    duplicate.roles.push({
      ...structuredClone(duplicate.roles[1]),
      id: "operations-lead-copy",
      title: "operations lead",
    });
    const duplicateReport = evaluateOrganizationReadiness(duplicate);
    expect(duplicateReport.checks).toContainEqual(expect.objectContaining({
      id: "role-uniqueness",
      status: "blocker",
    }));

    const cyclic = inferredOrganization();
    cyclic.roles[0].reportsTo = cyclic.roles[1].id;
    cyclic.roles[0].escalatesTo = cyclic.roles[1].id;
    const cyclicReport = evaluateOrganizationReadiness(cyclic);
    expect(cyclicReport.checks).toContainEqual(expect.objectContaining({
      id: "reporting-cycles",
      status: "blocker",
      detail: expect.stringContaining(cyclic.roles[0].id),
    }));
  });

  it("ships an editable canonical review template and keeps inferred roles blocked", () => {
    const organization = inferredOrganization();
    const files = compilePackage(organization);
    const review = JSON.parse(files["review/organization.review.json"]);
    const readiness = JSON.parse(files["validation/readiness.json"]);

    expect(review.organization.roles).toHaveLength(2);
    expect(review.organization.roles.every((role: { confirmed: boolean }) => !role.confirmed)).toBe(true);
    expect(readiness.status).toBe("needs-review");
    expect(readiness.checks).toContainEqual(expect.objectContaining({
      id: "human-review",
      status: "blocker",
    }));
  });

  it("promotes a complete canonical review to provider-ready status", () => {
    const organization = inferredOrganization();
    const review = createOrganizationReviewTemplate(organization);
    review.reviewedBy = "Jordan Lee, COO";
    review.reviewedAt = "2026-07-26T17:00:00Z";
    review.organization.roles.forEach((role) => { role.confirmed = true; });

    const reviewed = applyOrganizationReview(organization, review, {
      sourceHash: evidenceHash(JSON.stringify(review)),
    });
    const files = compilePackage(reviewed);
    const readiness = evaluateOrganizationReadiness(reviewed, files);

    expect(reviewed.roles.every((role) => role.status === "ready" && role.review?.reviewedBy === "Jordan Lee, COO")).toBe(true);
    expect(readiness.status).toBe("ready");
    expect(readiness.blockers).toBe(0);
    expect(files["providers/chatgpt/KNOWLEDGE.md"]).toContain("Stop unsafe work");
    expect(files["providers/claude/KNOWLEDGE.md"]).toContain("Operations Lead");

    for (const path of [
      "providers/chatgpt/PROJECT-INSTRUCTIONS.md",
      "providers/claude/UPLOAD-MANIFEST.md",
      "ORGANIZATION.md",
      "validation/provider-evaluation-cases.md",
    ]) {
      const tamperedHandoff = { ...files, [path]: `${files[path]}\nUnsafe local edit.` };
      expect(evaluateOrganizationReadiness(reviewed, tamperedHandoff).checks).toContainEqual(expect.objectContaining({
        id: "provider-handoff-integrity",
        status: "blocker",
      }));
    }

    const roleMapOmission = { ...files };
    roleMapOmission["providers/chatgpt/KNOWLEDGE.md"] = roleMapOmission["providers/chatgpt/KNOWLEDGE.md"]
      .replace(/^## Operations Lead$/m, "## Removed canonical role");
    expect(evaluateOrganizationReadiness(reviewed, roleMapOmission).checks).toContainEqual(expect.objectContaining({
      id: "provider-role-fidelity",
      status: "blocker",
      detail: expect.stringContaining("ChatGPT: Operations Lead"),
    }));

    const missingUploadManifest = { ...files };
    delete missingUploadManifest["providers/chatgpt/UPLOAD-MANIFEST.md"];
    expect(evaluateOrganizationReadiness(reviewed, missingUploadManifest).checks).toContainEqual(expect.objectContaining({
      id: "provider-artifacts",
      status: "blocker",
      detail: expect.stringContaining("providers/chatgpt/UPLOAD-MANIFEST.md"),
    }));

    const tamperedReview = { ...files };
    tamperedReview["review/organization.review.json"] = tamperedReview["review/organization.review.json"]
      .replace('"name": "Atlas Company"', '"name": "Tampered Company"');
    expect(evaluateOrganizationReadiness(reviewed, tamperedReview).checks).toContainEqual(expect.objectContaining({
      id: "review-artifact-integrity",
      status: "blocker",
    }));

    const untrackedGeneratedArtifact = {
      ...files,
      "roles/stale-generated/SKILL.md": "# Stale generated role",
    };
    expect(evaluateOrganizationReadiness(reviewed, untrackedGeneratedArtifact).checks).toContainEqual(expect.objectContaining({
      id: "generated-file-inventory",
      status: "blocker",
    }));

    files["providers/chatgpt/KNOWLEDGE.md"] = "# Corrupted provider knowledge";
    const corrupted = evaluateOrganizationReadiness(reviewed, files);
    expect(corrupted.checks).toContainEqual(expect.objectContaining({
      id: "provider-role-fidelity",
      status: "blocker",
      detail: expect.stringContaining("ChatGPT: Operations Lead"),
    }));

    files["validation/source-ingestion.json"] = "{\"schemaVersion\":\"tampered\"}";
    const corruptedIngestion = evaluateOrganizationReadiness(reviewed, files);
    expect(corruptedIngestion.checks).toContainEqual(expect.objectContaining({
      id: "source-ingestion-artifact",
      status: "blocker",
    }));
  });

  it("rejects unknown reporting references in the canonical review", () => {
    const organization = inferredOrganization();
    const review = createOrganizationReviewTemplate(organization);
    review.reviewedBy = "Jordan Lee";
    review.reviewedAt = "2026-07-26";
    review.organization.roles[1].reportsTo = "Imaginary Executive";

    expect(() => applyOrganizationReview(organization, review))
      .toThrow("references unknown role: Imaginary Executive");
  });

  it("treats the reviewed role list as canonical so false positives can be removed and missing roles added", () => {
    const organization = inferredOrganization();
    const review = createOrganizationReviewTemplate(organization);
    review.reviewedBy = "Jordan Lee";
    review.reviewedAt = "2026-07-26";
    review.organization.roles = [
      { ...review.organization.roles[0], confirmed: true },
      {
        id: "finance-lead",
        title: "Finance Lead",
        department: "Finance",
        reportsTo: "Chief Executive Officer",
        purpose: "Keep resource decisions grounded in current financial data.",
        owns: ["Budget and runway"],
        inputs: ["Department forecasts"],
        outputs: ["Monthly financial review"],
        permissions: ["Approve spend within the finance policy"],
        collaborators: ["Chief Executive Officer"],
        escalatesTo: "Chief Executive Officer",
        evidence: review.organization.roles[0].evidence,
        confirmed: true,
      },
    ];

    const reviewed = applyOrganizationReview(organization, review, {
      sourceHash: evidenceHash(JSON.stringify(review)),
    });

    expect(reviewed.roles.map((role) => role.title)).toEqual(["Chief Executive Officer", "Finance Lead"]);
    expect(reviewed.roles.some((role) => role.title === "Operations Lead")).toBe(false);
  });

  it("keeps confirmed roles blocked when authority or evidence is incomplete", () => {
    const organization = inferredOrganization();
    const review = createOrganizationReviewTemplate(organization);
    review.reviewedBy = "Jordan Lee";
    review.reviewedAt = "2026-07-26";
    review.organization.roles.forEach((role) => { role.confirmed = true; });
    review.organization.roles[1].permissions = [];
    review.organization.roles[1].evidence = [];

    const reviewed = applyOrganizationReview(organization, review);
    const readiness = evaluateOrganizationReadiness(reviewed, compilePackage(reviewed));

    expect(readiness.status).toBe("needs-review");
    expect(readiness.checks).toContainEqual(expect.objectContaining({
      id: "role-boundary-operations-lead",
      status: "blocker",
    }));
    expect(readiness.checks).toContainEqual(expect.objectContaining({
      id: "role-evidence-operations-lead",
      status: "blocker",
    }));
  });

  it("blocks conflicting structured reporting and department claims until the reviewer resolves each one", () => {
    const organization = conflictingOrganization();
    const files = compilePackage(organization);
    const draftReadiness = evaluateOrganizationReadiness(organization, files);
    const review = createOrganizationReviewTemplate(organization);

    expect(organization.sourceConflicts).toHaveLength(2);
    expect(organization.sourceConflicts?.map((conflict) => conflict.field)).toEqual(["department", "reportsTo"]);
    expect(review.organization.sourceConflicts).toHaveLength(2);
    expect(files["GAPS.md"]).toContain("UNRESOLVED");
    expect(draftReadiness.checks).toContainEqual(expect.objectContaining({
      id: "source-conflicts",
      status: "blocker",
    }));

    review.reviewedBy = "Jordan Lee, COO";
    review.reviewedAt = "2026-07-26T21:00:00Z";
    review.organization.roles = review.organization.roles.filter((role) => role.title !== "Chief Operating Officer");
    review.organization.roles.forEach((role) => { role.confirmed = true; });
    const operations = review.organization.roles.find((role) => role.title === "Operations Lead")!;
    operations.department = "Operations";
    operations.reportsTo = "Chief Executive Officer";
    operations.escalatesTo = "Chief Executive Officer";
    review.organization.sourceConflicts.forEach((conflict) => {
      conflict.resolved = true;
      conflict.resolution = conflict.field === "department" ? operations.department : operations.reportsTo!;
    });
    const reviewHash = evidenceHash(JSON.stringify(review));
    const reviewed = applyOrganizationReview(organization, review, { sourceHash: reviewHash });
    const reviewedFiles = compilePackage(reviewed);
    const readiness = evaluateOrganizationReadiness(reviewed, reviewedFiles);

    expect(readiness.status).toBe("ready");
    expect(readiness.checks).toContainEqual(expect.objectContaining({
      id: "source-conflicts",
      status: "pass",
      detail: expect.stringContaining("explicitly resolved"),
    }));
    expect(reviewed.sourceConflicts?.every((conflict) => conflict.resolution?.sourceHash === reviewed.review?.sourceHash)).toBe(true);
    expect(reviewed.review?.sourceHash).toBe(evidenceHash(reviewedFiles["review/organization.review.json"]));
    expect(reviewedFiles["providers/chatgpt/KNOWLEDGE.md"]).toContain('canonical value is "Operations"');
    expect(reviewedFiles["GAPS.md"]).toContain('resolved as "Chief Executive Officer"');
  });

  it("does not treat common executive title abbreviations as reporting conflicts", () => {
    const organization = createOrganizationFromEvidence({
      organizationName: "Alias Company",
      provider: "chatgpt",
      evidence: knowledgeEvidence([
        {
          path: "one.json",
          sourceType: "document",
          content: JSON.stringify({ roles: [{ title: "Operations Lead", department: "Operations", reports_to: "CEO" }] }),
        },
        {
          path: "two.json",
          sourceType: "database",
          content: JSON.stringify({ roles: [{ title: "Operations Lead", department: "Operations", reports_to: "Chief Executive Officer" }] }),
        },
      ]),
    });

    expect(organization.sourceConflicts).toEqual([]);
  });

  it("blocks explicit positive and negative authority claims for the same action", () => {
    const organization = authorityConflictOrganization();
    const review = createOrganizationReviewTemplate(organization);

    expect(organization.sourceConflicts).toHaveLength(1);
    expect(organization.sourceConflicts?.[0]).toMatchObject({
      roleTitle: "Operations Lead",
      field: "authority",
      claims: expect.arrayContaining([
        expect.objectContaining({ value: "Approve refunds" }),
        expect.objectContaining({ value: "Cannot approve refunds" }),
      ]),
    });
    expect(evaluateOrganizationReadiness(organization, compilePackage(organization)).checks)
      .toContainEqual(expect.objectContaining({ id: "source-conflicts", status: "blocker" }));

    review.reviewedBy = "Jordan Lee, COO";
    review.reviewedAt = "2026-07-26T22:00:00Z";
    review.organization.roles.forEach((role) => { role.confirmed = true; });
    const operations = review.organization.roles.find((role) => role.title === "Operations Lead")!;
    operations.permissions = ["Cannot approve refunds"];
    review.organization.sourceConflicts[0].resolution = "Cannot approve refunds";
    review.organization.sourceConflicts[0].resolved = true;
    const reviewed = applyOrganizationReview(organization, review, {
      sourceHash: evidenceHash(JSON.stringify(review)),
    });

    expect(evaluateOrganizationReadiness(reviewed, compilePackage(reviewed)).status).toBe("ready");
    expect(reviewed.sourceConflicts?.[0].resolution?.value).toBe("Cannot approve refunds");
    expect(compilePackage(reviewed)["providers/claude/KNOWLEDGE.md"])
      .toContain('canonical value is "Cannot approve refunds"');
  });

  it("does not classify unrelated permissions as an authority conflict", () => {
    const organization = authorityConflictOrganization("Pause unsafe campaigns");

    expect(organization.sourceConflicts).toEqual([]);
  });

  it("blocks retained ingestion warnings until the canonical reviewer explicitly acknowledges them", () => {
    const organization = inferredOrganization();
    organization.ingestion = {
      schemaVersion: "1.0",
      status: "complete-with-warnings",
      recordedAt: "2026-07-26T22:30:00Z",
      sourceCount: 1,
      totalBytes: 512,
      durationMs: 24,
      counts: { document: 1, codebase: 0, database: 0 },
      warnings: [{
        id: "source-warning-truncated-handbook",
        path: "handbook.pdf",
        reason: "extracted text truncated at the 128000-byte per-file limit",
      }],
    };
    const draftFiles = compilePackage(organization);
    const review = createOrganizationReviewTemplate(organization);

    expect(review.organization.ingestionWarnings).toEqual([expect.objectContaining({
      id: "source-warning-truncated-handbook",
      acknowledged: false,
    })]);
    expect(draftFiles["GAPS.md"]).toContain("UNACKNOWLEDGED");
    expect(evaluateOrganizationReadiness(organization, draftFiles).checks)
      .toContainEqual(expect.objectContaining({ id: "source-ingestion", status: "blocker" }));

    review.reviewedBy = "Jordan Lee, COO";
    review.reviewedAt = "2026-07-26T23:00:00Z";
    review.organization.roles.forEach((role) => { role.confirmed = true; });
    const unacknowledgedHash = evidenceHash(JSON.stringify(review));
    const unacknowledged = applyOrganizationReview(organization, review, { sourceHash: unacknowledgedHash });
    expect(evaluateOrganizationReadiness(unacknowledged, compilePackage(unacknowledged)).status).toBe("needs-review");

    review.organization.ingestionWarnings[0].acknowledged = true;
    const acknowledgedHash = evidenceHash(JSON.stringify(review));
    const acknowledged = applyOrganizationReview(organization, review, { sourceHash: acknowledgedHash });
    const readiness = evaluateOrganizationReadiness(acknowledged, compilePackage(acknowledged));

    expect(readiness.status).toBe("ready");
    expect(readiness.checks).toContainEqual(expect.objectContaining({
      id: "source-ingestion",
      status: "warning",
      detail: expect.stringContaining("acknowledged in the fingerprinted review"),
    }));
    expect(acknowledged.ingestion?.warnings[0].acknowledgement).toMatchObject({
      reviewedBy: "Jordan Lee, COO",
      sourceHash: acknowledged.review?.sourceHash,
    });
    expect(compilePackage(acknowledged)["validation/source-ingestion.md"])
      .toContain("acknowledged by Jordan Lee, COO");
  });

  it("rejects modified warning text in the canonical review", () => {
    const organization = inferredOrganization();
    organization.ingestion = {
      schemaVersion: "1.0",
      status: "complete-with-warnings",
      recordedAt: "2026-07-26T22:30:00Z",
      sourceCount: 1,
      totalBytes: 512,
      durationMs: 24,
      counts: { document: 1, codebase: 0, database: 0 },
      warnings: [{
        id: "source-warning-truncated-handbook",
        path: "handbook.pdf",
        reason: "extracted text truncated",
      }],
    };
    const review = createOrganizationReviewTemplate(organization);
    review.reviewedBy = "Jordan Lee";
    review.reviewedAt = "2026-07-26T23:00:00Z";
    review.organization.ingestionWarnings[0].acknowledged = true;
    review.organization.ingestionWarnings[0].reason = "Nothing was truncated";

    expect(() => applyOrganizationReview(organization, review))
      .toThrow("path or reason does not match the packaged source report");
  });

  it("rejects a conflict resolution that disagrees with the canonical reviewed field", () => {
    const organization = conflictingOrganization();
    const review = createOrganizationReviewTemplate(organization);
    review.reviewedBy = "Jordan Lee";
    review.reviewedAt = "2026-07-26T21:00:00Z";
    review.organization.roles.forEach((role) => { role.confirmed = true; });
    review.organization.sourceConflicts.forEach((conflict) => {
      conflict.resolved = true;
      conflict.resolution = "An unrelated value";
    });

    expect(() => applyOrganizationReview(organization, review))
      .toThrow("resolution must match the canonical reviewed value");
  });
});
