import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { dirname, join } from "path";

import {
	describeError,
	getEphemeralPort,
	prerenderDataProblem,
	prerenderReplyProblem,
} from "../src/core/prerender.ts";
import { BOSIA_NODE_PATH } from "../src/core/paths.ts";

// Prerender against a real built server: what it saves is the server's reply, so the reply
// check and the 308 in front of saved pages can only be tested end to end. The pure rules
// live in prerender-entries.test.ts; rows that moved here say so there.
//
// Fixtures live under packages/bosia/ so svelte and the Tailwind binary resolve from this
// package's node_modules — same reason as basePath-server.test.ts.

const BUILD = join(import.meta.dir, "..", "src", "core", "build.ts");

/** Writes `files` (path → text) under a fresh app folder with the shared shell. */
function fixture(name: string, files: Record<string, string>): string {
	const dir = join(import.meta.dir, "..", `.tmp-prerender-${name}-${Date.now()}`);
	const all: Record<string, string> = {
		"tsconfig.json": JSON.stringify({ compilerOptions: { paths: {} } }),
		"src/app.css": `@import "tailwindcss";\n@source "../src";\n`,
		"src/app.html": `<!doctype html>\n<html lang="%bosia.lang%">\n<head>%bosia.head%</head>\n<body>%bosia.body%</body>\n</html>\n`,
		"src/routes/+page.svelte": "<h1>Home</h1>\n",
		...files,
	};
	for (const [file, text] of Object.entries(all)) {
		mkdirSync(dirname(join(dir, file)), { recursive: true });
		writeFileSync(join(dir, file), text);
	}
	return dir;
}

