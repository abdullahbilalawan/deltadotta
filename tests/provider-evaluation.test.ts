import { describe, expect, it } from "vitest";
import { createOrganizationFromEvidence, evidenceHash, knowledgeEvidence } from "../lib/organization";
import { applyOrganizationReview, createOrganizationReviewTemplate } from "../lib/organization-review";
import {
  createProviderEvaluationSuite,
  scoreProviderEvaluation,
} from "../lib/provider-evaluation";

function reviewedOrganization() {
  const evidence = knowledgeEvidence([
    {
      path: "roles.json",
      sourceType: "document",
      content: JSON.stringify({
        roles: [
          {
            title: "Chief Executive Officer",
            purpose: "Set company direction.",
            responsibilities: ["Company strategy"],
            authority: ["Approve company strategy"],
          },
          {
            title: "Operations Lead",
            reports_to: "Chief Executive Officer",
            purpose: "Coordinate daily operations.",
            responsibilities: ["Daily operations"],
            authority: ["Stop unsafe work"],
            inputs: ["Company priorities"],
            outputs: ["Weekly operating review"],
          },
        ],
      }),
    },
    {
      path: "schema.sql",
      sourceType: "database",
      content: "CREATE TABLE operating_decisions (owner_role text, escalation_role text);",
    },
  ]);
  const inferred = createOrganizationFromEvidence({
    organizationName: "Atlas Company",
    provider: "chatgpt",
    evidence,
  });
  const review = createOrganizationReviewTemplate(inferred);
  review.reviewedBy = "Jordan Lee";
  review.reviewedAt = "2026-07-26T17:00:00Z";
  review.organization.roles.forEach((role) => { role.confirmed = true; });
  return applyOrganizationReview(inferred, review, {
    sourceHash: evidenceHash(JSON.stringify(review)),
  });
}

function passingSubmission() {
  const organization = reviewedOrganization();
  const suite = createProviderEvaluationSuite(organization);
  return {
    organization,
    suite,
    submission: {
      schemaVersion: "1.0",
      provider: "chatgpt",
      evaluatedBy: "Jordan Lee",
      evaluatedAt: "2026-07-26T18:00:00Z",
      projectUrl: "https://chatgpt.com/g/g-p-example/project",
      responses: suite.cases.map((item) => ({
        caseId: item.id,
        output: {
          caseId: item.id,
          role: item.expected.role,
          decision: item.expected.decision,
          escalation: item.expected.escalation,
          sources: item.category === "source-conflict" ? item.expected.anySource : item.expected.anySource.slice(0, 1),
          unsupportedClaims: [] as string[],
          rationale: "Grounded in the installed organization package.",
        },
      })),
    },
  };
}

describe("provider behavioral evaluation", () => {
  it("generates organization-specific routing and authority cases", () => {
    const { suite } = passingSubmission();

    expect(suite.cases.map((item) => item.category)).toEqual([
      "role-routing",
      "role-routing",
      "authority-boundary",
      "authority-boundary",
      "source-conflict",
      "prompt-injection",
    ]);
    expect(suite.cases[0].prompt).toContain("Return one JSON object");
    expect(suite.cases[1].expected.role).toBe("Operations Lead");
    expect(suite.cases.filter((item) => item.category === "role-routing")).toHaveLength(2);
    expect(suite.cases.filter((item) => item.category === "authority-boundary")).toHaveLength(2);
  });

  it("verifies raw project responses only when every contract check passes", () => {
    const { organization, submission } = passingSubmission();
    const report = scoreProviderEvaluation(organization, submission, {
      sourceHash: evidenceHash(JSON.stringify(submission)),
    });

    expect(report).toMatchObject({
      status: "verified",
      score: 100,
      passed: 6,
      total: 6,
      submissionHash: expect.stringMatching(/^sha256-[a-f0-9]{64}$/),
    });
  });

  it("fails wrong role routing and reported unsupported claims", () => {
    const { organization, submission } = passingSubmission();
    submission.responses[0].output.role = "Operations Lead";
    submission.responses[0].output.unsupportedClaims = ["Invented approval threshold"];
    const report = scoreProviderEvaluation(organization, submission);

    expect(report.status).toBe("failed");
    expect(report.results[0].checks).toContainEqual(expect.objectContaining({
      name: "Role routing",
      passed: false,
    }));
    expect(report.results[0].checks).toContainEqual(expect.objectContaining({
      name: "Unsupported claims",
      passed: false,
    }));
  });

  it("requires a project URL on the provider's official domain", () => {
    const { organization, submission } = passingSubmission();
    submission.projectUrl = "https://example.com/not-a-chatgpt-project";

    expect(() => scoreProviderEvaluation(organization, submission))
      .toThrow("projectUrl must use https://chatgpt.com");
  });
});
