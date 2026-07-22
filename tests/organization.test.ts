import { describe, expect, it } from "vitest";
import { renderOrganizationMap } from "../lib/cli-viewer";
import { applyFirstShiftReport, compilePackage, createEngineeringLaunchpad, createOrganization, createTeamLaunchpad, evidenceHash, extractRoleSignals, lintOrganization, markPlatformInstalled, mergeOrganization, organizationFromInterview, parseImportedPackage, repositoryEvidence, starterOrganization, verifyPlatformFirstShift } from "../lib/organization";

describe("DeltaDotta organization compiler", () => {
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
    expect(packageFiles["PROVIDER-IMPORT.md"]).toContain("Customize → Skills");
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

  it("extracts reviewable role candidates from job-description text", () => {
    const roles = extractRoleSignals("Job Title: DevOps Engineer\nThe DevOps Engineer owns deployment and incident response.\nProduct Manager partners with engineering.");

    expect(roles.map((role) => role.title)).toContain("DevOps Engineer");
    expect(roles.map((role) => role.title)).toContain("Product Manager");
    expect(roles[0].excerpt).toContain("DevOps Engineer");
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
