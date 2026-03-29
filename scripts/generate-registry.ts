#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const README_PATH = join(ROOT, "README.md");
const OUTPUT_PATH = join(ROOT, "registry.json");

const SKIP_SECTIONS = new Set([
  "Contents",
  "What is MPP?",
  "Keywords",
  "Contributing",
  "License",
]);

interface Project {
  name: string;
  url?: string;
  description: string;
  package?: string;
  type: "github" | "npm" | "external" | "proxied";
}

interface Subcategory {
  name: string;
  projects: Project[];
}

interface Category {
  name: string;
  subcategories: Subcategory[];
}

function detectType(url: string): "github" | "npm" | "external" {
  if (url.includes("github.com")) return "github";
  if (url.includes("npmjs.com")) return "npm";
  return "external";
}

function extractPackageCmd(text: string): string | undefined {
  const match = text.match(/`(npm i\s+\S+|pip install\s+\S+|cargo add\s+\S+|gem install\s+\S+|go get\s+\S+|npx\s+\S+)`/);
  return match ? match[1] : undefined;
}

function parseListItem(line: string): Project | null {
  // Pattern: - [Name](URL) - Description
  const linkedMatch = line.match(/^-\s+\[([^\]]+)\]\(([^)]+)\)\s*[-–—]\s*(.+)/);
  if (linkedMatch) {
    const [, name, url, rest] = linkedMatch;
    // Clean description: remove badge images, trim
    const description = rest
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/`[^`]+`/g, (m) => {
        // Keep package commands in description but also extract separately
        return m;
      })
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\.\s*$/, "")
      .trim();

    const pkg = extractPackageCmd(rest);
    // Clean package command from description
    const cleanDesc = description
      .replace(/`(npm i\s+\S+|pip install\s+\S+|cargo add\s+\S+|gem install\s+\S+|go get\s+\S+|npx\s+\S+)`/g, "")
      .trim()
      .replace(/\.\s*$/, "")
      .trim();

    const project: Project = {
      name,
      url,
      description: cleanDesc,
      type: detectType(url),
    };
    if (pkg) project.package = pkg;
    return project;
  }

  // Pattern: - **Name** - Description (bold, no link)
  const boldMatch = line.match(/^-\s+\*\*([^*]+)\*\*\s*[-–—]\s*(.+)/);
  if (boldMatch) {
    const [, name, rest] = boldMatch;
    const description = rest
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\.\s*$/, "")
      .trim();

    const pkg = extractPackageCmd(rest);
    const cleanDesc = description
      .replace(/`(npm i\s+\S+|pip install\s+\S+|cargo add\s+\S+|gem install\s+\S+|go get\s+\S+|npx\s+\S+)`/g, "")
      .trim()
      .replace(/\.\s*$/, "")
      .trim();

    const project: Project = {
      name,
      description: cleanDesc,
      type: "external",
    };
    if (pkg) project.package = pkg;
    return project;
  }

  // Pattern: - **Name** / **Name** - import statement (framework integrations)
  const frameworkMatch = line.match(/^-\s+\*\*([^*]+)\*\*\s*[-–—]?\s*(.+)/);
  if (frameworkMatch) {
    const [, name, rest] = frameworkMatch;
    const description = rest
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\.\s*$/, "")
      .trim();

    return {
      name,
      description,
      type: "external",
    };
  }

  return null;
}

function parseProxiedServices(line: string): Project[] {
  // Lines like: **Category:** Name1, Name2, Name3
  const match = line.match(/^\*\*([^*]+):\*\*\s*(.+)/);
  if (!match) return [];

  const serviceNames = match[2].split(",").map((s) => s.trim()).filter(Boolean);
  return serviceNames.map((name) => {
    // Handle services with parenthetical notes like "Abstract APIs (12+ services)"
    return {
      name,
      description: `Proxied service available via mpp.tempo.xyz`,
      type: "proxied" as const,
    };
  });
}

function generate() {
  const readme = readFileSync(README_PATH, "utf-8");
  const lines = readme.split("\n");

  const categories: Category[] = [];
  let currentCategory: Category | null = null;
  let currentSubcategory: Subcategory | null = null;
  let inProxiedSection = false;
  let skipCurrent = false;

  for (const line of lines) {
    // ## Category heading
    if (line.startsWith("## ")) {
      const name = line.replace(/^##\s+/, "").trim();
      inProxiedSection = false;

      if (SKIP_SECTIONS.has(name)) {
        skipCurrent = true;
        currentCategory = null;
        currentSubcategory = null;
        continue;
      }

      skipCurrent = false;
      currentCategory = { name, subcategories: [] };
      // Create a default subcategory for items directly under the category
      currentSubcategory = { name: "General", projects: [] };
      categories.push(currentCategory);
      continue;
    }

    if (skipCurrent) continue;

    // ### Subcategory heading
    if (line.startsWith("### ")) {
      const name = line.replace(/^###\s+/, "").trim();
      if (currentCategory) {
        // Don't keep empty "General" subcategory
        if (
          currentSubcategory &&
          currentSubcategory.name === "General" &&
          currentSubcategory.projects.length === 0
        ) {
          // remove it if it was already added
          const idx = currentCategory.subcategories.indexOf(currentSubcategory);
          if (idx >= 0) currentCategory.subcategories.splice(idx, 1);
        }

        currentSubcategory = { name, projects: [] };
        currentCategory.subcategories.push(currentSubcategory);

        // Check if this is the proxied section
        if (name.toLowerCase().includes("proxied")) {
          inProxiedSection = true;
        } else {
          inProxiedSection = false;
        }
      }
      continue;
    }

    if (!currentCategory || !currentSubcategory) continue;

    // Proxied services: comma-separated bold lines
    if (inProxiedSection) {
      const proxied = parseProxiedServices(line);
      if (proxied.length > 0) {
        currentSubcategory.projects.push(...proxied);
        continue;
      }
    }

    // Regular list items
    if (line.startsWith("- ")) {
      // Make sure General subcategory is tracked
      if (
        currentSubcategory.name === "General" &&
        !currentCategory.subcategories.includes(currentSubcategory)
      ) {
        currentCategory.subcategories.push(currentSubcategory);
      }

      const project = parseListItem(line);
      if (project) {
        currentSubcategory.projects.push(project);
      }
    }
  }

  // Clean up: remove empty General subcategories
  for (const cat of categories) {
    cat.subcategories = cat.subcategories.filter((sc) => sc.projects.length > 0);
  }
  // Remove empty categories
  const finalCategories = categories.filter((c) => c.subcategories.length > 0);

  const totalProjects = finalCategories.reduce(
    (sum, cat) =>
      sum + cat.subcategories.reduce((s, sc) => s + sc.projects.length, 0),
    0
  );

  const registry = {
    generated_at: new Date().toISOString(),
    total_projects: totalProjects,
    categories: finalCategories,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(registry, null, 2) + "\n");
  console.log(
    `Registry generated: ${totalProjects} projects across ${finalCategories.length} categories`
  );
  console.log(`Output: ${OUTPUT_PATH}`);
}

generate();
