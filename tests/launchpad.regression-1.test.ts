import { describe, expect, it } from "vitest";
import { createTeamLaunchpad, launchAuthority } from "../lib/organization";

describe("Launchpad authority regression", () => {
  it("turns a software authority owner into an actionable deployment boundary", () => {
    const authority = launchAuthority("software", "Release Manager");
    const organization = createTeamLaunchpad({
      template: "software", organizationName: "Apex", repositoryName: "apex", provider: "codex",
      owner: "Engineering Lead", operatingAuthority: authority, escalationOwner: "Engineering Lead", handoffTarget: "Engineering Lead",
    });
    const platform = organization.roles.find((role) => role.id === "platform-engineer");

    expect(authority).toBe("Release Manager may stop or roll back an unsafe deployment.");
    expect(platform?.permissions).toEqual([authority]);
    expect(platform?.collaborators).toEqual(["Engineering Lead"]);
  });

  it("turns a manufacturing authority owner into an actionable safety boundary", () => {
    const authority = launchAuthority("manufacturing", "Shift Supervisor");

    expect(authority).toBe("Shift Supervisor may stop an unsafe line and require a controlled restart.");
  });
});
