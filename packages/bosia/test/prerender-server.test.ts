import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { dirname, join } from "path";

import {
	describeError,
	getEphemeralPort,
	prerenderDataProblem,
	prerenderReplyProblem,
	prerenderSetting,
} from "../src/core/prerender.ts";
import { BOSIA_NODE_PATH } from "../src/core/paths.ts";

// Prerender against a real built server: what it saves is the server's reply, so the reply
// check and the 308 in front of saved pages can only be tested end to end. The pure rules
// live in prerender-entries.test.ts.
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
	test("any 2xx is saved, as before the reply check", () => {
		expect(prerenderReplyProblem("api", res(203))).toBeNull();
		expect(prerenderReplyProblem("page", res(203, HTML))).toBeNull();
	});
	test("the 404 probe wants a 404 HTML page", () => {
		expect(prerenderReplyProblem("page", res(404, HTML), 404)).toBeNull();
		expect(prerenderReplyProblem("page", res(200, HTML), 404)).toBe("answered 200");
		expect(prerenderReplyProblem("page", res(404, { "content-type": "text/plain" }), 404)).toBe(
			"answered text/plain, not an HTML page",
		);
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

// PRERENDER_TIMEOUT and PRERENDER_CONCURRENCY: a bad value would build zero workers (every page
// silently skipped) or make every fetch throw, so it fails the build instead.
describe("prerenderSetting()", () => {
	test("unset or blank gives the default", () => {
		expect(prerenderSetting(undefined, 6)).toBe(6);
		expect(prerenderSetting(" ", 6)).toBe(6);
	});
	test("a whole number from 1 up is kept", () => {
		expect(prerenderSetting("1", 6)).toBe(1);
		expect(prerenderSetting("30000", 5000)).toBe(30000);
		expect(prerenderSetting("2147483647", 5000)).toBe(2147483647);
	});
	test("anything else is null", () => {
		for (const raw of ["0", "-1", "0.5", "1.5", "Infinity", "abc", "2147483648", "1e12"])
			expect(prerenderSetting(raw, 6)).toBeNull();
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
	test("a plain-object cause shows its code and message, not [object Object]", () => {
		const err = new Error("fetch failed", { cause: { code: "ECONNREFUSED", message: "refused" } });
		expect(describeError(err)).toBe("fetch failed (cause: refused [ECONNREFUSED])");
		const bare = new Error("fetch failed", { cause: { code: "ECONNREFUSED" } });
		expect(describeError(bare)).toBe("fetch failed (cause: ECONNREFUSED)");
		expect(describeError(new Error("x", { cause: { n: 1 } }))).toBe(`x (cause: {"n":1})`);
	});
	test("an Error with no message shows its name; a number code or errno counts", () => {
		expect(describeError(new TypeError())).toBe("TypeError");
		expect(describeError(new Error("x", { cause: { errno: -54 } }))).toBe("x (cause: -54)");
		expect(describeError(Object.assign(new Error("read"), { code: 5 }))).toBe("read [5]");
	});
	test("a DOMException's legacy number code is left out", () => {
		const abort = new DOMException("The operation was aborted.", "AbortError");
		expect(abort.code).toBe(20);
		expect(describeError(abort)).toBe("The operation was aborted.");
	});
	test("a cause that points back at itself stops", () => {
		const err = new Error("loop");
		err.cause = err;
		expect(describeError(err)).toBe("loop (cause: loop (cause: loop (cause: loop)))");
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
			// Answers the 404 probe with a page (see wrangler.toml below).
			"src/routes/[slug]/+page.svelte": "<h1>Slug</h1>\n",
			// The page answers 200 HTML, but its data payload fails (a guard on data requests).
			"src/routes/nodata/+page.svelte": "<h1>No data</h1>\n",
			"src/routes/nodata/+page.server.ts": prerendered(),
			// The page answers 200 HTML, but a guard redirects its data request; the server
			// turns that into a 200 JSON `{ redirect }`, which must not be saved as its data.
			"src/routes/guarded/+page.svelte": "<h1>Guarded</h1>\n",
			"src/routes/guarded/+page.server.ts": prerendered(),
			// The page answers at once, but its data request hangs past PRERENDER_TIMEOUT.
			"src/routes/hang/+page.svelte": "<h1>Hang</h1>\n",
			"src/routes/hang/+page.server.ts": prerendered(),
			"src/hooks.server.ts":
				`export const handle = async ({ event, resolve }: any) => {\n` +
				`\tif (event.isDataRequest && event.url.pathname === "/nodata")\n` +
				`\t\treturn new Response("nope", { status: 500 });\n` +
				`\tif (event.isDataRequest && event.url.pathname === "/guarded")\n` +
				`\t\treturn new Response(null, { status: 307, headers: { location: "/login" } });\n` +
				`\tif (event.isDataRequest && event.url.pathname === "/hang")\n` +
				`\t\tawait Bun.sleep(10_000);\n` +
				`\treturn resolve(event);\n};\n`,
			// `/[slug]` answers the 404 probe with a page, and wrangler needs 404.html: that
			// failure is listed with the pages, not thrown before them.
			"wrangler.toml": `not_found_handling = "404-page"\n`,
		});
		result = await build(dir, { PRERENDER_TIMEOUT: "3000" });
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
		["a page whose data payload fails", "❌ Prerender: /nodata data answered 500"],
		[
			"a page whose data request redirects",
			"❌ Prerender: /guarded data answered redirect 307 → /login",
		],
		["a page whose data request hangs", "❌ Prerender: /hang data timed out after 3s"],
		["the 404 page wrangler needs", "❌ 404.html could not be built (an unknown URL answered 200)"],
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
			"nodata.html",
			"guarded.html",
			"hang.html",
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

// ─── PRERENDER_TIMEOUT: page and data side by side ───────

// The page and its data payload each run the loader. They're fetched side by side, each with its
// own timeout: a loader at 60% of the limit builds, and the two loader runs start together
// (one after the other, the second would start 1.2s later; under 1s leaves room for a slow CI).
test("a slow loader's page and data are fetched side by side, within the timeout", async () => {
	const dir = fixture("slow", {
		// Live-traffic limits: MAX_INFLIGHT must not shed the build's own two requests with a
		// 503, and LOAD_TIMEOUT must not cut a loader PRERENDER_TIMEOUT allows.
		".env": "MAX_INFLIGHT=1\nLOAD_TIMEOUT=500\n",
		"src/routes/slow/+page.svelte": "<h1>Slow</h1>\n",
		"src/routes/slow/+page.server.ts": prerendered(
			`import { appendFileSync } from "fs";\n` +
				`export async function load() {\n` +
				`\tappendFileSync("starts.log", Date.now() + "\\n");\n` +
				`\tawait Bun.sleep(1200);\n\treturn { ok: true };\n}\n`,
		),
	});
	try {
		const { code, out } = await build(dir, { PRERENDER_TIMEOUT: "2000" });
		expect(out).not.toContain("❌");
		expect(out).not.toContain("timed out");
		expect(code).toBe(0);
		expect(existsSync(join(dir, "dist/prerendered/__bosia/data/slow.json"))).toBe(true);
		const starts = readFileSync(join(dir, "starts.log"), "utf-8").trim().split("\n").map(Number);
		expect(starts).toHaveLength(2);
		expect(Math.abs(starts[1]! - starts[0]!)).toBeLessThan(1200);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 180_000);

// Bun's idle timer is coarse: IDLE_TIMEOUT=1 closes a silent request after ~4-5s, so the
// loader sleeps 6s (the side-by-side test above is too fast to reach it).
test("IDLE_TIMEOUT from .env doesn't cut a loader PRERENDER_TIMEOUT allows", async () => {
	const dir = fixture("idle", {
		".env": "IDLE_TIMEOUT=1\n",
		"src/routes/idle/+page.svelte": "<h1>Idle</h1>\n",
		"src/routes/idle/+page.server.ts": prerendered(
			`export async function load() {\n\tawait Bun.sleep(6000);\n\treturn {};\n}\n`,
		),
	});
	try {
		const { code, out } = await build(dir, { PRERENDER_TIMEOUT: "10000" });
		expect(out).not.toContain("❌");
		expect(code).toBe(0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 180_000);

// A metadata() timeout is swallowed (the page renders without it), so a live-traffic
// METADATA_TIMEOUT in .env would save the page without its title.
test("METADATA_TIMEOUT from .env doesn't drop metadata PRERENDER_TIMEOUT allows", async () => {
	const dir = fixture("slowmeta", {
		".env": "METADATA_TIMEOUT=500\n",
		"src/routes/meta/+page.svelte": "<h1>Meta</h1>\n",
		"src/routes/meta/+page.server.ts": prerendered(
			`export async function metadata() {\n\tawait Bun.sleep(1500);\n\treturn { title: "Slow Title" };\n}\n`,
		),
	});
	try {
		const { code, out } = await build(dir, { PRERENDER_TIMEOUT: "10000" });
		expect(out).not.toContain("❌");
		expect(code).toBe(0);
		expect(readFileSync(join(dir, "dist/prerendered/meta.html"), "utf-8")).toContain(
			"<title>Slow Title</title>",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 180_000);

// Each page's HTML and data requests both run load(), side by side. PRERENDER_CONCURRENCY
// counts those requests, so a user capping it for a rate-limited API gets that many loaders.
test("PRERENDER_CONCURRENCY caps loaders running at once, not pages", async () => {
	const dir = fixture("cap", {
		"src/routes/p/[slug]/+page.svelte": "<h1>P</h1>\n",
		"src/routes/p/[slug]/+page.server.ts": prerendered(
			slugs("a", "b", "c", "d", "e", "f") +
				`import { appendFileSync } from "fs";\n` +
				`const g = globalThis as any;\n` +
				`export async function load() {\n` +
				`\tg.running = (g.running ?? 0) + 1;\n` +
				`\tappendFileSync("running.log", g.running + "\\n");\n` +
				`\tawait Bun.sleep(300);\n` +
				`\tg.running--;\n` +
				`\treturn {};\n}\n`,
		),
	});
	try {
		const { code, out } = await build(dir, { PRERENDER_CONCURRENCY: "3" });
		expect(out).not.toContain("❌");
		expect(code).toBe(0);
		const running = readFileSync(join(dir, "running.log"), "utf-8").trim().split("\n").map(Number);
		expect(running.length).toBe(12);
		expect(Math.max(...running)).toBe(3);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 180_000);

// ─── A failed page stops its data fetch ──────────────────

// A hook fails the page at once, but its data request runs a 20s loader. The build reports the
// page without waiting for that loader (PRERENDER_TIMEOUT is 60s, so only the stop ends it),
// and stops the server without draining it.
test("a page that fails fast doesn't wait for its slow data", async () => {
	const dir = fixture("stopdata", {
		"src/routes/half/+page.svelte": "<h1>Half</h1>\n",
		"src/routes/half/+page.server.ts": prerendered(
			`export async function load() {\n\tawait Bun.sleep(20_000);\n\treturn {};\n}\n`,
		),
		"src/hooks.server.ts":
			`export const handle = async ({ event, resolve }: any) => {\n` +
			`\tif (!event.isDataRequest && event.url.pathname === "/half")\n` +
			`\t\treturn new Response("down", { status: 500 });\n` +
			`\treturn resolve(event);\n};\n`,
	});
	try {
		const started = Date.now();
		const { code, out } = await build(dir, { PRERENDER_TIMEOUT: "60000" });
		const lines = out.split("\n").filter((l) => l.startsWith("❌ Prerender: /half"));
		expect(lines).toEqual(["❌ Prerender: /half answered 500"]);
		expect(code).toBe(1);
		// The build itself takes ~1s (more on a busy machine); the server must not drain the 20s
		// loader for 10s, so anything under that proves the stop.
		expect(Date.now() - started).toBeLessThan(9_000);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 180_000);

// ─── The 404 probe follows the server's 308 ──────────────

// A catch-all `always` page 308s the probe to its slash form, where its 404 is the page a
// static host should show for unknown URLs. Following that 308 builds 404.html; wrangler's
// 404-page makes a missing one fail the build.
test("a catch-all `always` page still gives 404.html", async () => {
	const dir = fixture("catchall", {
		"src/routes/+error.svelte": "<h1>Not here</h1>\n",
		"src/routes/[...rest]/+page.svelte": "<h1>Rest</h1>\n",
		"src/routes/[...rest]/+page.server.ts":
			`import { error } from "bosia";\nexport const trailingSlash = "always";\n` +
			`export function load() {\n\terror(404, "nope");\n}\n`,
		"wrangler.toml": `not_found_handling = "404-page"\n`,
	});
	try {
		const { code, out } = await build(dir);
		expect(out).not.toContain("404.html could not be built");
		expect(code).toBe(0);
		expect(readFileSync(join(dir, "dist/static/404.html"), "utf-8")).toContain("Not here");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 180_000);

// A hook that redirects unknown URLs off-site: the probe reports the redirect instead of
// fetching the other host during the build.
test("the 404 probe doesn't follow a redirect to another host", async () => {
	let hits = 0;
	const other = Bun.serve({ port: 0, fetch: () => (hits++, new Response("<h1>Elsewhere</h1>")) });
	const away = `http://127.0.0.1:${other.port}/`;
	const dir = fixture("offsite", {
		"src/routes/+page.server.ts": prerendered(),
		"src/hooks.server.ts":
			`export const handle = async ({ event, resolve }: any) => {\n` +
			`\tif (event.url.pathname.startsWith("/__bosia-404-probe"))\n` +
			`\t\treturn new Response(null, { status: 307, headers: { location: "${away}" } });\n` +
			`\treturn resolve(event);\n};\n`,
	});
	try {
		const { out } = await build(dir);
		expect(out).toContain(`404.html skipped: an unknown URL answered 307 → ${away}`);
		expect(hits).toBe(0);
	} finally {
		other.stop(true);
		rmSync(dir, { recursive: true, force: true });
	}
}, 180_000);

// The probe's failures read like a page's: a timeout names PRERENDER_TIMEOUT.
test("a 404 probe that times out says how to raise the limit", async () => {
	const dir = fixture("slowprobe", {
		"src/routes/+page.server.ts": prerendered(),
		"src/hooks.server.ts":
			`export const handle = async ({ event, resolve }: any) => {\n` +
			`\tif (event.url.pathname.startsWith("/__bosia-404-probe")) await Bun.sleep(5000);\n` +
			`\treturn resolve(event);\n};\n`,
	});
	try {
		const { out } = await build(dir, { PRERENDER_TIMEOUT: "1000" });
		expect(out).toContain(
			"404.html skipped: timed out after 1s — increase PRERENDER_TIMEOUT to raise the limit",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 180_000);

// /_health is answered after the hooks, so a hook stuck on a database the build can't reach
// would hang the ready check. Each check has its own time limit inside the 10s deadline.
test("a hook that never answers /_health fails the build after 10s", async () => {
	const dir = fixture("stuckhealth", {
		"src/routes/+page.server.ts": prerendered(),
		"src/hooks.server.ts":
			`export const handle = async ({ event, resolve }: any) => {\n` +
			`\tif (event.url.pathname === "/_health") await new Promise(() => {});\n` +
			`\treturn resolve(event);\n};\n`,
	});
	try {
		const started = Date.now();
		const { code, out } = await build(dir);
		expect(out).toContain("not ready within 10s");
		expect(code).toBe(1);
		expect(Date.now() - started).toBeLessThan(20_000);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 60_000);

// prerender.ts reads its settings on import, before bosia's loadEnv. That's safe because the
// CLI starts build.ts with NODE_ENV set, so Bun has already loaded .env.production.local.
test("PRERENDER_* settings from .env.production.local are read", async () => {
	const dir = fixture("envlocal", {
		".env.production.local": "PRERENDER_CONCURRENCY=0.5\n",
		"src/routes/+page.server.ts": prerendered(),
	});
	try {
		const { code, out } = await build(dir);
		expect(out).toContain(`PRERENDER_CONCURRENCY must be a whole number`);
		expect(code).toBe(1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 180_000);

test("a bad PRERENDER_CONCURRENCY fails the build instead of skipping every page", async () => {
	const dir = fixture("badconc", { "src/routes/+page.server.ts": prerendered() });
	try {
		const { code, out } = await build(dir, { PRERENDER_CONCURRENCY: "0.5" });
		expect(out).toContain(
			`PRERENDER_CONCURRENCY must be a whole number from 1 to 2147483647 (got "0.5")`,
		);
		expect(code).toBe(1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 180_000);

// Only the probe's own slash form is followed: a hook sending unknown URLs to /login is named
// in the message, instead of reading as "answered 200" from the login page.
test("the 404 probe names a redirect to another page", async () => {
	const dir = fixture("loginprobe", {
		"src/routes/+page.server.ts": prerendered(),
		"src/routes/login/+page.svelte": "<h1>Login</h1>\n",
		"src/hooks.server.ts":
			`export const handle = async ({ event, resolve }: any) => {\n` +
			`\tif (event.url.pathname.startsWith("/__bosia-404-probe"))\n` +
			`\t\treturn new Response(null, { status: 302, headers: { location: "/login" } });\n` +
			`\treturn resolve(event);\n};\n`,
	});
	try {
		const { out } = await build(dir);
		expect(out).toContain("404.html skipped: an unknown URL answered 302 → /login");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 180_000);
