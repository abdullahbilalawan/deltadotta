import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const ffmpeg = "/opt/homebrew/bin/ffmpeg";
const { chromium } = await import(
  "file:///Users/muhammadabdullahbilal/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"
);
const sourceB = "docs/demos/higgsfield-sources/deltadotta-higgsfield-source-launchpad-core.mp4";
const outDir = "docs/demos";
const tmpDir = "docs/demos/higgsfield-edits";

const font = "Helvetica Neue";

const videos = [
  {
    slug: "deltadotta-higgsfield-premium-campaign",
    size: "1280x720",
    scale: "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720",
    duration: 32,
    sources: [sourceB, sourceB, sourceB, sourceB],
    lines: [
      [0.2, 4.4, "DeltaDotta", "Your repo already knows how the team works."],
      [4.6, 9.0, "Evidence In", "README.md  RUNBOOK.md  CODEOWNERS  AGENTS.md"],
      [9.2, 13.8, "Operating Map Out", "Engineering Lead  /  DevOps / Platform Engineer  /  QA Engineer"],
      [14.0, 18.6, "Preflighted Roles", "Give Codex and Claude a job, a lane, and an escalation path."],
      [18.8, 24.0, "Local-First Launchpad", "No mystery SaaS import. No vague context dump."],
      [24.2, 31.4, "DeltaDotta", "Turn messy team knowledge into portable AI operating roles.  npx deltadotta"],
    ],
  },
  {
    slug: "deltadotta-higgsfield-founder-cut",
    size: "1280x720",
    scale: "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720",
    duration: 24,
    sources: [sourceB, sourceB, sourceB],
    lines: [
      [0.2, 4.8, "The Agent Adoption Gap", "AI breaks down when team context is invisible."],
      [5.0, 10.4, "DeltaDotta Compiles The Operating Layer", "Owners. Handoffs. Escalation. Evidence."],
      [10.6, 16.2, "A Reviewable Package", "Role skills, provider context, confidence report, portable ZIP."],
      [16.4, 23.3, "Built For Real Teams", "Start with one safe first-shift role. Expand with proof."],
    ],
  },
  {
    slug: "deltadotta-higgsfield-social-reel",
    size: "1080x1920",
    scale: "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
    duration: 16,
    sources: [sourceB, sourceB],
    lines: [
      [0.2, 3.2, "DeltaDotta", "Messy repo knowledge"],
      [3.4, 6.8, "Becomes", "AI operating roles"],
      [7.0, 10.8, "With Boundaries", "Owners, handoffs, escalation"],
      [11.0, 15.5, "Run It", "npx deltadotta"],
    ],
  },
];

function escapeXml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
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

function overlaySvg(video, title, body) {
  const [w, h] = video.size.split("x").map(Number);
  const top = h > w ? 160 : 72;
  const subTop = h > w ? 340 : 168;
  const titleSize = h > w ? 88 : 58;
  const bodySize = h > w ? 44 : 32;
  const side = h > w ? 74 : 86;
  const titleLines = wrap(title, h > w ? 14 : 30);
  const bodyLines = wrap(body, h > w ? 24 : 58);
  const titleText = titleLines.map((line, index) => `<text x="${side}" y="${top + index * titleSize * 1.05}" font-family="${font}, Arial, sans-serif" font-size="${titleSize}" font-weight="900" fill="#f7f7f2">${escapeXml(line)}</text>`).join("");
  const bodyText = bodyLines.map((line, index) => `<text x="${side}" y="${subTop + index * bodySize * 1.25}" font-family="${font}, Arial, sans-serif" font-size="${bodySize}" font-weight="650" fill="#d7f99a">${escapeXml(line)}</text>`).join("");
  const brandY = h - (h > w ? 86 : 54);
  const panelH = h > w ? 430 : 255;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#05070a" stop-opacity="0.78"/>
      <stop offset="0.55" stop-color="#05070a" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#05070a" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${w}" height="${panelH}" fill="url(#shade)"/>
  <rect x="0" y="${h - 132}" width="${w}" height="132" fill="#05070a" opacity="0.45"/>
  ${titleText}
  ${bodyText}
  <text x="${side}" y="${brandY}" font-family="${font}, Arial, sans-serif" font-size="${h > w ? 34 : 24}" font-weight="800" fill="#f7f7f2" opacity="0.68">DeltaDotta · portable AI operating roles</text>
</svg>`;
}

async function run(args) {
  await exec(ffmpeg, args, { maxBuffer: 1024 * 1024 * 30 });
}

async function renderOverlay(browser, video, index, title, body) {
  const [w, h] = video.size.split("x").map(Number);
  const svgPath = `${tmpDir}/${video.slug}-overlay-${index}.svg`;
  const pngPath = `${tmpDir}/${video.slug}-overlay-${index}.png`;
  await writeFile(svgPath, overlaySvg(video, title, body));
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:transparent">${await (await import("node:fs/promises")).readFile(svgPath, "utf8")}</body>`);
  await page.screenshot({ path: pngPath, omitBackground: true });
  await page.close();
  return pngPath;
}

async function build(browser, video) {
  await mkdir(tmpDir, { recursive: true });
  const list = `${tmpDir}/${video.slug}.txt`;
  await writeFile(list, video.sources.map((source) => `file '../../../${source}'`).join("\n") + "\n");
  const overlays = [];
  for (let i = 0; i < video.lines.length; i += 1) {
    const [, , title, body] = video.lines[i];
    overlays.push(await renderOverlay(browser, video, i, title, body));
  }

  const mp4 = `${outDir}/${video.slug}.mp4`;
  const gif = `${outDir}/${video.slug}.gif`;
  const poster = `${outDir}/${video.slug}-poster.png`;
  const inputArgs = overlays.flatMap((overlay) => ["-i", overlay]);
  const overlayFilters = video.lines.map(([start, end], index) => {
    const input = index === 0 ? "base" : `v${index}`;
    const output = index === video.lines.length - 1 ? "outv" : `v${index + 1}`;
    return `[${input}][${index + 1}:v]overlay=0:0:enable='between(t,${start},${end})'[${output}]`;
  }).join(";");
  const filter = `[0:v]${video.scale},eq=contrast=1.08:saturation=1.08:brightness=-0.02,vignette=PI/5[base];${overlayFilters};[outv]format=yuv420p[v]`;

  await run([
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", list,
    ...inputArgs,
    "-t", String(video.duration),
    "-filter_complex", filter,
    "-map", "[v]",
    "-an",
    "-c:v", "libx264",
    "-crf", "18",
    "-preset", "medium",
    "-movflags", "+faststart",
    mp4,
  ]);

  await run(["-y", "-ss", "0.8", "-i", mp4, "-frames:v", "1", poster]);
  const gifScale = video.size === "1080x1920" ? "360:-1" : "520:-1";
  await run([
    "-y",
    "-i", mp4,
    "-vf", `fps=6,scale=${gifScale}:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5`,
    "-loop", "0",
    gif,
  ]);

  console.log(mp4);
}

await mkdir(tmpDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  for (const video of videos) {
    await build(browser, video);
  }
} finally {
  await browser.close();
}
