import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Canvas } from "@napi-rs/canvas";

const output = process.argv[2] ?? "/tmp/deltadotta-demo-slides";
mkdirSync(output, { recursive: true });

const W = 1920;
const H = 1080;
const colors = {
  ink: "#151a15",
  muted: "#687067",
  faint: "#d9ded4",
  surface: "#f4f6f1",
  paper: "#ffffff",
  lime: "#a9eb31",
  limeDark: "#4f7a14",
};

function roundRect(ctx, x, y, w, h, r = 24) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function text(ctx, value, x, y, size, weight = 400, color = colors.ink, family = "Arial") {
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

function wrap(ctx, value, x, y, maxWidth, lineHeight, size, weight = 400, color = colors.ink) {
  ctx.font = `${weight} ${size}px Arial`;
  ctx.fillStyle = color;
  const words = value.split(/\s+/);
  let line = "";
  let lineY = y;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, x, lineY);
      line = word;
      lineY += lineHeight;
    } else {
      line = candidate;
    }
  }
  if (line) ctx.fillText(line, x, lineY);
  return lineY;
}

function frame(kicker, title, subtitle) {
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = colors.surface;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#e2e6de";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 64) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 64) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.fillStyle = colors.ink;
  roundRect(ctx, 64, 52, 44, 44, 12); ctx.fill();
  text(ctx, "Δ", 76, 85, 27, 800, colors.lime);
  text(ctx, "DeltaDotta", 124, 84, 28, 700);
  text(ctx, kicker.toUpperCase(), 72, 182, 20, 700, colors.limeDark);
  const titleEnd = wrap(ctx, title, 72, 278, 1540, 86, 74, 700);
  if (subtitle) wrap(ctx, subtitle, 74, titleEnd + 72, 1350, 42, 30, 400, colors.muted);
  return { canvas, ctx };
}

function save(name, canvas) {
  writeFileSync(join(output, name), canvas.toBuffer("image/png"));
}

function label(ctx, value, x, y, width) {
  ctx.fillStyle = colors.paper;
  ctx.strokeStyle = colors.faint;
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, width, 68, 14); ctx.fill(); ctx.stroke();
  text(ctx, value, x + 22, y + 44, 23, 600);
}

{
  const { canvas, ctx } = frame(
    "The context gap",
    "Everyone has AI. Nobody shares the same company.",
    "Individual sessions rebuild fragments of policy, ownership, and tribal knowledge from scratch."
  );
  const items = ["Customer context", "Release policy", "Who can approve", "When to escalate"];
  items.forEach((item, i) => label(ctx, item, 74 + i * 438, 655 + (i % 2) * 92, 390));
  ctx.strokeStyle = colors.limeDark; ctx.lineWidth = 4; ctx.setLineDash([10, 10]);
  ctx.beginPath(); ctx.moveTo(290, 855); ctx.lineTo(1630, 855); ctx.stroke(); ctx.setLineDash([]);
  text(ctx, "Four sessions. Four different versions of the company.", 530, 936, 28, 700);
  save("01-problem.png", canvas);
}

{
  const { canvas, ctx } = frame(
    "Step 1 · Scan",
    "Start with the knowledge the company already has.",
    "Aster Ridge Logistics: 22 retained sources across documents, code, and database exports."
  );
  const columns = [
    ["DOCUMENTS · 15", ["operating-model.md", "tribal-knowledge.md", "security.md", "production-incident.md"]],
    ["CODEBASE · 5", ["CODEOWNERS", "deploy.yml", "invoice.ts", "routing.ts"]],
    ["DATABASE · 2", ["role-directory.json", "schema.sql", "", ""]],
  ];
  columns.forEach(([heading, files], i) => {
    const x = 72 + i * 605;
    text(ctx, heading, x, 580, 22, 700, colors.limeDark);
    ctx.strokeStyle = colors.faint; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, 606); ctx.lineTo(x + 530, 606); ctx.stroke();
    files.filter(Boolean).forEach((file, j) => {
      text(ctx, file, x, 665 + j * 74, 29, 600);
      text(ctx, j === 0 ? "source-backed" : "fingerprinted", x + 305, 665 + j * 74, 18, 600, colors.muted);
    });
  });
  save("02-sources.png", canvas);
}

