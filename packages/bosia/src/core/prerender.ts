import { writeFileSync, mkdirSync, cpSync, existsSync, readFileSync } from "fs";
import { createServer } from "net";
import { join } from "path";
import type { RouteManifest, TrailingSlash } from "./types.ts";

import { BOSIA_NODE_PATH, OUT_DIR } from "./paths.ts";
import { currentBase } from "./appBase.ts";
import { prerenderSkipReason, wantsPrerender } from "./scanner.ts";

/** Acquire an OS-assigned ephemeral port. Tiny TOCTOU race window; acceptable for build-time use. */
export function getEphemeralPort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.unref();
		srv.on("error", reject);
		srv.listen(0, "127.0.0.1", () => {
			const addr = srv.address();
			if (!addr || typeof addr === "string") {
				srv.close();
				reject(new Error("Failed to acquire ephemeral port"));
				return;
			}
			const port = addr.port;
			srv.close(() => resolve(port));
		});
	});
}

const CORE_DIR = import.meta.dir;

/**
 * True when the app's wrangler config serves `404.html` for unknown paths
 * (`not_found_handling: "404-page"`) and `public/404.html` doesn't provide one,
 * so a failed 404 probe must fail the build. Reads the text, skipping whole-line
 * `//` and `#` comments; a block comment around the key still counts.
 */
