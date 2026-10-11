import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

import { getEphemeralPort } from "../src/core/prerender.ts";
import { BOSIA_NODE_PATH } from "../src/core/paths.ts";

// Loaders start together, so a page load() runs even when a layout above it
// redirects. Dev warns when a guard (redirect() or error(401/403)) fires and the
// page load() ran code before `await parent()`. A load() that awaits parent()
// first stays quiet, and so do metadata() and a not-found error(404).

let tmpDir: string;
let child: Bun.Subprocess | null = null;
let origin: string;
let stderr = "";

const LAYOUT = `<script>let { children } = $props();</script>\n{@render children()}\n`;
const throwing = (expr: string) =>
	`import { redirect, error } from "bosia";\n` + `export function load() {\n\tthrow ${expr};\n}\n`;
const REDIRECT = throwing(`redirect(303, "/login")`);
const EARLY =
	`export async function load({ parent }: any) {\n` +
	`\tawait Promise.resolve();\n` +
	`\tawait parent();\n` +
	`\treturn {};\n` +
	`}\n`;
const PARENT_FIRST = `export async function load({ parent }: any) {\n\tawait parent();\n\treturn {};\n}\n`;

// name → expected status of the page request
const cases: Record<string, number> = {};

function guarded(routes: string, name: string, pageServer: string, guard = REDIRECT, status = 303) {
	cases[name] = status;
	const dir = join(routes, name);
	const inner = join(dir, "inner");
	mkdirSync(inner, { recursive: true });
	writeFileSync(join(dir, "+layout.svelte"), LAYOUT);
	writeFileSync(join(dir, "+layout.server.ts"), guard);
	writeFileSync(join(inner, "+page.svelte"), `<h1>${name}</h1>\n`);
	writeFileSync(join(inner, "+page.server.ts"), pageServer);
}

beforeAll(async () => {
	tmpDir = join(import.meta.dir, "..", `.tmp-layout-guard-warning-${Date.now()}`);
	const routes = join(tmpDir, "src", "routes");
	mkdirSync(routes, { recursive: true });

	writeFileSync(join(tmpDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: {} } }));
	writeFileSync(join(tmpDir, "src", "app.css"), `@import "tailwindcss";\n@source "../src";\n`);
	writeFileSync(
		join(tmpDir, "src", "app.html"),
		`<!doctype html>\n<html lang="%bosia.lang%">\n<head>%bosia.head%</head>\n<body>%bosia.body%</body>\n</html>\n`,
	);
	writeFileSync(join(routes, "+page.svelte"), `<h1>Beranda</h1>\n`);

	guarded(routes, "unsafe", EARLY);
	guarded(routes, "safe", PARENT_FIRST);
	guarded(routes, "meta", `export function metadata() {\n\treturn { title: "Meta" };\n}\n`);
	guarded(routes, "forbidden", EARLY, throwing(`error(403, "Forbidden")`), 403);
	guarded(routes, "missing", EARLY, throwing(`error(404, "Not Found")`), 404);
	// A plain function that throws before ever reaching parent().
	guarded(
		routes,
		"syncthrow",
		`import { error } from "bosia";\nexport function load() {\n\tthrow error(500, "boom");\n}\n`,
	);
	writeFileSync(join(routes, "+error.svelte"), `<h1>Galat</h1>\n`);

	const build = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "src", "core", "build.ts")], {
		cwd: tmpDir,
		env: { ...process.env, NODE_ENV: "development", NODE_PATH: BOSIA_NODE_PATH },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, out, err] = await Promise.all([
		build.exited,
		new Response(build.stdout).text(),
		new Response(build.stderr).text(),
	]);
	if (code !== 0) throw new Error(`build failed (${code})\n${out}\n${err}`);

	const port = await getEphemeralPort();
	origin = `http://localhost:${port}`;
	// The warning is dev-only. The build inlines NODE_ENV, so both steps use development.
	child = Bun.spawn(["bun", "run", join(tmpDir, "dist", "server", "index.js")], {
		cwd: tmpDir,
		env: {
			...process.env,
			NODE_ENV: "development",
			PORT: String(port),
			NODE_PATH: BOSIA_NODE_PATH,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	// console.warn goes to stderr; drain both pipes so neither fills up.
	new Response(child.stdout as ReadableStream).text();
	(async () => {
		const decoder = new TextDecoder();
		for await (const chunk of child!.stderr as ReadableStream<Uint8Array>) {
			stderr += decoder.decode(chunk);
		}
	})();

	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		try {
			if ((await fetch(`${origin}/_health`)).ok) break;
		} catch {
			/* not up yet */
		}
		await Bun.sleep(50);
	}

	// Two requests each: the warning must show once per route, not per request.
	for (const [name, status] of Object.entries(cases)) {
		for (let i = 0; i < 2; i++) {
			const res = await fetch(`${origin}/${name}/inner`, { redirect: "manual" });
			expect(res.status).toBe(status);
			await res.text();
		}
		const data = await fetch(`${origin}/__bosia/data/${name}/inner.json`);
		await data.text();
	}
	await Bun.sleep(200);
}, 180_000);

afterAll(async () => {
	child?.kill();
	// Windows keeps the server's files locked until it has exited (EBUSY).
	await child?.exited;
	rmSync(tmpDir, { recursive: true, force: true });
});

const warningsFor = (route: string) =>
	stderr.split("\n").filter((l) => l.includes(`⚠️  ${route}: a layout (depth 0) threw`));

describe("dev warns when page code runs past a layout guard", () => {
	test("load() that awaits something before parent() warns, once", () => {
		const lines = warningsFor("/unsafe/inner");
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("threw redirect(), but the page load() ran code before");
		expect(stderr).toContain("If the layout is an auth guard, move it to src/hooks.server.ts.");
	});

	test("error(403) counts as a guard", () => {
		const lines = warningsFor("/forbidden/inner");
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("threw error(403)");
	});

	test("a sync load() that throws before parent() still warns", () => {
		expect(warningsFor("/syncthrow/inner")).toHaveLength(1);
	});

	test("load() that awaits parent() first stays quiet", () => {
		expect(warningsFor("/safe/inner")).toHaveLength(0);
	});

	// A page with metadata() and no load(): metadata() runs past the guard too.
	test("metadata() alone stays quiet", () => {
		expect(warningsFor("/meta/inner")).toHaveLength(0);
	});

	test("a not-found error(404) is not a guard", () => {
		expect(warningsFor("/missing/inner")).toHaveLength(0);
	});
});
