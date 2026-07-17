"use client";

import JSZip from "jszip";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Check, ClipboardList, FileText, FolderUp, GitBranch, Plus, Sparkles, X } from "lucide-react";
import { compilePackage, createTeamLaunchpad, Evidence, extractRoleSignals, LaunchTemplate, mergeOrganization, Organization, parseImportedPackage, Role, slugify, starterOrganization } from "@/lib/organization";

const storageKey = "deltadotta-organization-v1";

type Candidate = { id: string; title: string; purpose: string; excerpt: string; evidenceId: string; sourceName: string };

function roleFromCandidate(candidate: Candidate, index: number): Role {
  const id = slugify(candidate.title) || `role-${Date.now()}`;
  return {
    id: `${id}-${index}`, title: candidate.title, department: "Unassigned", reportsTo: "ceo",
    purpose: candidate.purpose, owns: ["Review ownership from imported evidence"], inputs: ["Organization context"], outputs: ["Role-specific outcomes"],
    permissions: ["Define this role’s decision boundary"], collaborators: [], escalatesTo: "ceo", evidenceIds: [candidate.evidenceId], status: "draft",
  };
}

export default function Home() {
  const [organization, setOrganization] = useState<Organization>(starterOrganization);
  const [selectedRoleId, setSelectedRoleId] = useState("ceo");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [packagePreview, setPackagePreview] = useState<Organization | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const sourceInput = useRef<HTMLInputElement>(null);
  const packageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      try {
        const restored = JSON.parse(saved) as Organization;
        setOrganization(restored);
        setSelectedRoleId(restored.roles[0]?.id ?? "ceo");
      } catch { window.localStorage.removeItem(storageKey); }
    }
    setHydrated(true);
  }, []);

  useEffect(() => { if (hydrated) window.localStorage.setItem(storageKey, JSON.stringify(organization)); }, [organization, hydrated]);

  const selectedRole = organization.roles.find((role) => role.id === selectedRoleId) ?? organization.roles[0];
  const roots = organization.roles.filter((role) => !role.reportsTo);
  const reports = organization.roles.filter((role) => role.reportsTo);
  const packageFiles = useMemo(() => compilePackage(organization), [organization]);

  function updateRole(patch: Partial<Role>) {
    if (!selectedRole) return;
    setOrganization((current) => ({ ...current, updatedAt: "Just now", roles: current.roles.map((role) => role.id === selectedRole.id ? { ...role, ...patch } : role) }));
  }

  async function addSources(files: FileList | null) {
    if (!files?.length) return;
    const additions: Evidence[] = [];
    const discovered: Candidate[] = [];
    for (const file of Array.from(files)) {
      const readable = /\.(md|txt|csv|json)$/i.test(file.name);
      const text = readable ? await file.text().catch(() => "") : "";
      const evidenceId = `source-${Date.now()}-${file.name}`;
      additions.push({ id: evidenceId, name: file.name, kind: "upload", excerpt: text.slice(0, 240) || "File received. Add a text export to extract roles locally.", importedAt: "Just now" });
      extractRoleSignals(text).forEach((signal, index) => discovered.push({ id: `${evidenceId}-${index}`, ...signal, evidenceId, sourceName: file.name }));
    }
    setOrganization((current) => ({ ...current, evidence: [...current.evidence, ...additions], updatedAt: "Just now" }));
    setCandidates((current) => [...current, ...discovered.filter((candidate) => !organization.roles.some((role) => role.title.toLowerCase() === candidate.title.toLowerCase()))]);
    setToast(discovered.length ? `${discovered.length} role suggestion${discovered.length > 1 ? "s" : ""} found in your sources.` : "Sources added. Add a text-based JD or repository file to extract role suggestions.");
    if (sourceInput.current) sourceInput.current.value = "";
  }

  async function inspectPackage(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    try {
      let raw: unknown;
      if (/\.zip$/i.test(file.name)) {
        const zip = await JSZip.loadAsync(file);
        const graph = Object.values(zip.files).find((entry) => !entry.dir && /(^|\/)graph\.json$/i.test(entry.name));
        if (!graph) throw new Error("This ZIP does not contain graph.json.");
        raw = JSON.parse(await graph.async("text"));
      } else raw = JSON.parse(await file.text());
      setPackagePreview(parseImportedPackage(raw).organization);
    } catch (error) { setToast(error instanceof Error ? error.message : "We could not read this package."); }
    finally { if (packageInput.current) packageInput.current.value = ""; }
  }

  function acceptCandidate(candidate: Candidate) {
    setOrganization((current) => {
      const role = roleFromCandidate(candidate, current.roles.length);
      if (current.roles.some((existing) => existing.title.toLowerCase() === role.title.toLowerCase())) return current;
      return { ...current, updatedAt: "Just now", roles: [...current.roles, role] };
    });
    setCandidates((current) => current.filter((item) => item.id !== candidate.id));
    setSelectedRoleId(`${slugify(candidate.title)}-${organization.roles.length}`);
  }

  function addRole() {
    const index = organization.roles.length;
    const role: Role = { id: `role-${Date.now()}`, title: "New role", department: "Unassigned", reportsTo: "ceo", purpose: "State the result this role is accountable for.", owns: ["Define ownership"], inputs: [], outputs: [], permissions: ["Define authority"], collaborators: [], escalatesTo: "ceo", evidenceIds: [], status: "draft" };
    setOrganization((current) => ({ ...current, updatedAt: "Just now", roles: [...current.roles, role] }));
    setSelectedRoleId(role.id);
    setToast(`Role ${index + 1} added to the map.`);
  }

  function useTemplate(template: LaunchTemplate) {
    const manufacturing = template === "manufacturing";
    const organizationName = manufacturing ? "Manufacturing team" : "Software team";
    const primaryRoleId = manufacturing ? "production-operations-lead" : "platform-engineer";
    setOrganization(createTeamLaunchpad({
      template,
      organizationName,
      repositoryName: organizationName,
      provider: "codex",
      owner: manufacturing ? "Manufacturing Director" : "Engineering Lead",
      operatingAuthority: manufacturing ? "Production Operations Lead may stop an unsafe line and require a controlled restart." : "DevOps / Platform Engineer may stop or roll back an unsafe deployment.",
      escalationOwner: manufacturing ? "Manufacturing Director" : "Engineering Lead",
      handoffTarget: manufacturing ? "Maintenance Lead" : "Engineering Lead",
    }));
    setSelectedRoleId(primaryRoleId);
    setCandidates([]);
    setToast(`${manufacturing ? "Manufacturing" : "Software"} template loaded. Use the CLI Launchpad to scan evidence, install provider context, and verify the first shift.`);
  }

  function mergePreview() {
    if (!packagePreview) return;
    const next = mergeOrganization(organization, packagePreview);
    setOrganization(next);
    setPackagePreview(null);
    setToast("Roles and evidence merged into the map.");
  }

  async function downloadPackage() {
    const zip = new JSZip();
    Object.entries(packageFiles).forEach(([path, content]) => zip.file(`deltadotta-package/${path}`, content));
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `${organization.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-organization.zip`; link.click(); URL.revokeObjectURL(url);
    setToast("Portable package downloaded.");
  }

  return <main className="map-shell">
    <input ref={sourceInput} className="hidden" type="file" multiple accept=".md,.txt,.csv,.json" onChange={(event) => addSources(event.target.files)} />
    <input ref={packageInput} className="hidden" type="file" accept=".zip,.json" onChange={(event) => inspectPackage(event.target.files)} />
    <header className="map-header"><a className="simple-brand" href="/" aria-label="DeltaDotta home"><img className="brand-mark" src="/deltadotta-mark.svg" alt="" /><span>DeltaDotta</span></a><span className="map-title">{organization.name}</span><div className="map-actions"><button onClick={() => useTemplate("software")}>Software template</button><button onClick={() => useTemplate("manufacturing")}>Manufacturing template</button><button onClick={() => packageInput.current?.click()}>Import package</button><button className="map-export" onClick={downloadPackage}><ArrowDownToLine size={15} /> Export</button></div></header>

    <section className="map-layout">
      <aside className="source-rail">
        <div><p className="simple-kicker">01 / EVIDENCE</p><h2>Source inbox</h2><p>Bring JDs, operating notes, and repository files. Every extracted suggestion keeps its source.</p></div>
        <button className="source-drop" onClick={() => sourceInput.current?.click()}><FolderUp size={19} /><span><strong>Add source material</strong><small>JD, Markdown, text, CSV, or JSON</small></span></button>
        <div className="source-list">{organization.evidence.map((source) => <div className="source-row" key={source.id}><FileText size={14} /><div><strong>{source.name}</strong><span>{source.kind}</span></div></div>)}</div>
      </aside>

      <section className="map-canvas">
        <div className="canvas-top"><div><p className="simple-kicker">02 / ORGANIZATION MAP</p><h1>Hierarchy, not a form.</h1><p>Start with the template. Add only evidence-backed roles. Click a role to build its skill.</p></div><button className="add-role" onClick={addRole}><Plus size={15} /> Add role</button></div>
        <div className="template-note"><GitBranch size={15} /><span><strong>Template:</strong> {organization.launch ? (organization.launch.template === "manufacturing" ? "Manufacturing team" : "Software team") : "Choose a team template"}</span><button onClick={() => useTemplate(organization.launch?.template === "manufacturing" ? "manufacturing" : "software")}>{organization.launch ? "Reset template" : "Start software team"}</button></div>
        <div className="graph-area">
          <div className="graph-spine" />
          <div className="graph-roots">{roots.map((role) => <button className={`graph-node root ${selectedRole?.id === role.id ? "selected" : ""}`} key={role.id} onClick={() => setSelectedRoleId(role.id)}><span className="node-source">{role.evidenceIds.length ? "source linked" : "template"}</span><strong>{role.title}</strong><small>{role.owns[0] || role.purpose}</small></button>)}</div>
          <div className="graph-reports">{reports.map((role) => <button className={`graph-node ${selectedRole?.id === role.id ? "selected" : ""} ${role.status}`} key={role.id} onClick={() => setSelectedRoleId(role.id)}><span className="node-source">{role.evidenceIds.length ? "source linked" : "template"}</span><strong>{role.title}</strong><small>{role.owns[0] || role.purpose}</small></button>)}</div>
        </div>
      </section>

      <aside className="skill-rail">
        {selectedRole && <><div className="skill-head"><p className="simple-kicker">03 / ROLE SKILL</p><span className={selectedRole.status === "ready" ? "skill-status ready" : "skill-status"}>{selectedRole.status}</span><input value={selectedRole.title} onChange={(event) => updateRole({ title: event.target.value })} /></div>
          <label>Mission<textarea value={selectedRole.purpose} onChange={(event) => updateRole({ purpose: event.target.value })} /></label>
          <label>Owns <span>one per line</span><textarea value={selectedRole.owns.join("\n")} onChange={(event) => updateRole({ owns: event.target.value.split("\n").filter(Boolean) })} /></label>
          <label>Decision authority <span>one per line</span><textarea value={selectedRole.permissions.join("\n")} onChange={(event) => updateRole({ permissions: event.target.value.split("\n").filter(Boolean) })} /></label>
          <div className="skill-source"><ClipboardList size={15} /><span>{selectedRole.evidenceIds.length ? `${selectedRole.evidenceIds.length} source link${selectedRole.evidenceIds.length > 1 ? "s" : ""}` : "Template role — add evidence to strengthen it"}</span></div>
        </>}
        <div className="suggestions"><p className="simple-kicker">EXTRACTED SUGGESTIONS</p>{candidates.length ? candidates.map((candidate) => <article key={candidate.id}><div><strong>{candidate.title}</strong><p>{candidate.sourceName}</p></div><button onClick={() => acceptCandidate(candidate)}>Add to map</button></article>) : <p className="empty-suggestions">Upload a JD or repository text file and new role candidates appear here for review.</p>}</div>
      </aside>
    </section>

    {packagePreview && <section className="import-backdrop"><div className="import-sheet"><button className="import-close" onClick={() => setPackagePreview(null)}><X size={17} /></button><p className="eyebrow">PACKAGE READY TO MERGE</p><h2>{packagePreview.name}</h2><p className="onboarding-copy">{packagePreview.roles.length} roles will be added to your organization map with their source evidence.</p><div className="import-actions"><button className="secondary" onClick={() => setPackagePreview(null)}>Cancel</button><button className="primary" onClick={mergePreview}>Merge into map</button></div></div></section>}
    {toast && <div className="toast"><span>{toast}</span><button onClick={() => setToast(null)}><X size={16} /></button></div>}
  </main>;
}