export function needsStatic404(cwd = process.cwd()): boolean {
	if (existsSync(join(cwd, "public", "404.html"))) return false;
	for (const name of ["wrangler.jsonc", "wrangler.json", "wrangler.toml"]) {
		const file = join(cwd, name);
		if (!existsSync(file)) continue;
		const text = readFileSync(file, "utf-8")
			.split("\n")
			.filter((line) => !/^\s*(\/\/|#)/.test(line))
			.join("\n");
		return /not_found_handling"?\s*[:=]\s*"404-page"/.test(text);
	}
	return false;
}

const PRERENDER_TIMEOUT = Number(process.env.PRERENDER_TIMEOUT) || 5_000; // 5s default
const PRERENDER_CONCURRENCY = Number(process.env.PRERENDER_CONCURRENCY) || 6;

// ─── Prerendering ─────────────────────────────────────────

interface PrerenderTarget {
	path: string;
	kind: "page" | "api";
	/** Page targets only; APIs always write a single `.json` file regardless of slash mode. */
	trailingSlash: TrailingSlash;
}

// ─── Pure helpers (exported for tests) ────────────────────

/**
 * Substitute `[param]` and `[...rest]` placeholders in a route pattern with
 * concrete values from an `entries()` record.
 */
export function substituteParams(pattern: string, entry: Record<string, string>): string {
	let resolved = pattern;
	for (const [key, value] of Object.entries(entry)) {
		// `..` and `\` are never legitimate in a route segment — they let a build
		// emit prerendered HTML outside the intended output tree. Forward slashes
		// are only allowed for catch-all (`[...key]`) segments, which by design
		// expand to multiple path parts. Validate accordingly.
		const isRest = pattern.includes(`[...${key}]`);
		if (/\\|\.\./.test(value) || (!isRest && value.includes("/"))) {
			throw new Error(
				`Prerender entries(): unsafe value "${value}" for [${key}] — ` +
					`path traversal characters are not allowed in dynamic segment values.`,
			);
		}
		resolved = resolved.replace(`[...${key}]`, value);
		resolved = resolved.replace(`[${key}]`, value);
	}
	return resolved;
}

/**
 * Canonical URL to fetch during prerender, based on trailing-slash mode.
 * Avoids hitting the server's 308 redirect mid-prerender.
 */
export function canonicalRouteFor(routePath: string, ts: TrailingSlash): string {
	if (routePath === "/") return "/";
	if (ts === "always") return routePath.endsWith("/") ? routePath : routePath + "/";
	return routePath.replace(/\/$/, "");
}

/**
 * Output HTML filename for a prerendered route. Strategy follows trailing-slash
 * mode so static hosts serve the right file on direct URL hits.
 */
export function prerenderOutPath(routePath: string, ts: TrailingSlash): string {
	if (routePath === "/") return `${OUT_DIR}/prerendered/index.html`;
	if (ts === "never") return `${OUT_DIR}/prerendered${routePath.replace(/\/$/, "")}.html`;
	return `${OUT_DIR}/prerendered${routePath.replace(/\/$/, "")}/index.html`;
}

/** Data-payload filename for a prerendered route — matches client `dataUrl()`. */
export function prerenderDataPath(routePath: string): string {
	return routePath === "/" ? "/index.json" : `${routePath.replace(/\/$/, "")}.json`;
}

/**
 * Output filename for a prerendered API route. Always emits a single `.json`
 * file at the route's path (no trailing-slash variants — static hosts serve
 * `/api/foo.json` regardless of the request URL's slash).
 */
export function prerenderApiOutPath(routePath: string): string {
	return `${OUT_DIR}/prerendered${routePath.replace(/\/$/, "")}.json`;
}

/** Dynamic route → import module, call entries(), expand to concrete targets. */
async function expandDynamicRoute(
	pattern: string,
	filePath: string,
	kind: "page" | "api",
	ts: TrailingSlash,
): Promise<PrerenderTarget[]> {
	try {
		const mod = await import(join(process.cwd(), filePath));
		if (typeof mod.entries !== "function") {
			console.warn(`   ⚠️  ${pattern} has prerender=true but no entries() export — skipped`);
			return [];
		}
		const entryList: Record<string, string>[] = await mod.entries();
		return entryList.map((entry) => ({
			path: substituteParams(pattern, entry),
			kind,
			trailingSlash: ts,
		}));
	} catch (err) {
		console.error(`   ❌ Failed to resolve entries() for ${pattern}:`, err);
		return [];
	}
}

async function detectPrerenderRoutes(manifest: RouteManifest): Promise<PrerenderTarget[]> {
	const pageTasks = manifest.pages.map(async (route): Promise<PrerenderTarget[]> => {
		if (!route.pageServer) return [];
		const filePath = join("src", "routes", route.pageServer);
		const content = await Bun.file(filePath).text();
		if (!wantsPrerender(content)) return [];
		const skip = prerenderSkipReason(content);
		if (skip) {
			console.warn(`   ⚠️  ${route.pattern} has prerender=true && ${skip}, skipped`);
			return [];
		}
		const ts = route.trailingSlash;
		if (route.pattern.includes("[")) return expandDynamicRoute(route.pattern, filePath, "page", ts);
		return [{ path: route.pattern, kind: "page", trailingSlash: ts }];
	});

	const apiTasks = manifest.apis.map(async (route): Promise<PrerenderTarget[]> => {
		const filePath = join("src", "routes", route.server);
		const content = await Bun.file(filePath).text();
		if (!wantsPrerender(content)) return [];
		if (route.pattern.includes("["))
			return expandDynamicRoute(route.pattern, filePath, "api", "never");
		return [{ path: route.pattern, kind: "api", trailingSlash: "never" }];
	});

	// Unbounded Promise.all over all routes; each task holds only small text reads
	// and route metadata, so RAM stays trivial. Chunk it if route counts ever hit
	// tens of thousands (open file descriptors would be the first limit).
	const results = await Promise.all([...pageTasks, ...apiTasks]);
	return results.flat();
}

export async function prerenderStaticRoutes(manifest: RouteManifest): Promise<void> {
	const targets = await detectPrerenderRoutes(manifest);
	if (targets.length === 0) return;

	console.log(`\n🖨️  Prerendering ${targets.length} route(s)...`);

	const port = await getEphemeralPort();
	// No BOSIA_REUSE_PORT: the child must fail to bind rather than share a port
	// with another server, whose pages we'd then save as ours. The ready loop
	// stops once the child exits, so a foreign /_health never passes for it.
	const { BOSIA_REUSE_PORT: _, ...env } = process.env;
	const child = Bun.spawn(["bun", "run", `${OUT_DIR}/server/index.js`], {
		env: {
			...env,
			NODE_ENV: "production",
			PORT: String(port),
			NODE_PATH: BOSIA_NODE_PATH,
		},
		stdout: "ignore",
		// Show render errors (a throwing +error.svelte, a crashing loader).
		stderr: "inherit",
	});

	const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
	let receivedSignal: NodeJS.Signals | null = null;
	const onSignal = (sig: NodeJS.Signals) => {
		receivedSignal = sig;
	};
	for (const sig of signals) process.once(sig, onSignal);

	try {
		// Poll /_health until ready (max 10s). Check first, sleep only on failure —
		// avoids a guaranteed floor when the server is already up.
		// The child inherits BASE_PATH, so it 404s anything outside the mount —
		// including /_health. Prefix here and every fetch below follows; the files
		// we write stay app-space, which is what the server looks them up by.
		const base = `http://localhost:${port}${currentBase()}`;
		let ready = false;
		const deadline = Date.now() + 10_000;
		while (Date.now() < deadline && child.exitCode === null) {
			try {
				const res = await fetch(`${base}/_health`);
				if (res.ok) {
					ready = true;
					break;
				}
			} catch {
				/* not ready yet */
			}
			await Bun.sleep(50);
		}

		if (!ready || child.exitCode !== null) {
			console.error(`❌ Prerender server failed to start (exit code ${child.exitCode ?? "none"})`);
			return;
		}

		mkdirSync(`${OUT_DIR}/prerendered`, { recursive: true });

		const prerenderOne = async ({
			path: routePath,
			kind,
			trailingSlash: ts,
		}: PrerenderTarget): Promise<void> => {
			try {
				if (kind === "api") {
					// APIs: fetch the bare route URL, write body to `<path>.json`.
					const res = await fetch(`${base}${routePath.replace(/\/$/, "")}`, {
						signal: AbortSignal.timeout(PRERENDER_TIMEOUT),
					});
					const body = await res.text();
					const outPath = prerenderApiOutPath(routePath);
					mkdirSync(outPath.substring(0, outPath.lastIndexOf("/")), { recursive: true });
					writeFileSync(outPath, body);
					console.log(`   ✅ ${routePath} → ${outPath}`);
					return;
				}

				// Hit the canonical URL so the server doesn't 308 us mid-prerender
				const canonicalRoute = canonicalRouteFor(routePath, ts);

				const res = await fetch(`${base}${canonicalRoute}`, {
					signal: AbortSignal.timeout(PRERENDER_TIMEOUT),
				});
				const html = await res.text();

				// Filename strategy:
				//   never  → about.html        (canonical /about, served by static host as /about → about.html)
				//   always → about/index.html  (canonical /about/, static host serves /about/ → about/index.html)
				//   ignore → about/index.html  (single emit; both URLs resolve via server canonicalize=off)
				//   root   → index.html
				const outPath = prerenderOutPath(routePath, ts);
				mkdirSync(outPath.substring(0, outPath.lastIndexOf("/")), { recursive: true });
				writeFileSync(outPath, html);

				// Also prerender the data payload (filename matches dataUrl() — strips trailing slash)
				const dataPath = prerenderDataPath(routePath);
				const dataRes = await fetch(`${base}/__bosia/data${dataPath}`, {
					signal: AbortSignal.timeout(PRERENDER_TIMEOUT),
				});
				if (dataRes.ok) {
					const dataJson = await dataRes.text();
					const dataOutPath = `${OUT_DIR}/prerendered/__bosia/data${dataPath}`;
					mkdirSync(dataOutPath.substring(0, dataOutPath.lastIndexOf("/")), {
						recursive: true,
					});
					writeFileSync(dataOutPath, dataJson);
					console.log(`   ✅ ${routePath} → ${outPath} (+ data)`);
				} else {
					console.log(`   ✅ ${routePath} → ${outPath}`);
				}
			} catch (err) {
				if (err instanceof DOMException && err.name === "TimeoutError") {
					console.error(
						`   ❌ Prerender timed out for ${routePath} after ${PRERENDER_TIMEOUT / 1000}s — increase PRERENDER_TIMEOUT to raise the limit`,
					);
				} else {
					console.error(`   ❌ Failed to prerender ${routePath}:`, err);
				}
			}
		};

		// Bounded worker pool: N workers pull from a shared index until targets drain.
		let next = 0;
		const worker = async () => {
			while (next < targets.length) {
				const target = targets[next++];
				if (target) await prerenderOne(target);
			}
		};
		await Promise.all(
			Array.from({ length: Math.min(PRERENDER_CONCURRENCY, targets.length) }, worker),
		);

		// Static hosts (Cloudflare assets) serve index.html with a 200 for unknown
		// paths unless a 404.html exists. Save the server's own 404 page while it's up.
		// Goes to dist/static, not prerendered/, so the Bun server doesn't route /404
		// to it. Static hosts still serve /404 and /404.html with a 200; no file name
		// avoids that. A public/404.html overwrites it (generateStaticSite copies later).
		// One probe, one locale: add per-locale probe paths (e.g. /id/404.html) when asked.
		try {
			const res = await fetch(`${base}/__bosia-404-probe`, {
				signal: AbortSignal.timeout(PRERENDER_TIMEOUT),
			});
			if (res.status !== 404) throw new Error(`expected a 404 page, got ${res.status}`);
			mkdirSync(`${OUT_DIR}/static`, { recursive: true });
			writeFileSync(`${OUT_DIR}/static/404.html`, await res.text());
			console.log(`   ✅ 404 page → ${OUT_DIR}/static/404.html`);
		} catch (err) {
			// Only a deploy that serves 404.html needs it; elsewhere (an app whose
			// hooks redirect every request) a missing one is fine, so just warn.
			const reason = (err as Error).message;
			if (needsStatic404())
				throw new Error(
					`404.html could not be built (${reason}), but wrangler sets ` +
						`not_found_handling "404-page". Make unknown paths answer 404, or add public/404.html.`,
				);
			console.warn(`   ⚠️  404.html skipped: ${reason}`);
		}

		console.log("✅ Prerendering complete");
	} finally {
		for (const sig of signals) process.off(sig, onSignal);
		child.kill();
		await child.exited;
		if (receivedSignal) {
			// Re-raise so parent exit code is 128+signum (standard Unix convention)
			process.kill(process.pid, receivedSignal);
		}
	}
}

// ─── Static Site Output ──────────────────────────────────

export function generateStaticSite(): void {
	const hasPublic = existsSync("./public");
	const hasPrerender = existsSync(`${OUT_DIR}/prerendered`);

	// Mirror `public/` → `dist/static/` on every build (not only SSG builds) so
	// production containers can ship dist/ alone. Without this, apps with zero
	// prerendered routes (pure SSR) would lose favicons and other public assets
	// when public/ is dropped from the image. (bosia-tw-<hash>.css lives in
	// dist/client/ and is served from the client walk, no mirror needed.)
	if (!hasPublic && !hasPrerender) {
		console.log("\n⏭️  No public/ or prerendered pages — skipping static site output");
		return;
	}

	console.log("\n📦 Generating static site...");
	mkdirSync(`${OUT_DIR}/static`, { recursive: true });

	// 1. Public assets (favicon, etc.) — preserves absolute /... paths
	if (hasPublic) {
		cpSync("./public", `${OUT_DIR}/static`, { recursive: true });
	}

	// 2. HTML files from prerendering (SSG output only)
	if (hasPrerender) {
		cpSync(`${OUT_DIR}/prerendered`, `${OUT_DIR}/static`, { recursive: true });
		// 3. Client JS/CSS — preserves /dist/client/... absolute paths used in HTML
		cpSync(`${OUT_DIR}/client`, `${OUT_DIR}/static/dist/client`, { recursive: true });
	}

	console.log(`✅ Static site generated: ${OUT_DIR}/static/`);
}
