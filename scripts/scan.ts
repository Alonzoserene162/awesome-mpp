/**
 * Weekly scan for new MPP ecosystem projects on GitHub and npm.
 * Outputs a report of repos/packages not yet in README.md.
 * Run: bun scripts/scan.ts
 */

const README_PATH = new URL("../README.md", import.meta.url).pathname;

async function getExistingUrls(): Promise<Set<string>> {
  const content = await Bun.file(README_PATH).text();
  const urls = new Set<string>();
  // Extract all GitHub URLs from the README
  const matches = content.matchAll(/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/g);
  for (const m of matches) {
    urls.add(m[0].toLowerCase());
  }
  // Extract npm package names
  const npmMatches = content.matchAll(/npmjs\.com\/package\/([^\s)]+)/g);
  for (const m of npmMatches) {
    urls.add(`npm:${m[1].toLowerCase()}`);
  }
  return urls;
}

interface RepoResult {
  fullName: string;
  description: string;
  stars: number;
  url: string;
  updatedAt: string;
}

async function searchGitHub(query: string): Promise<RepoResult[]> {
  const res = await fetch(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=updated&per_page=30`,
    {
      headers: {
        Accept: "application/vnd.github.v3+json",
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items ?? []).map((r: any) => ({
    fullName: r.full_name,
    description: r.description ?? "",
    stars: r.stargazers_count,
    url: r.html_url,
    updatedAt: r.updated_at,
  }));
}

interface NpmResult {
  name: string;
  description: string;
  version: string;
}

async function searchNpm(query: string): Promise<NpmResult[]> {
  const res = await fetch(
    `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=30`,
    { signal: AbortSignal.timeout(15_000) }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.objects ?? []).map((o: any) => ({
    name: o.package.name,
    description: o.package.description ?? "",
    version: o.package.version,
  }));
}

async function main() {
  console.log("[scan] Loading existing entries from README.md...");
  const existing = await getExistingUrls();
  console.log(`[scan] Found ${existing.size} existing URLs/packages\n`);

  // GitHub searches
  const ghQueries = [
    "mpp payment",
    "machine payments protocol",
    "mppx",
    "tempo payment blockchain",
    "stripe mpp",
    "mpp agent",
    "mpp-sdk",
    "mpp middleware",
  ];

  const newRepos: RepoResult[] = [];
  for (const q of ghQueries) {
    console.log(`[scan] GitHub: "${q}"...`);
    const results = await searchGitHub(q);
    for (const r of results) {
      const key = `github.com/${r.fullName}`.toLowerCase();
      if (!existing.has(key) && !newRepos.some((n) => n.fullName === r.fullName)) {
        newRepos.push(r);
      }
    }
    await Bun.sleep(1500); // Rate limit courtesy
  }

  // npm searches
  const npmQueries = ["mppx", "mpp payment", "tempo payment", "machine payments"];
  const newPkgs: NpmResult[] = [];
  for (const q of npmQueries) {
    console.log(`[scan] npm: "${q}"...`);
    const results = await searchNpm(q);
    for (const r of results) {
      const key = `npm:${r.name.toLowerCase()}`;
      if (!existing.has(key) && !newPkgs.some((n) => n.name === r.name)) {
        newPkgs.push(r);
      }
    }
    await Bun.sleep(500);
  }

  // Report
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[scan] NEW REPOS NOT IN README (${newRepos.length}):`);
  console.log(`${"=".repeat(60)}`);
  // Sort by stars descending
  newRepos.sort((a, b) => b.stars - a.stars);
  for (const r of newRepos) {
    console.log(`  ${r.stars}* ${r.fullName}`);
    console.log(`     ${r.description.slice(0, 120)}`);
    console.log(`     ${r.url}`);
    console.log();
  }

  console.log(`${"=".repeat(60)}`);
  console.log(`[scan] NEW NPM PACKAGES NOT IN README (${newPkgs.length}):`);
  console.log(`${"=".repeat(60)}`);
  for (const p of newPkgs) {
    console.log(`  ${p.name}@${p.version}`);
    console.log(`     ${p.description.slice(0, 120)}`);
    console.log();
  }

  // Write report to file for review
  const report = {
    scanned_at: new Date().toISOString(),
    new_repos: newRepos.map((r) => ({
      name: r.fullName,
      description: r.description,
      stars: r.stars,
      url: r.url,
    })),
    new_packages: newPkgs.map((p) => ({
      name: p.name,
      description: p.description,
      version: p.version,
    })),
  };

  const reportPath = new URL("../SCAN-REPORT.json", import.meta.url).pathname;
  await Bun.write(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n[scan] Report written to SCAN-REPORT.json`);
  console.log(`[scan] Review and add relevant projects to README.md`);
}

main().catch((e) => {
  console.error("[scan] Fatal:", e);
  process.exit(1);
});
