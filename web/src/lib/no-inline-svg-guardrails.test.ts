import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_SOURCE_ROOT = path.resolve(process.cwd(), "src/app");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const INLINE_SVG_ALLOWLIST = new Set([
  path.resolve(process.cwd(), "src/app/components/BrandMark.tsx"),
  path.resolve(process.cwd(), "src/app/classes/[classId]/blueprint/BlueprintEditor.tsx"),
]);

function collectSourceFiles(directoryPath: string): string[] {
  const entries = readdirSync(directoryPath);
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry);
    const entryStats = statSync(entryPath);

    if (entryStats.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
      continue;
    }

    const extension = path.extname(entryPath);
    if (!SOURCE_EXTENSIONS.has(extension)) {
      continue;
    }

    if (entryPath.endsWith(".test.ts") || entryPath.endsWith(".test.tsx")) {
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

describe("inline svg guardrails", () => {
  it("allows inline svg only in approved files", () => {
    const sourceFiles = collectSourceFiles(APP_SOURCE_ROOT);
    const violations: string[] = [];

    for (const filePath of sourceFiles) {
      const source = readFileSync(filePath, "utf8");
      if (!source.includes("<svg")) {
        continue;
      }

      if (INLINE_SVG_ALLOWLIST.has(filePath)) {
        continue;
      }

      violations.push(`${path.relative(process.cwd(), filePath)} contains inline <svg>`);
    }

    expect(violations).toEqual([]);
  });
});