{
  const { canvas, ctx } = frame(
    "Step 2 · Build context",
    "Knowledge becomes an operating model, not a document dump.",
    "DeltaDotta connects evidence to roles, decisions, handoffs, escalation paths, and reusable skills."
  );
  const stages = [
    ["EVIDENCE", "22 sources", "Docs · code · database"],
    ["OPERATING CONTEXT", "Tribal knowledge", "Exceptions · timing · safety"],
    ["ACCOUNTABILITY", "13 reviewed roles", "Authority · handoffs · escalation"],
    ["AI PACKAGE", "Claude + ChatGPT", "Instructions · knowledge · tests"],
  ];
  stages.forEach(([kicker, titleValue, detail], i) => {
    const x = 72 + i * 453;
    if (i > 0) {
      ctx.strokeStyle = colors.limeDark; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x - 88, 710); ctx.lineTo(x - 24, 710); ctx.stroke();
      ctx.fillStyle = colors.limeDark;
      ctx.beginPath(); ctx.moveTo(x - 24, 710); ctx.lineTo(x - 39, 699); ctx.lineTo(x - 39, 721); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = colors.paper; ctx.strokeStyle = colors.faint; ctx.lineWidth = 2;
    roundRect(ctx, x, 575, 360, 270, 22); ctx.fill(); ctx.stroke();
    text(ctx, kicker, x + 26, 625, 18, 700, colors.limeDark);
    wrap(ctx, titleValue, x + 26, 700, 305, 42, 34, 700);
    wrap(ctx, detail, x + 26, 790, 305, 30, 22, 400, colors.muted);
  });
  save("03-context.png", canvas);
}

{
  const { canvas, ctx } = frame(
    "Tribal knowledge",
    "The rules experienced operators know, but the handbook misses.",
    "These details change what a safe answer looks like."
  );
  const rules = [
    ["RELEASE TIMING", "Avoid dispatch releases from 4–8 PM local time."],
    ["INCIDENT SIGNAL", "Three enterprise reports in 15 minutes means one incident, not three tickets."],
    ["BILLING HANDOFF", "Invoice only after proof of delivery is recorded."],
  ];
  rules.forEach(([k, v], i) => {
    const y = 560 + i * 145;
    text(ctx, `0${i + 1}`, 76, y + 28, 26, 700, colors.limeDark);
    text(ctx, k, 150, y, 20, 700, colors.muted);
    wrap(ctx, v, 150, y + 52, 1540, 42, 31, 600);
    ctx.strokeStyle = colors.faint; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(150, y + 96); ctx.lineTo(1760, y + 96); ctx.stroke();
  });
  save("04-tribal.png", canvas);
}

{
  const { canvas, ctx } = frame(
    "Step 3 · Human review",
    "Conflicting sources stay visible until a person decides.",
    "The first package is supposed to say needs-review."
  );
  const boxes = [
    [76, "DATABASE", "Release Operations", "Reports to COO"],
    [682, "CSV DIRECTORY", "Engineering", "Reports to CTO"],
    [1288, "REVIEWED DECISION", "Release Operations", "Reports to COO"],
  ];
  boxes.forEach(([x, k, titleValue, detail], i) => {
    ctx.fillStyle = i === 2 ? "#ecfbd5" : colors.paper;
    ctx.strokeStyle = i === 2 ? colors.limeDark : colors.faint;
    ctx.lineWidth = i === 2 ? 4 : 2;
    roundRect(ctx, x, 585, 500, 250, 24); ctx.fill(); ctx.stroke();
    text(ctx, k, x + 28, 635, 19, 700, i === 2 ? colors.limeDark : colors.muted);
    text(ctx, titleValue, x + 28, 715, 34, 700);
    text(ctx, detail, x + 28, 774, 25, 500, colors.muted);
  });
  text(ctx, "×", 625, 730, 50, 400, "#9c3d2f");
  text(ctx, "→", 1220, 730, 56, 400, colors.limeDark);
  save("05-review.png", canvas);
}