async function build(
	dir: string,
	env: Record<string, string> = {},
): Promise<{ code: number; out: string }> {
	const proc = Bun.spawn(["bun", "run", BUILD], {
		cwd: dir,
		env: { ...process.env, NODE_ENV: "production", NODE_PATH: BOSIA_NODE_PATH, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, out, err] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { code, out: `${out}\n${err}` };
}

const prerendered = (extra = "") => `export const prerender = true;\n${extra}`;
const slugs = (...values: string[]) =>
	`export const entries = () => ${JSON.stringify(values.map((slug) => ({ slug })))};\n`;

// ─── prerenderReplyProblem(): pure ────────────────────────

describe("prerenderReplyProblem()", () => {
	const res = (status: number, headers: Record<string, string> = {}) =>
		new Response(null, { status, headers });
	const HTML = { "content-type": "text/html; charset=utf-8" };

	test("a 200 HTML page is saved", () => {
		expect(prerenderReplyProblem("page", res(200, HTML))).toBeNull();
	});
	test("a page answering JSON is not", () => {
		expect(prerenderReplyProblem("page", res(200, { "content-type": "application/json" }))).toBe(
			"answered application/json, not an HTML page",
		);
	});
	test("a redirect names where it goes", () => {
		expect(prerenderReplyProblem("page", res(307, { location: "/login" }))).toBe(
			"answered 307 → /login",
		);
		expect(prerenderReplyProblem("api", res(308))).toBe("answered 308 → (no Location)");
	});
	test("an error status fails, even as HTML", () => {
		expect(prerenderReplyProblem("page", res(500, HTML))).toBe("answered 500");
		expect(prerenderReplyProblem("api", res(404))).toBe("answered 404");
	});
	test("an API may answer any 200 type", () => {
		expect(prerenderReplyProblem("api", res(200, { "content-type": "text/plain" }))).toBeNull();
	});
});

// The server answers a data request's redirect with a 200 JSON `{ redirect, status }`
// (server.ts data endpoint and handleRequest), so the status alone can't catch it.
describe("prerenderDataProblem()", () => {
	test("a loader payload is saved", () => {
		expect(prerenderDataProblem(`{"pageData":{"a":1},"layoutData":[],"metadata":null}`)).toBeNull();
	});
	test("a redirect payload names where it goes", () => {
		expect(prerenderDataProblem(`{"redirect":"/login","status":307}`)).toBe(
			"answered redirect 307 → /login",
		);
	});
	test("an error payload fails", () => {
		expect(prerenderDataProblem(`{"error":{"status":403,"message":"no"}}`)).toBe(
			"answered error 403",
		);
	});
	test("a body that isn't JSON fails", () => {
		expect(prerenderDataProblem("<h1>hi</h1>")).toBe("answered a body that isn't JSON");
	});
});

describe("describeError()", () => {
	test("adds the code and the cause a bare message hides", () => {
		const err = Object.assign(new Error("fetch failed", { cause: new Error("socket hang up") }), {
			code: "ECONNRESET",
		});
		expect(describeError(err)).toBe("fetch failed [ECONNRESET] (cause: socket hang up)");
	});
	test("doesn't repeat a code the message already has", () => {
		const err = Object.assign(new Error("EACCES: permission denied, open 'x'"), { code: "EACCES" });
		expect(describeError(err)).toBe("EACCES: permission denied, open 'x'");
	});
	test("a thrown non-Error is stringified", () => {
		expect(describeError("boom")).toBe("boom");
	});
});

// ─── A clean build: saved pages still 308 to the canonical slash ─

describe("a built server with prerendered pages", () => {
	let dir = "";
	let child: Bun.Subprocess | null = null;
	let origin = "";

	beforeAll(async () => {
		dir = fixture("ok", {
			"src/routes/always/[slug]/+page.svelte": "<h1>Always</h1>\n",
			"src/routes/always/[slug]/+page.server.ts": prerendered(
				`export const trailingSlash = "always";\n${slugs("one")}`,
			),
			"src/routes/about/+page.svelte": "<h1>About</h1>\n",
			"src/routes/about/+page.server.ts": prerendered(),
			// Moved from prerender-entries.test.ts: `.PNG` isn't a static ending (case-sensitive).
			"src/routes/blog/[slug]/+page.svelte": "<h1>Blog</h1>\n",
			"src/routes/blog/[slug]/+page.server.ts": prerendered(slugs("logo.PNG")),
		});
		const { code, out } = await build(dir);
		if (code !== 0) throw new Error(`build failed (${code})\n${out}`);

		const port = await getEphemeralPort();
		origin = `http://localhost:${port}`;
		child = Bun.spawn(["bun", "run", join(dir, "dist", "server", "index.js")], {
			cwd: dir,
			env: {
				...process.env,
				NODE_ENV: "production",
				PORT: String(port),
				NODE_PATH: BOSIA_NODE_PATH,
			},
			stdout: "ignore",
			stderr: "ignore",
		});
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			try {
				if ((await fetch(`${origin}/_health`)).ok) return;
			} catch {
				/* not up yet */
			}
			await Bun.sleep(50);
		}
		throw new Error("server never became ready");
	}, 180_000);

	afterAll(async () => {
		child?.kill();
		// Windows keeps the server's files locked until it has exited (EBUSY).
		await child?.exited;
		rmSync(dir, { recursive: true, force: true });
	});

	test("the pages were saved", () => {
		expect(existsSync(join(dir, "dist/prerendered/always/one/index.html"))).toBe(true);
		expect(existsSync(join(dir, "dist/prerendered/about.html"))).toBe(true);
		expect(existsSync(join(dir, "dist/prerendered/blog/logo.PNG.html"))).toBe(true);
	});

	test("an `always` page 308s to its slash form", async () => {
		const res = await fetch(`${origin}/always/one`, { redirect: "manual" });
		expect(res.status).toBe(308);
		expect(res.headers.get("location")).toBe("/always/one/");
	});

	test("a `never` page 308s to its slash-less form", async () => {
		const res = await fetch(`${origin}/about/`, { redirect: "manual" });
		expect(res.status).toBe(308);
		expect(res.headers.get("location")).toBe("/about");
	});

	test("the canonical forms are served from the saved file", async () => {
		for (const url of ["/always/one/", "/about", "/blog/logo.PNG"]) {
			const res = await fetch(`${origin}${url}`, { redirect: "manual" });
			expect(res.status).toBe(200);
			// Only the prerendered branch sets this; live SSR doesn't.
			expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
		}
	});
});

// ─── A failing build: every bad reply, one ❌ each ────────

describe("a build whose prerendered routes answer badly", () => {
	let dir = "";
	let result = { code: 0, out: "" };

	beforeAll(async () => {
		const loader = (body: string) =>
			prerendered(
				`import { error, redirect } from "bosia";\nexport function load() {\n\t${body};\n}\n`,
			);
		dir = fixture("bad", {
			"src/routes/boom/+page.svelte": "<h1>Boom</h1>\n",
			"src/routes/boom/+page.server.ts": loader(`error(500, "boom")`),
			"src/routes/gone/+page.svelte": "<h1>Gone</h1>\n",
			"src/routes/gone/+page.server.ts": loader(`error(404, "gone")`),
			"src/routes/private/+page.svelte": "<h1>Private</h1>\n",
			"src/routes/private/+page.server.ts": loader(`redirect(307, "/login")`),
			// Moved from prerender-entries.test.ts: static-file endings fetched as-is.
			"src/routes/blog/[slug]/+page.svelte": "<h1>Blog</h1>\n",
			"src/routes/blog/[slug]/+page.server.ts": prerendered(slugs("logo.png")),
			"public/blog/logo.png": "not really a png",
			"src/routes/[slug]/+page.svelte": "<h1>Slug</h1>\n",
			"src/routes/[slug]/+page.server.ts": prerendered(slugs("robots.txt")),
			"public/robots.txt": "User-agent: *\n",
			"src/routes/r/[slug]/+page.svelte": "<h1>R</h1>\n",
			"src/routes/r/[slug]/+page.server.ts": prerendered(
				`export const trailingSlash = "ignore";\n${slugs("robots.txt")}`,
			),
			// The page answers 200 HTML, but its data payload fails (a guard on data requests).
			"src/routes/nodata/+page.svelte": "<h1>No data</h1>\n",
			"src/routes/nodata/+page.server.ts": prerendered(),
			// The page answers 200 HTML, but a guard redirects its data request; the server
			// turns that into a 200 JSON `{ redirect }`, which must not be saved as its data.
			"src/routes/guarded/+page.svelte": "<h1>Guarded</h1>\n",
			"src/routes/guarded/+page.server.ts": prerendered(),
			"src/hooks.server.ts":
				`export const handle = async ({ event, resolve }: any) => {\n` +
				`\tif (event.isDataRequest && event.url.pathname === "/nodata")\n` +
				`\t\treturn new Response("nope", { status: 500 });\n` +
				`\tif (event.isDataRequest && event.url.pathname === "/guarded")\n` +
				`\t\treturn new Response(null, { status: 307, headers: { location: "/login" } });\n` +
				`\treturn resolve(event);\n};\n`,
			// `/[slug]` answers the 404 probe with a page, and wrangler needs 404.html: that
			// failure is listed with the pages, not thrown before them.
			"wrangler.toml": `not_found_handling = "404-page"\n`,
		});
		result = await build(dir);
	}, 180_000);

	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	test("exits 1 without claiming success", () => {
		expect(result.code).toBe(1);
		expect(result.out).not.toContain("Prerendering complete");
	});

	const EXPECT: [why: string, line: string][] = [
		["a loader error(500)", "❌ Prerender: /boom answered 500"],
		["a loader error(404)", "❌ Prerender: /gone answered 404"],
		["a loader redirect", "❌ Prerender: /private answered 307 → /login"],
		[
			"a slug that is a public/ image",
			"❌ Prerender: /blog/logo.png (from /blog/[slug]) answered image/png, not an HTML page",
		],
		[
			"a slug that is public/robots.txt",
			"❌ Prerender: /robots.txt (from /[slug]) answered text/plain",
		],
		[
			"a static-file slug with no file",
			"❌ Prerender: /r/robots.txt (from /r/[slug]) answered 404",
		],
		["a page whose data payload fails", "❌ Prerender: /nodata data answered 500"],
		[
			"a page whose data request redirects",
			"❌ Prerender: /guarded data answered redirect 307 → /login",
		],
		[
			"the 404 page wrangler needs",
			"❌ 404.html could not be built (expected a 404 page, got 200)",
		],
	];
	for (const [why, line] of EXPECT)
		test(`lists ${why}`, () => {
			const lines = result.out.split("\n").filter((l) => l.startsWith(line));
			expect(lines).toHaveLength(1);
		});

	test("saves none of them", () => {
		for (const file of [
			"boom.html",
			"gone.html",
			"private.html",
			"blog/logo.png.html",
			"nodata.html",
			"guarded.html",
		])
			expect(existsSync(join(dir, "dist/prerendered", file))).toBe(false);
	});
});

// ─── A server that can't start fails the build ───────────

test("a prerender server that crashes on boot fails the build", async () => {
	const dir = fixture("crash", {
		"src/routes/about/+page.svelte": "<h1>About</h1>\n",
		"src/routes/about/+page.server.ts": prerendered(),
		// A hook that fails to load only warns; exiting is what kills the server at boot.
		"src/hooks.server.ts": `process.exit(3);\nexport const handle = () => {};\n`,
	});
	try {
		const { code, out } = await build(dir);
		expect(code).toBe(1);
		expect(out).toContain("❌ Prerender server failed to start");
		expect(out).not.toContain("Static site generated");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 180_000);

// ─── PRERENDER_TIMEOUT is per request ─────────────────────

// The page and its data payload each run the loader. Each fetch gets its own timeout: a
// loader at 60% of the limit builds, though the two fetches together take longer.
test("a slow loader gets the timeout once per fetch, not once per page", async () => {
	const dir = fixture("slow", {
		"src/routes/slow/+page.svelte": "<h1>Slow</h1>\n",
		"src/routes/slow/+page.server.ts": prerendered(
			`export async function load() {\n\tawait Bun.sleep(1200);\n\treturn { ok: true };\n}\n`,
		),
	});
	try {
		const { code, out } = await build(dir, { PRERENDER_TIMEOUT: "2000" });
		expect(out).not.toContain("timed out");
		expect(code).toBe(0);
		expect(existsSync(join(dir, "dist/prerendered/__bosia/data/slow.json"))).toBe(true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 180_000);
