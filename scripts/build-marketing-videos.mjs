import { mkdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);

const root = new URL("../", import.meta.url);
const demos = new URL("docs/demos/", root);
const work = new URL("docs/demos/generated-marketing/", root);
const ffmpeg = "/opt/homebrew/bin/ffmpeg";
const { chromium } = await import(
  "file:///Users/muhammadabdullahbilal/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"
);

const font = "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";

const videos = [
  {
    slug: "deltadotta-social-launch",
    title: "Social launch cut",
    width: 1080,
    height: 1920,
    fps: 24,
    sceneSeconds: 3.4,
    palette: ["#06131f", "#f8fafc", "#2dd4bf", "#f97316", "#93c5fd"],
    scenes: [
      {
        kicker: "DeltaDotta",
        headline: "Your repo already knows how the team works.",
        body: "DeltaDotta turns scattered docs into portable AI operating roles.",
        code: ["README.md", "RUNBOOK.md", "CODEOWNERS", "AGENTS.md"],
        mode: "evidence",
      },
      {
        kicker: "ONE GUIDED COMMAND",
        headline: "Scan evidence. Map owners. Package the first role.",
        body: "No private SaaS import. No mystery permissions. Local-first by default.",
        code: ["$ npx deltadotta", "workspace: Northstar Checkout", "preflight: passed"],
        mode: "terminal",
      },
      {
        kicker: "ROLE BOUNDARIES",
        headline: "Give agents a job, a lane, and an escalation path.",
        body: "Engineering Lead, DevOps / Platform Engineer, Software Engineer, Product Designer, QA Engineer.",
        code: ["owner: DevOps / Platform Engineer", "handoff: Engineering Lead", "risk: read-only first shift"],
        mode: "map",
      },
      {
        kicker: "SHIP THE PACKAGE",
        headline: "Codex and Claude get context they can actually carry.",
        body: "Role skills, provider context, confidence report, and a portable ZIP.",
        code: [".deltadotta/launchpad/", "roles/devops-platform-engineer.md", "confidence-report.md"],
        mode: "package",
      },
      {
        kicker: "START HERE",
        headline: "DeltaDotta",
        body: "Turn messy team knowledge into portable AI operating roles.",
        code: ["npx deltadotta"],
        mode: "cta",
      },
    ],
  },
  {
    slug: "deltadotta-investor-story",
    title: "Investor story cut",
    width: 1920,
    height: 1080,
    fps: 24,
    sceneSeconds: 4.2,
    palette: ["#0a1020", "#ffffff", "#38bdf8", "#fbbf24", "#34d399"],
    scenes: [
      {
        kicker: "THE ADOPTION GAP",
        headline: "AI agents fail when the team context is missing.",
        body: "DeltaDotta compiles the operating layer: ownership, handoffs, escalation, and evidence.",
        code: ["Problem", "who owns this?", "what is safe?", "when do we escalate?"],
        mode: "problem",
      },
      {
        kicker: "LOCAL-FIRST COMPILER",
        headline: "Messy knowledge in. Agent-ready roles out.",
        body: "It reads the repo evidence teams already maintain and generates a reviewable operating package.",
        code: ["README.md", "PRODUCT-KNOWLEDGE.md", "RUNBOOK.md", "CODEOWNERS", "AGENTS.md"],
        mode: "evidence",
      },
      {
        kicker: "TEAM MAP",
        headline: "Clear authority beats generic context dumps.",
        body: "Every generated role knows its purpose, boundaries, and escalation path.",
        code: ["Engineering Lead", "DevOps / Platform Engineer", "Software Engineer", "Product Designer", "QA Engineer"],
        mode: "map",
      },
      {
        kicker: "PROOF PACKAGE",
        headline: "A first shift that starts with preflight.",
        body: "DeltaDotta records evidence, assumptions, provider limits, and package checks before work begins.",
        code: ["preflight-report.md", "confidence-report.md", "role-contracts/", "portable package.zip"],
        mode: "package",
      },
      {
        kicker: "POSITIONING",
        headline: "DeltaDotta is the organization compiler for AI teams.",
        body: "A launchpad for Codex and Claude Code that makes agent adoption safer, faster, and easier to review.",
        code: ["npx deltadotta"],
        mode: "cta",
      },
    ],
  },
  {
    slug: "deltadotta-product-proof",
    title: "Product proof cut",
    width: 1920,
    height: 1080,
    fps: 24,
    sceneSeconds: 3.6,
    palette: ["#111827", "#f9fafb", "#a3e635", "#60a5fa", "#fb7185"],
    scenes: [
      {
        kicker: "NORTHSTAR CHECKOUT",
        headline: "A real demo workspace, not a fake dashboard.",
        body: "Product knowledge, runbooks, CODEOWNERS, and provider context are scanned as evidence.",
        code: ["docs/demo-workspace", "PRODUCT-KNOWLEDGE.md", "RUNBOOK.md", "CODEOWNERS"],
        mode: "evidence",
      },
      {
        kicker: "THE WIZARD",
        headline: "Five plain-language decisions create the launchpad.",
        body: "Team type, owner, authority, escalation, and handoff become visible operating rules.",
        code: ["team: Software", "owner: Engineering Lead", "authority: deploy support", "handoff: incident queue"],
        mode: "terminal",
      },
      {
        kicker: "GENERATED OUTPUT",
        headline: "The result is inspectable before any agent uses it.",
        body: "Hierarchy map, role skills, provider context, preflight report, confidence report, and portable ZIP.",
        code: ["organization-map.md", "roles/", "AGENTS.md block", "northstar-deltadotta-package.zip"],
        mode: "package",
      },
      {
        kicker: "FIRST SHIFT",
        headline: "Codex gets a role, not a vague prompt.",
        body: "The DevOps / Platform Engineer role carries exact boundaries and escalation rules.",
        code: ["role: DevOps / Platform Engineer", "scope: read-only first shift", "status: preflight passed"],
        mode: "map",
      },
      {
        kicker: "TRY IT",
        headline: "Run DeltaDotta on your repo.",
        body: "Turn messy team knowledge into portable AI operating roles.",
        code: ["npx deltadotta"],
        mode: "cta",
      },
    ],
  },
];

