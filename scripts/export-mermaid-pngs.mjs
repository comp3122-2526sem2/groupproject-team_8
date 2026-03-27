#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPO_ROOT = process.cwd();
const OUTPUT_ROOT = path.join(REPO_ROOT, "docs", "mermaid-png");
const TEMP_ROOT = await mkdtemp(path.join(tmpdir(), "mermaid-export-"));

const HIGH_RES_WIDTH = 2400;
const HIGH_RES_SCALE = 4;
const BACKGROUND = "white";

const markdownFiles = [
  "ARCHITECTURE.md",
  "DEPLOYMENT.md",
  "DESIGN.md",
  "README.md",
  "UIUX.md",
  "backend/README.md",
  "supabase/README.md",
  "web/README.md",
];

function extractMermaidBlocks(markdown) {
  const mermaidFence = /```mermaid\r?\n([\s\S]*?)```/g;
  const blocks = [];

  for (const match of markdown.matchAll(mermaidFence)) {
    const content = match[1].trim();

    if (content) {
      blocks.push(content);
    }
  }

  return blocks;
}

function toOutputPath(markdownPath, index) {
  const parsed = path.parse(markdownPath);
  const relativeDir = parsed.dir || "root";
  const fileName = `${parsed.name}-diagram-${String(index).padStart(2, "0")}.png`;
  return path.join(OUTPUT_ROOT, relativeDir, fileName);
}

async function renderDiagram(source, output) {
  const tempInput = path.join(
    TEMP_ROOT,
    `${path.basename(output, ".png")}.mmd`,
  );

  await writeFile(tempInput, source, "utf8");
  await mkdir(path.dirname(output), { recursive: true });

  await execFileAsync("mmdc", [
    "-i",
    tempInput,
    "-o",
    output,
    "-w",
    String(HIGH_RES_WIDTH),
    "-s",
    String(HIGH_RES_SCALE),
    "-b",
    BACKGROUND,
  ]);
}

const manifest = [];

try {
  await rm(OUTPUT_ROOT, { recursive: true, force: true });

  for (const markdownPath of markdownFiles) {
    const absolutePath = path.join(REPO_ROOT, markdownPath);
    const markdown = await readFile(absolutePath, "utf8");
    const blocks = extractMermaidBlocks(markdown);

    for (const [blockIndex, block] of blocks.entries()) {
      const outputPath = toOutputPath(markdownPath, blockIndex + 1);
      await renderDiagram(block, outputPath);
      manifest.push({
        source: markdownPath,
        index: blockIndex + 1,
        output: path.relative(REPO_ROOT, outputPath),
      });
      console.log(`Rendered ${markdownPath}#${blockIndex + 1} -> ${path.relative(REPO_ROOT, outputPath)}`);
    }
  }

  await writeFile(
    path.join(OUTPUT_ROOT, "manifest.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        settings: {
          width: HIGH_RES_WIDTH,
          scale: HIGH_RES_SCALE,
          background: BACKGROUND,
        },
        diagrams: manifest,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`\nDone. Exported ${manifest.length} diagrams to ${path.relative(REPO_ROOT, OUTPUT_ROOT)}`);
} finally {
  await rm(TEMP_ROOT, { recursive: true, force: true });
}
