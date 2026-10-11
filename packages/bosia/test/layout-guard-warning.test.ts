import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

import { getEphemeralPort } from "../src/core/prerender.ts";
import { BOSIA_NODE_PATH } from "../src/core/paths.ts";

// Loaders start together, so everything below a layout (nested layouts, page
// load(), metadata()) runs even when that layout redirects. Dev warns about
// where the guard lives when a layout throws redirect() or error(401/403) and
// some loader below it ran. A not-found error(404), or a guard with nothing
// below it, stays quiet.

let tmpDir: string;
let child: Bun.Subprocess | null = null;
let origin: string;
let stderr = "";

const LAYOUT = `<script>let { children } = $props();</script>\n{@render children()}\n`;
const throwing = (expr: string) =>
	`import { redirect, error } from "bosia";\n` + `export function load() {\n\tthrow ${expr};\n}\n`;
const REDIRECT = throwing(`redirect(303, "/login")`);
const LOAD = `export async function load({ parent }: any) {\n\tawait parent();\n\treturn {};\n}\n`;

type Case = { guard?: string; status?: number; pageServer?: string; nestedLayout?: boolean };

// Requested in this order. The quiet ones go first, so once the last (loud)
// warning shows up, stderr is known to hold everything before it.
const cases: Record<string, Case> = {
	missing: { guard: throwing(`error(404, "Not Found")`), status: 404, pageServer: LOAD },
	leaf: {},
	page: { pageServer: LOAD },
	meta: { pageServer: `export function metadata() {\n\treturn { title: "Meta" };\n}\n` },
	nested: { nestedLayout: true },
	forbidden: { guard: throwing(`error(403, "Forbidden")`), status: 403, pageServer: LOAD },
};

function writeCase(routes: string, name: string, c: Case) {
	const dir = join(routes, name);
	const inner = join(dir, "inner");
	mkdirSync(inner, { recursive: true });
	writeFileSync(join(dir, "+layout.svelte"), LAYOUT);
	writeFileSync(join(dir, "+layout.server.ts"), c.guard ?? REDIRECT);
	writeFileSync(join(inner, "+page.svelte"), `<h1>${name}</h1>\n`);
	if (c.pageServer) writeFileSync(join(inner, "+page.server.ts"), c.pageServer);
	if (c.nestedLayout) {
		writeFileSync(join(inner, "+layout.svelte"), LAYOUT);
		writeFileSync(join(inner, "+layout.server.ts"), LOAD);
	}
}

const warningsFor = (name: string) =>
	stderr.split("\n").filter((l) => l.startsWith(`⚠️  /${name}/inner: a layout (depth 0) threw`));

async function waitFor(check: () => boolean | Promise<boolean>, what: string) {
	const deadline = Date.now() + 15_000;
	while (!(await check())) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await Bun.sleep(20);
	}
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
	writeFileSync(join(routes, "+error.svelte"), `<h1>Galat</h1>\n`);
	for (const [name, c] of Object.entries(cases)) writeCase(routes, name, c);

	// The warning is dev-only. The build inlines NODE_ENV, so both steps use development.
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

	await waitFor(async () => {
		try {
			return (await fetch(`${origin}/_health`)).ok;
		} catch {
			return false;
		}
	}, "the server to start");

	// Two page requests and a data request each: the warning shows once per route.
	for (const [name, c] of Object.entries(cases)) {
		for (let i = 0; i < 2; i++) {
			const res = await fetch(`${origin}/${name}/inner`, { redirect: "manual" });
			expect(res.status).toBe(c.status ?? 303);
			await res.text();
		}
		await (await fetch(`${origin}/__bosia/data/${name}/inner.json`)).text();
	}
	await waitFor(() => warningsFor("forbidden").length > 0, "the last warning");
}, 180_000);

afterAll(async () => {
	child?.kill();
	// Windows keeps the server's files locked until it has exited (EBUSY).
	await child?.exited;
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("dev warns when a layout guard has loaders below it", () => {
	test("a page load() below a redirect warns, once", () => {
		const lines = warningsFor("page");
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("threw redirect() as a guard");
		expect(stderr).toContain("For an auth guard, use src/hooks.server.ts.");
	});

	test("a page with only metadata() warns", () => {
		expect(warningsFor("meta")).toHaveLength(1);
	});

	test("a nested layout loader warns", () => {
		expect(warningsFor("nested")).toHaveLength(1);
	});

	test("error(403) counts as a guard", () => {
		const lines = warningsFor("forbidden");
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("threw error(403)");
	});

	test("a guard with no loader below it stays quiet", () => {
		expect(warningsFor("leaf")).toHaveLength(0);
	});

	test("a not-found error(404) is not a guard", () => {
		expect(warningsFor("missing")).toHaveLength(0);
	});
});
