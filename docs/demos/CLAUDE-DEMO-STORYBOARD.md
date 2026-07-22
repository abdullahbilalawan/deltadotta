# DeltaDotta to Claude demo storyboard

## Short loop, 10 seconds

Show a real DeltaDotta CLI session in a neutral sample workspace. Type each answer separately at human speed, then end on `Launch complete: verified` and the generated package path.

On-screen takeaway: `Scattered repo knowledge becomes a reusable AI operating role.`

## Full product demo, about 25 seconds

### 0-10s: Build the operating role

- Run `deltadotta`.
- Choose Software team.
- Enter team name, owner, deployment authority, escalation owner, and handoff target.
- End on `Launch complete: verified` and the package path.

Voiceover/plain-language beat:

> DeltaDotta reads the same files the team already trusts, then packages one verified role with clear operating boundaries.

### 10-17s: Import the generated skill into Claude

- Use a clean demo-only Claude account with no personal history or profile details.
- Open **Customize → Skills**.
- Choose **+ → Create skill → Upload a skill**.
- Upload `northstar-devops-platform-engineer-claude-skill.zip`.
- Show the `DevOps / Platform Engineer` skill appearing and enabled.

### 17-25s: Prove the value

- Start a new chat.
- Prompt: `Use the DevOps Platform Engineer skill. A deployment failed its health check. Give me the allowed next step, required handoff, and escalation boundary.`
- Show Claude following the generated role: source-aware assessment, stop/rollback authority, Product Engineering handoff, and Maya Chen escalation.
- End card: `From scattered evidence → a reusable AI operating role.`

## Shot checklist

- Use `Northstar Checkout` as the workspace name in visible repo context.
- Keep `Maya Chen`, `Product Engineering`, and `DevOps / Platform Engineer` consistent across CLI, package, and prompt.
- Show only the focused role-skill upload, not the full organization ZIP.
- Finish on a clear answer that says what the AI may do, where the handoff goes, and when to escalate.

## Recording rules

- Record only real CLI output and the real Claude UI.
- Never show a personal account, chat history, email address, or local username.
- Do not upload the full organization package as a single Claude skill. Upload one focused role-skill ZIP whose root is the matching skill folder.
- Keep the cursor visible and use normal human pauses; no jump cuts during typed answers.