{
  const { canvas, ctx } = frame(
    "Role skill",
    "Every role carries its own operating boundary.",
    "A skill says what the role owns, what it may decide, who it collaborates with, and when it escalates."
  );
  ctx.fillStyle = colors.paper; ctx.strokeStyle = colors.faint; ctx.lineWidth = 2;
  roundRect(ctx, 72, 545, 820, 405, 24); ctx.fill(); ctx.stroke();
  text(ctx, "INCIDENT COMMANDER", 112, 606, 20, 700, colors.limeDark);
  text(ctx, "Coordinate recovery", 112, 677, 44, 700);
  text(ctx, "Owns", 112, 745, 20, 700, colors.muted);
  text(ctx, "Incident timeline · mitigation · recovery criteria", 112, 786, 25, 600);
  text(ctx, "Authority", 112, 846, 20, 700, colors.muted);
  text(ctx, "May page on-call roles and initiate rollback", 112, 887, 25, 600);
  const roles = ["Customer Support", "Fleet Operations", "Security", "Communications"];
  roles.forEach((role, i) => label(ctx, role, 1090, 540 + i * 100, 600));
  ctx.strokeStyle = colors.limeDark; ctx.lineWidth = 3;
  roles.forEach((_, i) => { ctx.beginPath(); ctx.moveTo(892, 746); ctx.lineTo(1090, 574 + i * 100); ctx.stroke(); });
  text(ctx, "Escalates to Platform Engineering Lead", 1090, 980, 24, 700, colors.limeDark);
  save("06-role.png", canvas);
}

{
  const { canvas, ctx } = frame(
    "Step 4 · Install",
    "Upload the reviewed package, not the entire local archive.",
    "DeltaDotta prints the exact files. The user keeps provider uploads and permissions visible."
  );
  const steps = [
    ["1", "Create the Project", "Open Claude Projects or a ChatGPT Project and use the reviewed organization name."],
    ["2", "Paste instructions", "PROJECT-INSTRUCTIONS.md defines how the assistant uses the package."],
    ["3", "Upload knowledge", "KNOWLEDGE.md · ORGANIZATION.md · GAPS.md · readiness.md"],
    ["4", "Run evaluations", "Test role routing and authority boundaries before connecting real tools."],
  ];
  steps.forEach(([n, heading, detail], i) => {
    const y = 545 + i * 112;
    ctx.fillStyle = i === 0 ? colors.lime : colors.ink;
    roundRect(ctx, 74, y - 34, 58, 58, 18); ctx.fill();
    text(ctx, n, 94, y + 7, 24, 800, i === 0 ? colors.ink : colors.paper);
    text(ctx, heading, 166, y, 30, 700);
    wrap(ctx, detail, 560, y, 1230, 32, 23, 400, colors.muted);
  });
  save("07-upload.png", canvas);
}

{
  const { canvas, ctx } = frame(
    "Shared, reviewed company context",
    "One onboarding flow. A consistent operating model for every AI session.",
    "Local-first · human-reviewed · Claude and ChatGPT ready"
  );
  ctx.fillStyle = colors.ink;
  roundRect(ctx, 72, 620, 1250, 128, 20); ctx.fill();
  text(ctx, "npx --yes deltadotta", 118, 703, 42, 600, colors.paper, "Courier New");
  text(ctx, "github.com/abdullahbilalawan/deltadotta", 75, 880, 27, 600, colors.muted);
  text(ctx, "Apache-2.0", 1560, 880, 27, 600, colors.limeDark);
  save("08-final.png", canvas);
}

console.log(`Rendered DeltaDotta demo slides to ${output}`);
