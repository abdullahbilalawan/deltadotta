const now = "Today";
export const starterOrganization = {
    name: "Northstar Studio",
    mission: "Make complex operations feel obvious to the people doing the work.",
    version: 3,
    updatedAt: now,
    evidence: [
        {
            id: "ev-brief",
            name: "Founder operating notes.md",
            kind: "upload",
            excerpt: "We need a clear line from customer signal to a shipped, reliable product.",
            importedAt: now,
        },
        {
            id: "ev-goal",
            name: "15-minute kickoff answer",
            kind: "note",
            excerpt: "Every role should know when to decide, delegate, and escalate.",
            importedAt: now,
        },
    ],
    roles: [
        {
            id: "ceo",
            title: "Chief Executive Officer",
            department: "Leadership",
            purpose: "Set direction, allocate resources, and resolve company-level tradeoffs.",
            owns: ["Company strategy", "Capital allocation", "Executive hiring"],
            inputs: ["Customer signal", "Leadership updates"],
            outputs: ["Company priorities", "Decision records"],
            permissions: ["Approve annual plan", "Approve spend above team limit"],
            collaborators: ["Product Lead", "Engineering Lead"],
            evidenceIds: ["ev-brief", "ev-goal"],
            status: "ready",
        },
        {
            id: "product",
            title: "Product Lead",
            department: "Product",
            reportsTo: "ceo",
            purpose: "Turn customer evidence into a focused product direction and sequenced work.",
            owns: ["Product strategy", "Roadmap", "Customer discovery"],
            inputs: ["Customer signal", "Technical constraints"],
            outputs: ["Prioritized roadmap", "Problem briefs"],
            permissions: ["Prioritize product work", "Accept product scope changes"],
            collaborators: ["Engineering Lead", "Design Lead"],
            escalatesTo: "ceo",
            evidenceIds: ["ev-brief"],
            status: "ready",
        },
        {
            id: "engineering",
            title: "Engineering Lead",
            department: "Engineering",
            reportsTo: "ceo",
            purpose: "Deliver a reliable technical system and make operational risk explicit.",
            owns: ["Technical architecture", "Delivery quality", "Production reliability"],
            inputs: ["Problem briefs", "Production signals"],
            outputs: ["Technical plan", "Release decision", "Incident review"],
            permissions: ["Approve technical approach", "Pause unsafe releases"],
            collaborators: ["Product Lead", "DevOps Engineer"],
            escalatesTo: "ceo",
            evidenceIds: ["ev-brief"],
            status: "ready",
        },
        {
            id: "design",
            title: "Design Lead",
            department: "Design",
            reportsTo: "product",
            purpose: "Make product intent understandable, usable, and coherent.",
            owns: ["Interaction design", "Design system"],
            inputs: ["Problem briefs", "User feedback"],
            outputs: ["Validated flows", "Design specifications"],
            permissions: ["Approve interaction quality"],
            collaborators: ["Product Lead", "Engineering Lead"],
            escalatesTo: "product",
            evidenceIds: [],
            status: "draft",
        },
        {
            id: "devops",
            title: "DevOps Engineer",
            department: "Engineering",
            reportsTo: "engineering",
            purpose: "Keep deployment, observability, and incident response dependable.",
            owns: ["Deployment pipeline", "Observability", "Incident response"],
            inputs: ["Release plan", "Production signals"],
            outputs: ["Deployment status", "Incident timeline"],
            permissions: ["Roll back releases", "Access production operations"],
            collaborators: ["Engineering Lead"],
            escalatesTo: "engineering",
            evidenceIds: [],
            status: "draft",
        },
    ],
};
export function createOrganization(name, mission) {
    const evidenceId = "ev-founding-direction";
    return {
        name: name.trim() || "Untitled organization",
        mission: mission.trim() || "Build an organization where every role has a clear decision boundary.",
        version: 1,
        updatedAt: "Just now",
        evidence: [{
                id: evidenceId,
                name: "Founding direction",
                kind: "note",
                excerpt: mission.trim() || "Build an organization where every role has a clear decision boundary.",
                importedAt: "Just now",
            }],
        roles: [{
                id: "ceo",
                title: "Chief Executive Officer",
                department: "Leadership",
                purpose: "Set direction, make company-level tradeoffs, and establish the organization’s operating model.",
                owns: ["Company strategy"],
                inputs: ["Customer signal", "Leadership updates"],
                outputs: ["Company priorities", "Decision records"],
                permissions: ["Approve company priorities"],
                collaborators: [],
                evidenceIds: [evidenceId],
                status: "ready",
            }],
    };
}
export function organizationFromInterview(answers) {
    const name = answers.name.trim() || "Untitled organization";
    const mission = answers.mission.trim() || "Make authority, ownership, and handoffs explicit.";
    const evidence = [
        { id: "interview-direction", name: "CLI interview: direction", kind: "note", excerpt: mission, importedAt: "Just now" },
        ...(answers.decisions?.filter(Boolean).length ? [{ id: "interview-decisions", name: "CLI interview: decisions", kind: "note", excerpt: answers.decisions.filter(Boolean).join("\n"), importedAt: "Just now" }] : []),
        ...(answers.handoffs?.filter(Boolean).length ? [{ id: "interview-handoffs", name: "CLI interview: handoffs", kind: "note", excerpt: answers.handoffs.filter(Boolean).join("\n"), importedAt: "Just now" }] : []),
    ];
    const defaults = [
        "Chief Executive Officer: Sets company direction and resolves company-level tradeoffs.",
        "Product Lead: Owns product direction and customer learning.",
        "Engineering Lead: Owns reliable delivery and technical decisions.",
    ];
    const roleLines = (answers.roles?.filter(Boolean).length ? answers.roles : defaults);
    const seen = new Set();
    const roles = roleLines.map((line, index) => {
        const [rawTitle, ...rest] = line.split(":");
        const title = rawTitle.trim() || `Role ${index + 1}`;
        let id = /chief executive|\bceo\b|founder/i.test(title) || index === 0 ? "ceo" : slugify(title) || `role-${index + 1}`;
        if (seen.has(id))
            id = `${id}-${index + 1}`;
        seen.add(id);
        const topLevel = id === "ceo";
        return {
            id,
            title,
            department: topLevel ? "Leadership" : "Team",
            reportsTo: topLevel ? undefined : "ceo",
            purpose: rest.join(":").trim() || `Own the work and decisions assigned to ${title}.`,
            owns: [rest.join(":").trim() || `The operating scope for ${title}`],
            inputs: ["Organization context"],
            outputs: ["Clear decisions and completed work"],
            permissions: answers.decisions?.filter(Boolean).length ? [answers.decisions.filter(Boolean)[0]] : ["Decide within this role’s scope"],
            collaborators: answers.handoffs?.filter(Boolean).length ? ["Roles named in the handoff rules"] : [],
            escalatesTo: topLevel ? undefined : "ceo",
            evidenceIds: evidence.map((item) => item.id),
            status: "ready",
        };
    });
    return { name, mission, version: 1, evidence, roles, updatedAt: "Just now" };
}
function stringList(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function importRole(value, index) {
    if (!value || typeof value !== "object")
        return null;
    const source = value;
    if (typeof source.title !== "string" || !source.title.trim())
        return null;
    const contractSource = source.contract && typeof source.contract === "object" ? source.contract : undefined;
    const contract = contractSource && typeof contractSource.mission === "string" && typeof contractSource.authority === "string"
        && typeof contractSource.handoff === "string" && typeof contractSource.escalation === "string" && typeof contractSource.scenario === "string"
        ? {
            mission: contractSource.mission,
            authority: contractSource.authority,
            knowledge: stringList(contractSource.knowledge),
            handoff: contractSource.handoff,
            escalation: contractSource.escalation,
            scenario: contractSource.scenario,
            readOnly: true,
        }
        : undefined;
    return {
        id: typeof source.id === "string" && source.id ? source.id : `imported-role-${index}`,
        title: source.title,
        department: typeof source.department === "string" ? source.department : "Unassigned",
        reportsTo: typeof source.reportsTo === "string" ? source.reportsTo : undefined,
        purpose: typeof source.purpose === "string" ? source.purpose : "Define why this role exists.",
        owns: stringList(source.owns),
        inputs: stringList(source.inputs),
        outputs: stringList(source.outputs),
        permissions: stringList(source.permissions),
        collaborators: stringList(source.collaborators),
        escalatesTo: typeof source.escalatesTo === "string" ? source.escalatesTo : undefined,
        evidenceIds: stringList(source.evidenceIds),
        status: source.status === "ready" ? "ready" : "draft",
        launchStatus: source.launchStatus === "mapped" || source.launchStatus === "installed" || source.launchStatus === "verified" || source.launchStatus === "needs-refinement" ? source.launchStatus : undefined,
        contract,
    };
}
export function parseImportedPackage(value) {
    const root = value && typeof value === "object" && "organization" in value
        ? value.organization
        : value;
    if (!root || typeof root !== "object")
        throw new Error("This package does not contain an organization graph.");
    const source = root;
    if (typeof source.name !== "string" || !source.name.trim())
        throw new Error("The imported package has no organization name.");
    const roles = Array.isArray(source.roles) ? source.roles.map(importRole).filter((role) => Boolean(role)) : [];
    if (!roles.length)
        throw new Error("The imported package has no usable role skills.");
    const evidence = Array.isArray(source.evidence) ? source.evidence.flatMap((item, index) => {
        if (!item || typeof item !== "object")
            return [];
        const evidenceSource = item;
        if (typeof evidenceSource.name !== "string")
            return [];
        return [{
                id: typeof evidenceSource.id === "string" ? evidenceSource.id : `imported-evidence-${index}`,
                name: evidenceSource.name,
                kind: evidenceSource.kind === "package" || evidenceSource.kind === "upload" || evidenceSource.kind === "repository" ? evidenceSource.kind : "note",
                excerpt: typeof evidenceSource.excerpt === "string" ? evidenceSource.excerpt : "Imported package evidence.",
                importedAt: "Just now",
            }];
    }) : [];
    return {
        organization: {
            name: source.name,
            mission: typeof source.mission === "string" ? source.mission : "Imported organization package.",
            version: typeof source.version === "number" ? source.version : 1,
            roles,
            evidence,
            updatedAt: "Just now",
        },
        roleCount: roles.length,
        evidenceCount: evidence.length,
    };
}
function unique(items) {
    return Array.from(new Set(items.filter(Boolean)));
}
export function mergeOrganization(current, incoming) {
    const importPrefix = `import-${Date.now()}`;
    const evidenceIdMap = new Map();
    const importedEvidence = incoming.evidence.map((evidence, index) => {
        const existing = current.evidence.find((candidate) => candidate.name === evidence.name && candidate.excerpt === evidence.excerpt);
        const id = existing?.id ?? `${importPrefix}-evidence-${index}`;
        evidenceIdMap.set(evidence.id, id);
        return { ...evidence, id, kind: "package", importedAt: "Just now" };
    }).filter((evidence, index, all) => !current.evidence.some((candidate) => candidate.id === evidence.id) && all.findIndex((candidate) => candidate.id === evidence.id) === index);
    const roleIdMap = new Map();
    const existingByTitle = new Map(current.roles.map((role) => [role.title.toLowerCase(), role]));
    const additions = [];
    const updates = new Map();
    incoming.roles.forEach((role, index) => {
        const existing = existingByTitle.get(role.title.toLowerCase());
        if (existing) {
            roleIdMap.set(role.id, existing.id);
            updates.set(existing.id, {
                ...existing,
                purpose: existing.purpose.startsWith("Define why") ? role.purpose : existing.purpose,
                owns: unique([...existing.owns, ...role.owns]),
                inputs: unique([...existing.inputs, ...role.inputs]),
                outputs: unique([...existing.outputs, ...role.outputs]),
                permissions: unique([...existing.permissions, ...role.permissions]),
                collaborators: unique([...existing.collaborators, ...role.collaborators]),
                evidenceIds: unique([...existing.evidenceIds, ...role.evidenceIds.map((id) => evidenceIdMap.get(id) ?? id)]),
                status: existing.status === "ready" || role.status === "ready" ? "ready" : "draft",
            });
        }
        else {
            const id = `${importPrefix}-role-${index}`;
            roleIdMap.set(role.id, id);
            additions.push({ ...role, id, evidenceIds: role.evidenceIds.map((id) => evidenceIdMap.get(id) ?? id) });
        }
    });
    const allNewRoles = additions.map((role) => ({
        ...role,
        reportsTo: role.reportsTo ? roleIdMap.get(role.reportsTo) ?? role.reportsTo : undefined,
        escalatesTo: role.escalatesTo ? roleIdMap.get(role.escalatesTo) ?? role.escalatesTo : undefined,
    }));
    return {
        ...current,
        version: current.version + 1,
        updatedAt: "Just now",
        evidence: [...current.evidence, ...importedEvidence],
        roles: [...current.roles.map((role) => updates.get(role.id) ?? role), ...allNewRoles],
    };
}
export function lintOrganization(org) {
    const issues = [];
    const roleIds = new Set(org.roles.map((role) => role.id));
    const ownerMap = new Map();
    for (const role of org.roles) {
        if (!role.purpose.trim()) {
            issues.push({ id: `purpose-${role.id}`, severity: "blocker", title: `${role.title} has no purpose`, detail: "Agents need a clear reason this role exists.", roleId: role.id });
        }
        if (!role.owns.length) {
            issues.push({ id: `owns-${role.id}`, severity: "blocker", title: `${role.title} owns nothing`, detail: "Give this role a decision area or remove it.", roleId: role.id });
        }
        if (!role.permissions.length) {
            issues.push({ id: `permission-${role.id}`, severity: "warning", title: `${role.title} has no authority boundary`, detail: "Specify an approval, access, or stop-the-line right.", roleId: role.id });
        }
        if (!role.evidenceIds.length) {
            issues.push({ id: `evidence-${role.id}`, severity: "warning", title: `${role.title} needs evidence`, detail: "Confirm this role from a source or an interview answer.", roleId: role.id });
        }
        if (role.reportsTo && !roleIds.has(role.reportsTo)) {
            issues.push({ id: `manager-${role.id}`, severity: "blocker", title: `${role.title} has an unknown manager`, detail: "Repair the reporting relationship before export.", roleId: role.id });
        }
        role.owns.forEach((ownership) => {
            const normalized = ownership.toLowerCase();
            ownerMap.set(normalized, [...(ownerMap.get(normalized) ?? []), role.title]);
        });
    }
    for (const [ownership, owners] of ownerMap.entries()) {
        if (owners.length > 1) {
            issues.push({ id: `duplicate-${ownership}`, severity: "warning", title: `Shared ownership: ${ownership}`, detail: `${owners.join(" and ")} both claim this area. Define the final decider.` });
        }
    }
    const parents = new Map(org.roles.map((role) => [role.id, role.reportsTo]));
    for (const role of org.roles) {
        const walked = new Set();
        let cursor = role.id;
        while (cursor) {
            if (walked.has(cursor)) {
                issues.push({ id: `cycle-${role.id}`, severity: "blocker", title: "Circular reporting relationship", detail: `The reporting line starting at ${role.title} loops back on itself.`, roleId: role.id });
                break;
            }
            walked.add(cursor);
            cursor = parents.get(cursor);
        }
    }
    return issues;
}
function bullets(items) {
    return items.length ? items.map((item) => `- ${item}`).join("\n") : "- Not yet defined";
}
export function roleSkill(role, org) {
    const manager = org.roles.find((candidate) => candidate.id === role.reportsTo)?.title ?? "No direct manager";
    const escalation = org.roles.find((candidate) => candidate.id === role.escalatesTo)?.title ?? manager;
    const contract = role.contract
        ? `\n## First-shift contract\n- Launch status: ${role.launchStatus ?? "needs-refinement"}\n- Authority boundary: ${role.contract.authority}\n- Handoff: ${role.contract.handoff}\n- Escalation: ${role.contract.escalation}\n- Read-only scenario: ${role.contract.scenario}\n\n## Required knowledge\n${bullets(role.contract.knowledge)}\n`
        : "";
    return `---\nname: ${role.title}\norganization: ${org.name}\nversion: ${org.version}\n---\n\n# ${role.title}\n\n## Mission\n${role.purpose}\n\n## Authority\n${bullets(role.permissions)}\n\n## Owns\n${bullets(role.owns)}\n\n## Receives\n${bullets(role.inputs)}\n\n## Produces\n${bullets(role.outputs)}\n\n## Collaborates with\n${bullets(role.collaborators)}\n\n## Reporting and escalation\n- Reports to: ${manager}\n- Escalates unresolved tradeoffs to: ${escalation}${contract}\n\n## Operating rule\nDecide within the authority above. Delegate work that belongs to a collaborating role. Escalate when a decision changes another role's authority, risk boundary, or stated company priority.\n`;
}
function roleContract(role) {
    if (!role.contract)
        return "";
    return `# ${role.title} — first-shift contract\n\n## Mission\n${role.contract.mission}\n\n## Authority boundary\n${role.contract.authority}\n\n## Knowledge to consult\n${bullets(role.contract.knowledge)}\n\n## Handoff\n${role.contract.handoff}\n\n## Escalation\n${role.contract.escalation}\n\n## Safe verification scenario\n${role.contract.scenario}\n\n## Safety\nThis verification is read-only. Do not deploy, modify infrastructure, access production credentials, or change repository files.\n`;
}
export function compilePackage(org) {
    const lines = org.roles.map((role) => `- **${role.title}** (${role.department}) — ${role.purpose}`).join("\n");
    const relationships = org.roles.map((role) => {
        const manager = org.roles.find((candidate) => candidate.id === role.reportsTo)?.title;
        return `- ${role.title}${manager ? ` reports to ${manager}` : " is a top-level role"}; collaborates with ${role.collaborators.join(", ") || "no roles declared"}.`;
    }).join("\n");
    const authority = org.roles.map((role) => `## ${role.title}\n${bullets(role.permissions)}`).join("\n\n");
    const escalations = org.roles.map((role) => `- ${role.title} → ${org.roles.find((candidate) => candidate.id === role.escalatesTo)?.title ?? "no escalation target"}`).join("\n");
    const graph = JSON.stringify({ schemaVersion: "1.0", generatedAt: new Date().toISOString(), organization: org }, null, 2);
    const manifest = `schema_version: "1.0"\nname: "${org.name}"\nversion: ${org.version}\nformat: deltadotta-organization-package\nroles: ${org.roles.length}\nentrypoint: ORGANIZATION.md${org.launch ? `\nlaunch_template: ${org.launch.template}\nlaunch_provider: ${org.launch.provider}\nlaunch_status: ${org.launch.status}` : ""}\n`;
    const providerGuide = `# Provider import guide\n\nThis is a provider-neutral DeltaDotta organization package. Keep the folder intact when possible. Start with \`ORGANIZATION.md\`, then add role files from \`roles/\` as reusable context or skills in your selected model workflow.\n\nDo not treat the package as an access-control system. It describes roles, authority, and delegation; your target provider or connected tools must enforce real permissions.\n`;
    return {
        "manifest.yaml": manifest,
        "ORGANIZATION.md": `# ${org.name}\n\n${org.mission}\n\n## Roles\n${lines}\n\n## How to use this package\nUse the role skills as constrained operating context. Preserve the reporting and escalation relationships before delegating work across roles.\n`,
        "graph.json": graph,
        "policies/authority.md": `# Authority boundaries\n\n${authority}\n`,
        "policies/handoffs.md": `# Collaboration and handoffs\n\n${relationships}\n`,
        "policies/escalations.md": `# Escalation paths\n\n${escalations}\n`,
        "PROVIDER-IMPORT.md": providerGuide,
        ...Object.fromEntries(org.roles.map((role) => [`roles/${slugify(role.title)}/SKILL.md`, roleSkill(role, org)])),
        ...Object.fromEntries(org.roles.filter((role) => role.contract).map((role) => [`contracts/${slugify(role.title)}.md`, roleContract(role)])),
    };
}
export function slugify(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
/** A deliberately explainable baseline for JD and repository-text ingestion. */
export function extractRoleSignals(text) {
    const compact = text.replace(/\r/g, "");
    const matches = [];
    const explicit = /(?:job\s*title|position|role)\s*[:\-]\s*([^\n]{3,80})/gi;
    let match;
    while ((match = explicit.exec(compact)))
        matches.push(match[1].trim());
    const knownRoles = [
        "Chief Executive Officer", "Engineering Lead", "Engineering Manager", "Product Manager", "Product Lead",
        "Designer", "Design Lead", "DevOps Engineer", "Customer Success Manager", "Customer Success Lead",
        "Sales Lead", "Finance Lead", "Operations Lead",
    ];
    for (const title of knownRoles) {
        if (new RegExp(`\\b${title.replace(/ /g, "\\s+")}\\b`, "i").test(compact))
            matches.push(title);
    }
    const seen = new Set();
    return matches.flatMap((candidate) => {
        const title = candidate.replace(/[.:;].*$/, "").trim();
        const key = title.toLowerCase();
        if (!title || seen.has(key))
            return [];
        seen.add(key);
        const location = compact.toLowerCase().indexOf(title.toLowerCase());
        const excerpt = location >= 0 ? compact.slice(location, location + 180).replace(/\s+/g, " ").trim() : title;
        return [{ title, purpose: `Review responsibilities from imported evidence: ${excerpt}`, excerpt }];
    });
}
export function draftFromEvidence(org) {
    const pasted = org.evidence.map((source) => source.excerpt).join(" ").toLowerCase();
    const ideas = [
        ["customer", "Customer Success Lead", "Customer", "Keep customer learning connected to retention and expansion."],
        ["sales", "Revenue Lead", "Revenue", "Own qualified pipeline and the handoff from promise to delivery."],
        ["finance", "Finance Lead", "Operations", "Make resource tradeoffs, spending, and runway visible."],
    ];
    const generated = ideas.filter(([keyword]) => pasted.includes(keyword)).map(([keyword, title, department, purpose]) => ({
        id: slugify(title), title, department, reportsTo: "ceo", purpose,
        owns: [keyword === "sales" ? "Revenue process" : `${department} operating system`],
        inputs: ["Company priorities"], outputs: ["Weekly operating update"],
        permissions: ["Approve work within team scope"], collaborators: ["Chief Executive Officer"], escalatesTo: "ceo", evidenceIds: org.evidence.map((item) => item.id), status: "draft",
    }));
    const existing = new Set(org.roles.map((role) => role.id));
    return { ...org, roles: [...org.roles, ...generated.filter((role) => !existing.has(role.id))], updatedAt: now };
}
/** Turns a bounded local repository scan into reviewable, portable evidence. */
export function repositoryEvidence(sources) {
    const useful = sources
        .filter((source) => source.content.trim())
        .filter((source) => !source.content.includes("<!-- deltadotta:start -->"))
        .filter((source) => /(?:^|\/)(?:CODEOWNERS|README|runbook|docs?|\.github\/workflows)|(?:\.md|\.ya?ml|\.json|\.toml|\.sh)$/i.test(source.path))
        .slice(0, 12);
    return useful.map((source, index) => ({
        id: `repo-${index}-${slugify(source.path) || "source"}`,
        name: `Repository: ${source.path}`,
        kind: "repository",
        excerpt: source.content.replace(/\s+/g, " ").trim().slice(0, 280),
        importedAt: "Just now",
    }));
}
/** Opinionated team templates: credible maps before deeper refinement. */
export function createTeamLaunchpad(answers) {
    const software = answers.template === "software";
    const organizationName = answers.organizationName.trim() || (software ? "Software team" : "Manufacturing team");
    const suppliedEvidence = answers.evidence?.length ? answers.evidence : [];
    const templateEvidence = {
        id: "launch-template",
        name: `${software ? "Software" : "Manufacturing"} Launchpad template`,
        kind: "note",
        excerpt: `Default ${software ? "software" : "manufacturing"} roles and relationships. Confirmed launch answers replace only authority, handoff, and escalation assumptions.`,
        importedAt: "Just now",
    };
    const evidence = [templateEvidence, ...suppliedEvidence];
    const evidenceIds = evidence.map((item) => item.id);
    const managerId = software ? "engineering-lead" : "manufacturing-director";
    const primaryRoleId = software ? "platform-engineer" : "production-operations-lead";
    const knowledge = suppliedEvidence.length
        ? suppliedEvidence.map((item) => item.name)
        : [`${software ? "Software" : "Manufacturing"} Launchpad template — add local operating evidence during refinement`];
    const primaryContract = {
        mission: software
            ? "Keep deployment, observability, and incident response dependable without bypassing safety boundaries."
            : "Keep production flow, line safety, and incident response dependable without bypassing quality or safety boundaries.",
        authority: answers.operatingAuthority.trim() || (software ? "The DevOps / Platform Engineer may stop or roll back an unsafe deployment." : "The Production Operations Lead may stop an unsafe line and require a controlled restart."),
        knowledge,
        handoff: answers.handoffTarget.trim() || (software ? "Hand incident follow-up to the Engineering Lead." : "Hand equipment follow-up to the Maintenance Lead."),
        escalation: answers.escalationOwner.trim() || (software ? "Escalate production risk to the Engineering Lead." : "Escalate quality or safety risk to the Manufacturing Director."),
        scenario: software
            ? "Assess a failed deployment, state the risk, choose an allowed next step, and hand off or escalate. Do not deploy, edit infrastructure, access credentials, or modify repository files."
            : "Assess a stopped production line, state the safety and quality risk, choose an allowed next step, and hand off or escalate. Do not restart equipment, alter controls, access operational systems, or change production records.",
        readOnly: true,
    };
    const roles = software ? [
        { id: managerId, title: "Engineering Lead", department: "Engineering", purpose: `${answers.owner.trim() || "Engineering Lead"} owns delivery direction, technical tradeoffs, and production-risk escalation.`, owns: ["Engineering delivery", "Technical risk"], inputs: ["Product priorities", "Production signals"], outputs: ["Technical direction", "Escalation decisions"], permissions: ["Resolve technical tradeoffs", "Pause unsafe delivery"], collaborators: ["DevOps / Platform Engineer", "Software Engineer", "Product Designer", "QA Engineer"], evidenceIds, status: "draft", launchStatus: "mapped" },
        { id: primaryRoleId, title: "DevOps / Platform Engineer", department: "Engineering", reportsTo: managerId, purpose: primaryContract.mission, owns: ["Deployment pipeline", "Observability", "Incident response"], inputs: ["Release plan", "Production signals"], outputs: ["Deployment assessment", "Incident timeline", "Escalation recommendation"], permissions: [primaryContract.authority], collaborators: ["Engineering Lead", answers.handoffTarget.trim() || "Engineering Lead"], escalatesTo: managerId, evidenceIds, status: "ready", launchStatus: "mapped", contract: primaryContract },
        { id: "software-engineer", title: "Software Engineer", department: "Engineering", reportsTo: managerId, purpose: "Build and maintain product capabilities within the agreed technical approach.", owns: ["Application implementation", "Code quality"], inputs: ["Technical direction", "Product requirements"], outputs: ["Reviewed code", "Implementation notes"], permissions: ["Make implementation decisions within the agreed architecture"], collaborators: ["Engineering Lead", "DevOps / Platform Engineer", "QA Engineer"], escalatesTo: managerId, evidenceIds, status: "draft", launchStatus: "mapped" },
        { id: "product-designer", title: "Product Designer", department: "Product", reportsTo: managerId, purpose: "Turn product intent into coherent, usable experiences.", owns: ["Interaction design", "Design specifications"], inputs: ["Product requirements", "Customer feedback"], outputs: ["User flows", "Design decisions"], permissions: ["Approve interaction quality"], collaborators: ["Software Engineer", "QA Engineer"], escalatesTo: managerId, evidenceIds, status: "draft", launchStatus: "mapped" },
        { id: "qa-engineer", title: "QA Engineer", department: "Engineering", reportsTo: managerId, purpose: "Make release confidence and customer-impacting risk visible before delivery.", owns: ["Release validation", "Quality risk"], inputs: ["Release candidate", "Acceptance criteria"], outputs: ["Quality assessment", "Release risk"], permissions: ["Block a release that fails agreed quality criteria"], collaborators: ["Software Engineer", "DevOps / Platform Engineer"], escalatesTo: managerId, evidenceIds, status: "draft", launchStatus: "mapped" },
    ] : [
        { id: managerId, title: "Manufacturing Director", department: "Manufacturing", purpose: `${answers.owner.trim() || "Manufacturing Director"} owns production direction, capacity tradeoffs, and safety escalation.`, owns: ["Production performance", "Safety and quality risk"], inputs: ["Demand plan", "Production signals"], outputs: ["Production priorities", "Escalation decisions"], permissions: ["Resolve production tradeoffs", "Pause unsafe operations"], collaborators: ["Production Operations Lead", "Process Engineer", "Quality Manager", "Maintenance Lead"], evidenceIds, status: "draft", launchStatus: "mapped" },
        { id: primaryRoleId, title: "Production Operations Lead", department: "Manufacturing", reportsTo: managerId, purpose: primaryContract.mission, owns: ["Line operations", "Shift response", "Production flow"], inputs: ["Production plan", "Line signals", "Quality alerts"], outputs: ["Line assessment", "Shift handoff", "Escalation recommendation"], permissions: [primaryContract.authority], collaborators: ["Manufacturing Director", "Maintenance Lead", "Quality Manager"], escalatesTo: managerId, evidenceIds, status: "ready", launchStatus: "mapped", contract: primaryContract },
        { id: "process-engineer", title: "Process Engineer", department: "Manufacturing", reportsTo: managerId, purpose: "Improve process capability and make controlled changes to production methods.", owns: ["Process capability", "Work instructions"], inputs: ["Production data", "Quality findings"], outputs: ["Validated process changes", "Process documentation"], permissions: ["Approve process changes within validated limits"], collaborators: ["Production Operations Lead", "Quality Manager"], escalatesTo: managerId, evidenceIds, status: "draft", launchStatus: "mapped" },
        { id: "quality-manager", title: "Quality Manager", department: "Quality", reportsTo: managerId, purpose: "Make product quality, containment, and release risk visible.", owns: ["Quality system", "Nonconformance containment"], inputs: ["Inspection results", "Customer requirements"], outputs: ["Quality disposition", "Corrective-action requirements"], permissions: ["Place nonconforming material on hold"], collaborators: ["Production Operations Lead", "Process Engineer"], escalatesTo: managerId, evidenceIds, status: "draft", launchStatus: "mapped" },
        { id: "maintenance-lead", title: "Maintenance Lead", department: "Manufacturing", reportsTo: managerId, purpose: "Keep equipment reliable and coordinate safe maintenance response.", owns: ["Preventive maintenance", "Equipment recovery"], inputs: ["Equipment alarms", "Maintenance requests"], outputs: ["Maintenance plan", "Equipment status"], permissions: ["Lock out equipment for safe maintenance"], collaborators: ["Production Operations Lead", "Process Engineer"], escalatesTo: managerId, evidenceIds, status: "draft", launchStatus: "mapped" },
    ];
    return {
        name: organizationName,
        mission: `Give ${answers.repositoryName || "this team"} a safe, evidence-backed ${software ? "software" : "manufacturing"} operating model.`,
        version: 1,
        evidence,
        roles,
        updatedAt: "Just now",
        launch: { template: answers.template, provider: answers.provider, status: "mapped", startedAt: "Just now", primaryRoleId },
    };
}
/** Backward-compatible software template entrypoint. */
export function createEngineeringLaunchpad(answers) {
    return createTeamLaunchpad({ ...answers, template: "software", operatingAuthority: answers.deploymentAuthority });
}
export function markPrimaryRoleInstalled(org) {
    const primaryRoleId = org.launch?.primaryRoleId ?? "platform-engineer";
    return {
        ...org,
        updatedAt: "Just now",
        launch: org.launch ? { ...org.launch, status: "installed" } : undefined,
        roles: org.roles.map((role) => role.id === primaryRoleId ? { ...role, launchStatus: "installed" } : role),
    };
}
/** Backward-compatible software helper. */
export const markPlatformInstalled = markPrimaryRoleInstalled;
/** A deterministic preflight. It deliberately evaluates the contract, not a live model with tool access. */
export function verifyFirstShift(org) {
    const primaryRoleId = org.launch?.primaryRoleId ?? "platform-engineer";
    const primaryRole = org.roles.find((role) => role.id === primaryRoleId);
    const provider = org.launch?.provider ?? "codex";
    const scenario = primaryRole?.contract?.scenario ?? "No first-shift scenario has been defined.";
    const managerExists = Boolean(primaryRole?.escalatesTo && org.roles.some((role) => role.id === primaryRole.escalatesTo));
    const checks = [
        { name: "Installed role contract", passed: primaryRole?.launchStatus === "installed" || primaryRole?.launchStatus === "verified", detail: "The provider adapter is generated before verification." },
        { name: "Evidence linked", passed: Boolean(primaryRole?.evidenceIds.length), detail: "The role references repository or template evidence." },
        { name: "Operating authority", passed: Boolean(primaryRole?.contract?.authority.trim() && primaryRole.permissions.length), detail: "The role can state what it may approve, stop, or escalate." },
        { name: "Handoff and escalation", passed: Boolean(primaryRole?.contract?.handoff.trim() && primaryRole?.contract?.escalation.trim() && managerExists), detail: "The scenario path reaches a named owner." },
        { name: "Read-only boundary", passed: primaryRole?.contract?.readOnly === true, detail: "This scenario cannot deploy, restart equipment, mutate systems, use production credentials, or change records." },
    ];
    return { roleId: primaryRole?.id ?? primaryRoleId, provider, scenario, readOnly: true, passed: checks.every((check) => check.passed), checks };
}
/** Backward-compatible software helper. */
export const verifyPlatformFirstShift = verifyFirstShift;
export function applyFirstShiftReport(org, report) {
    const launchStatus = report.passed ? "verified" : "needs-refinement";
    return {
        ...org,
        updatedAt: "Just now",
        launch: org.launch ? { ...org.launch, status: launchStatus } : undefined,
        roles: org.roles.map((role) => role.id === report.roleId ? { ...role, launchStatus } : role),
    };
}
