/**
 * Post-build script: generates sitemap.xml from content/docs/ markdown files
 * and 404.html from the built server. Writes both into dist/static.
 */

import { readdirSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { loadEnv } from "../../packages/bosia/src/core/env.ts";
import { BOSIA_NODE_PATH } from "../../packages/bosia/src/core/paths.ts";
import { getEphemeralPort } from "../../packages/bosia/src/core/prerender.ts";

const BASE_URL = "https://bosia.dev";
const contentDir = join(process.cwd(), "content", "docs");
const outDir = join(process.cwd(), "dist", "static");

type PageEntry = { slug: string; locale: "en" | "id" };

function scanPages(dir: string, prefix: string): PageEntry[] {
	const entries: PageEntry[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			entries.push(
				...scanPages(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name),
			);
		} else if (entry.name.endsWith(".md")) {
			const base = entry.name.replace(/\.md$/, "");
			const slug = base === "index" ? prefix : prefix ? `${prefix}/${base}` : base;
			if (!slug) continue; // skip root index (landing page added separately)
			const locale = slug.startsWith("id/") || slug === "id" ? "id" : "en";
			entries.push({ slug, locale });
		}
	}
	return entries;
}

function slugToUrl(slug: string, locale: "en" | "id"): string {
	if (locale === "id") return `${BASE_URL}/${slug}`;
	return slug === "" ? BASE_URL + "/" : `${BASE_URL}/${slug}`;
}

function stripLocale(slug: string): string {
	if (slug.startsWith("id/")) return slug.slice(3);
	if (slug === "id") return "";
	return slug;
}

// Collect all pages
const pages = scanPages(contentDir, "");

// Group EN and ID pages by their bare slug
const enPages = new Map<string, string>(); // bareSlug → full URL
const idPages = new Map<string, string>();

// Add landing pages
enPages.set("", `${BASE_URL}/`);
idPages.set("", `${BASE_URL}/id`);

for (const page of pages) {
	const bare = stripLocale(page.slug);
	const url = slugToUrl(page.slug, page.locale);
	if (page.locale === "id") {
		idPages.set(bare, url);
	} else {
		enPages.set(bare, url);
	}
}

// Build sitemap XML
const today = new Date().toISOString().split("T")[0];
let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n`;
xml += `        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n`;

// Emit all EN pages (with alternates if ID version exists)
for (const [bare, enUrl] of enPages) {
	xml += `  <url>\n`;
	xml += `    <loc>${enUrl}</loc>\n`;
	xml += `    <lastmod>${today}</lastmod>\n`;
	xml += `    <xhtml:link rel="alternate" hreflang="en" href="${enUrl}" />\n`;
	const idUrl = idPages.get(bare);
	if (idUrl) {
		xml += `    <xhtml:link rel="alternate" hreflang="id" href="${idUrl}" />\n`;
	}
	xml += `    <xhtml:link rel="alternate" hreflang="x-default" href="${enUrl}" />\n`;
	xml += `  </url>\n`;
}

// Emit ID-only pages (those without EN counterpart)
for (const [bare, idUrl] of idPages) {
	if (enPages.has(bare)) continue; // already emitted with EN
	xml += `  <url>\n`;
	xml += `    <loc>${idUrl}</loc>\n`;
	xml += `    <lastmod>${today}</lastmod>\n`;
	xml += `    <xhtml:link rel="alternate" hreflang="id" href="${idUrl}" />\n`;
	xml += `  </url>\n`;
}

xml += `</urlset>\n`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "sitemap.xml"), xml);
console.log(`✓ sitemap.xml written (${enPages.size + idPages.size} URLs)`);

// 404.html — without it Cloudflare serves index.html with a 200 for every unknown
// path, so broken links land on the home page silently. Capture the server's own
// 404 response so it matches what the dev and prod servers render. Starts the built
// server the way prerender does (free port, NODE_PATH, /_health). A failure only warns:
// the site still deploys, just without a real 404 page.
loadEnv("production");
const port = await getEphemeralPort();
// The server entry directly, not `bun run start`: the start CLI ignores SIGTERM.
// No BOSIA_REUSE_PORT, so it can't silently share a port with another server.
const { BOSIA_REUSE_PORT: _, ...env } = process.env;
const server = Bun.spawn(["bun", "run", "./dist/server/index.js"], {
	env: { ...env, NODE_ENV: "production", PORT: String(port), NODE_PATH: BOSIA_NODE_PATH },
	stdout: "ignore",
	stderr: "inherit",
});
try {
	// Wait for our server's /_health before trusting any 404: another process that
	// grabbed the port first would fail this, or the exit check if ours couldn't bind.
	let ready = false;
	for (let i = 0; i < 200 && !ready && server.exitCode === null; i++) {
		ready = (await fetch(`http://localhost:${port}/_health`).catch(() => null))?.ok ?? false;
		if (!ready) await Bun.sleep(100);
	}
	if (!ready || server.exitCode !== null)
		throw new Error(`docs server not ready (exit code ${server.exitCode ?? "none"})`);
	const res = await fetch(`http://localhost:${port}/__bosia-404-probe`);
	if (res.status !== 404) throw new Error(`expected a 404 page, got ${res.status}`);
	writeFileSync(join(outDir, "404.html"), await res.text());
	console.log("✓ 404.html written");
} catch (err) {
	console.warn(`⚠️  404.html skipped: ${(err as Error).message}`);
} finally {
	server.kill();
	await server.exited;
}
