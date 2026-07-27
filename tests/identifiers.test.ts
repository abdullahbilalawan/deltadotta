import { describe, expect, it } from "vitest";
import { asciiSlug, portableIdentifier, roleArtifactSlugs } from "../lib/identifiers";

describe("portable organization identifiers", () => {
  it("normalizes accented Latin titles and gives non-Latin titles stable fallbacks", () => {
    expect(asciiSlug("Responsable des Opérations")).toBe("responsable-des-operations");
    expect(portableIdentifier("最高経営責任者", "role")).toMatch(/^role-[a-f0-9]{8}$/);
    expect(portableIdentifier("مدير العمليات", "role")).toMatch(/^role-[a-f0-9]{8}$/);
    expect(portableIdentifier("最高経営責任者", "role")).toBe(portableIdentifier("最高経営責任者", "role"));
  });

  it("creates unique deterministic skill slugs when readable titles collide", () => {
    const roles = [
      { id: "research-symbol", title: "R&D Lead" },
      { id: "research-space", title: "R D Lead" },
      { id: "international", title: "最高経営責任者" },
    ];
    const slugs = roleArtifactSlugs(roles);
    const repeated = roleArtifactSlugs([...roles].reverse()).reverse();

    expect(new Set(slugs).size).toBe(roles.length);
    expect(slugs[0]).toMatch(/^r-d-lead-[a-f0-9]{8}$/);
    expect(slugs[1]).toMatch(/^r-d-lead-[a-f0-9]{8}$/);
    expect(slugs[2]).toMatch(/^role-[a-f0-9]{8}$/);
    expect(slugs.every((slug) => slug.length <= 63)).toBe(true);
    expect(repeated).toEqual(slugs);
  });
});