function esc(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function wrap(text, max) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function textBlock(lines, x, y, size, fill, weight = 700, gap = 1.15, anchor = "start") {
  return lines.map((line, index) => (
    `<text x="${x}" y="${y + index * size * gap}" text-anchor="${anchor}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(line)}</text>`
  )).join("\n");
}

function codeRows(rows, x, y, width, accent, light, vertical = false) {
  const rowH = vertical ? 86 : 54;
  return rows.map((row, index) => {
    const yy = y + index * rowH;
    return `
      <rect x="${x}" y="${yy}" width="${width}" height="${rowH - 14}" rx="12" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.14)" />
      <circle cx="${x + 28}" cy="${yy + (rowH - 14) / 2}" r="7" fill="${index === rows.length - 1 ? accent : "rgba(255,255,255,0.35)"}" />
      <text x="${x + 52}" y="${yy + (vertical ? 44 : 33)}" font-family="${font}" font-size="${vertical ? 30 : 23}" font-weight="800" fill="${light}">${esc(row)}</text>
    `;
  }).join("\n");
}

function sceneSvg(video, scene, index) {
  const [dark, light, accent, warm, cool] = video.palette;
  const { width: w, height: h } = video;
  const vertical = h > w;
  const pad = vertical ? 80 : 120;
  const headlineSize = vertical ? 76 : 72;
  const bodySize = vertical ? 34 : 31;
  const maxHeadline = vertical ? 16 : 28;
  const maxBody = vertical ? 31 : 58;
  const headline = wrap(scene.headline, maxHeadline);
  const body = wrap(scene.body, maxBody);
  const contentY = vertical ? 245 : 190;
  const codeX = vertical ? pad : w - 760;
  const codeY = vertical ? h - 600 : 245;
  const codeW = vertical ? w - pad * 2 : 630;
  const ring = vertical ? 720 : 820;
  const mapX = vertical ? 106 : 760;
  const mapY = vertical ? 1050 : 610;
  const mapW = vertical ? 868 : 900;

  const orbital = Array.from({ length: 9 }, (_, i) => {
    const cx = w * (0.18 + ((i * 113) % 70) / 100);
    const cy = h * (0.16 + ((i * 79) % 70) / 100);
    const r = 52 + ((i * 23) % 88);
    const color = [accent, warm, cool][i % 3];
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="0.08" />`;
  }).join("\n");

  const modePanel = {
    problem: `<path d="M${mapX} ${mapY + 150} C${mapX + 190} ${mapY - 80}, ${mapX + 520} ${mapY + 420}, ${mapX + mapW} ${mapY + 80}" fill="none" stroke="${warm}" stroke-width="8" opacity="0.78"/><text x="${mapX}" y="${mapY}" font-family="${font}" font-size="30" font-weight="800" fill="${light}">Context gap</text>`,
    evidence: `<rect x="${mapX}" y="${mapY}" width="${mapW}" height="270" rx="24" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.18)" /><text x="${mapX + 36}" y="${mapY + 64}" font-family="${font}" font-size="30" font-weight="800" fill="${light}">Evidence scan</text><text x="${mapX + 36}" y="${mapY + 125}" font-family="${font}" font-size="24" fill="rgba(255,255,255,0.72)">source fingerprints + provenance</text><rect x="${mapX + 36}" y="${mapY + 168}" width="${mapW - 72}" height="44" rx="22" fill="${accent}" opacity="0.9" />`,
    terminal: `<rect x="${mapX}" y="${mapY}" width="${mapW}" height="290" rx="24" fill="#020617" stroke="rgba(255,255,255,0.18)" /><circle cx="${mapX + 40}" cy="${mapY + 40}" r="10" fill="${warm}" /><circle cx="${mapX + 72}" cy="${mapY + 40}" r="10" fill="${cool}" /><circle cx="${mapX + 104}" cy="${mapY + 40}" r="10" fill="${accent}" /><text x="${mapX + 40}" y="${mapY + 115}" font-family="SFMono-Regular, Menlo, monospace" font-size="30" fill="${light}">$ npx deltadotta</text><text x="${mapX + 40}" y="${mapY + 170}" font-family="SFMono-Regular, Menlo, monospace" font-size="25" fill="${accent}">preflight passed</text>`,
    map: `<g>${["Engineering Lead", "DevOps / Platform Engineer", "Software Engineer", "Product Designer", "QA Engineer"].map((role, i) => {
      const x = mapX + (i % 2) * (mapW / 2 + 28);
      const y = mapY + Math.floor(i / 2) * 92;
      return `<rect x="${x}" y="${y}" width="${mapW / 2 - 28}" height="68" rx="16" fill="${i === 1 ? accent : "rgba(255,255,255,0.08)"}" stroke="rgba(255,255,255,0.18)" /><text x="${x + 24}" y="${y + 43}" font-family="${font}" font-size="23" font-weight="800" fill="${i === 1 ? dark : light}">${esc(role)}</text>`;
    }).join("")}</g>`,
    package: `<rect x="${mapX}" y="${mapY}" width="${mapW}" height="308" rx="24" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.18)" /><text x="${mapX + 36}" y="${mapY + 62}" font-family="${font}" font-size="30" font-weight="800" fill="${light}">Launchpad package</text>${["role skills", "provider context", "preflight report", "portable ZIP"].map((item, i) => `<text x="${mapX + 46}" y="${mapY + 120 + i * 42}" font-family="${font}" font-size="26" fill="${light}">✓ ${esc(item)}</text>`).join("")}`,
    cta: `<circle cx="${mapX + mapW / 2}" cy="${mapY + 100}" r="${vertical ? 150 : 190}" fill="${accent}" opacity="0.9" /><text x="${mapX + mapW / 2}" y="${mapY + 112}" text-anchor="middle" font-family="${font}" font-size="${vertical ? 44 : 54}" font-weight="900" fill="${dark}">npx</text>`,
  }[scene.mode];

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${dark}" />
      <stop offset="0.58" stop-color="#172033" />
      <stop offset="1" stop-color="#05070d" />
    </linearGradient>
    <radialGradient id="spot" cx="68%" cy="22%" r="58%">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.24" />
      <stop offset="1" stop-color="${accent}" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)" />
  <rect width="${w}" height="${h}" fill="url(#spot)" />
  ${orbital}
  <circle cx="${vertical ? w * 0.88 : w * 0.72}" cy="${vertical ? h * 0.18 : h * 0.15}" r="${ring}" fill="none" stroke="${accent}" stroke-width="2" opacity="0.12" />
  <circle cx="${vertical ? w * 0.88 : w * 0.72}" cy="${vertical ? h * 0.18 : h * 0.15}" r="${ring * 0.64}" fill="none" stroke="${warm}" stroke-width="2" opacity="0.13" />
  <text x="${pad}" y="${vertical ? 105 : 95}" font-family="${font}" font-size="${vertical ? 30 : 25}" font-weight="900" fill="${accent}">${esc(scene.kicker)}</text>
  ${textBlock(headline, pad, contentY, headlineSize, light, 920, 1.06)}
  ${textBlock(body, pad, contentY + headline.length * headlineSize * 1.06 + 54, bodySize, "rgba(255,255,255,0.74)", 560, 1.32)}
  ${codeRows(scene.code, codeX, codeY, codeW, accent, light, vertical)}
  ${modePanel}
  <text x="${pad}" y="${h - 70}" font-family="${font}" font-size="${vertical ? 25 : 22}" font-weight="800" fill="rgba(255,255,255,0.52)">DeltaDotta · portable AI operating roles · ${String(index + 1).padStart(2, "0")}</text>
</svg>`;
}

async function run(command, args) {
  await exec(command, args, { cwd: fileURLToPath(root), maxBuffer: 1024 * 1024 * 20 });
}

async function build(video, browser) {
  const dir = new URL(`${video.slug}/`, work);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const inputs = [];
  const page = await browser.newPage({ viewport: { width: video.width, height: video.height }, deviceScaleFactor: 1 });
  for (let i = 0; i < video.scenes.length; i += 1) {
    const svg = new URL(`scene-${i}.svg`, dir);
    const png = new URL(`scene-${i}.png`, dir);
    await writeFile(svg, sceneSvg(video, video.scenes[i], i));
    await page.setContent(`<body style="margin:0;background:#000">${await (await import("node:fs/promises")).readFile(svg, "utf8")}</body>`);
    await page.screenshot({ path: fileURLToPath(png), fullPage: false });
    inputs.push(png);
  }
  await page.close();

  const list = new URL("concat.txt", dir);
  await writeFile(list, inputs.map((input) => `file '${fileURLToPath(input)}'\nduration ${video.sceneSeconds}`).join("\n") + `\nfile '${fileURLToPath(inputs.at(-1))}'\n`);

  const mp4 = new URL(`${video.slug}.mp4`, demos);
  const gif = new URL(`${video.slug}.gif`, demos);
  const poster = new URL(`${video.slug}-poster.png`, demos);
  const filters = [
    `fps=${video.fps}`,
    `scale=${video.width}:${video.height}:flags=lanczos`,
    "format=yuv420p",
  ].join(",");

  await run(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", fileURLToPath(list), "-vf", filters, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", fileURLToPath(mp4)]);
  await run(ffmpeg, ["-y", "-ss", "0.2", "-i", fileURLToPath(mp4), "-frames:v", "1", fileURLToPath(poster)]);

  const gifScale = video.height > video.width ? "540:-1" : "720:-1";
  await run(ffmpeg, ["-y", "-i", fileURLToPath(mp4), "-vf", `fps=10,scale=${gifScale}:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5`, "-loop", "0", fileURLToPath(gif)]);

  return { mp4, gif, poster };
}

await mkdir(work, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  for (const video of videos) {
    const output = await build(video, browser);
    console.log(`${video.title}:`);
    console.log(`  ${fileURLToPath(output.mp4)}`);
    console.log(`  ${fileURLToPath(output.gif)}`);
    console.log(`  ${fileURLToPath(output.poster)}`);
  }
} finally {
  await browser.close();
}
