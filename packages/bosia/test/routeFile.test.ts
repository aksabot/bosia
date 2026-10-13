import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { generateRoutesFile, sortRoutes } from "../src/core/routeFile.ts";
import { DEFAULT_TITLE } from "../src/core/headScan.ts";
import type { RouteManifest } from "../src/core/types.ts";

let originalCwd: string;
let tmpDir: string;

beforeEach(() => {
	originalCwd = process.cwd();
	tmpDir = mkdtempSync(join(tmpdir(), "bosia-routefile-"));
	process.chdir(tmpDir);
	mkdirSync(join(tmpDir, "src", "routes", "blog"), { recursive: true });
	writeFileSync(join(tmpDir, "src", "routes", "blog", "+page.ts"), "export default 'page';\n");
	writeFileSync(join(tmpDir, "src", "routes", "+layout.ts"), "export default 'layout';\n");
	writeFileSync(join(tmpDir, "src", "routes", "+server.ts"), "export const GET = () => 1;\n");
});

afterEach(() => {
	process.chdir(originalCwd);
	rmSync(tmpDir, { recursive: true, force: true });
});

const manifest = (pageServer: string | null): RouteManifest => ({
	pages: [
		{
			pattern: "/blog",
			id: "/(app)/blog",
			page: "blog/+page.ts",
			layouts: ["+layout.ts"],
			pageServer,
			layoutServers: [],
			errorPages: [],
			trailingSlash: "never",
		} as any,
	],
	apis: [{ pattern: "/", id: "/", server: "+server.ts" }],
	errorPage: null,
});

describe("generateRoutesFile() — server import thunks", () => {
	test("each server thunk imports once and returns the same promise", async () => {
		generateRoutesFile(manifest(null), DEFAULT_TITLE);
		const { serverRoutes, apiRoutes } = await import(join(tmpDir, ".bosia", "routes.ts"));
		const route = serverRoutes[0];

		const first = route.pageModule();
		expect(route.pageModule()).toBe(first);
		expect((await first).default).toBe("page");
		expect(route.layoutModules[0]()).toBe(route.layoutModules[0]());
		expect(apiRoutes[0].module()).toBe(apiRoutes[0].module());
	});

	test("a failed import is retried on the next call", async () => {
		generateRoutesFile(manifest("blog/+page.server.ts"), DEFAULT_TITLE);
		const { serverRoutes } = await import(join(tmpDir, ".bosia", "routes.ts") + "?retry");
		const route = serverRoutes[0];

		await expect(route.pageServer()).rejects.toThrow();
		writeFileSync(
			join(tmpDir, "src", "routes", "blog", "+page.server.ts"),
			"export const load = () => ({});\n",
		);
		const mod = await route.pageServer();
		expect(typeof mod.load).toBe("function");
	});

	test("server, API and client routes carry their route id", async () => {
		generateRoutesFile(manifest(null), DEFAULT_TITLE);
		const { serverRoutes, apiRoutes, clientRoutes } = await import(
			join(tmpDir, ".bosia", "routes.ts") + "?id"
		);
		expect(serverRoutes[0].id).toBe("/(app)/blog");
		expect(apiRoutes[0].id).toBe("/");
		expect(clientRoutes[0].id).toBe("/(app)/blog");
		const client = readFileSync(join(tmpDir, ".bosia", "routes.client.ts"), "utf-8");
		expect(client).toContain('id: "/(app)/blog"');
	});

	test("client and server routes carry the default title", async () => {
		generateRoutesFile(manifest(null), "Fisika &amp; Co");
		const client = await import(join(tmpDir, ".bosia", "routes.client.ts") + "?title");
		expect(client.defaultTitle).toBe("Fisika &amp; Co");
		const server = await import(join(tmpDir, ".bosia", "routes.ts") + "?title");
		expect(server.defaultTitle).toBe("Fisika &amp; Co");
	});

	test("client routes keep plain import thunks", () => {
		generateRoutesFile(manifest(null), DEFAULT_TITLE);
		const client = readFileSync(join(tmpDir, ".bosia", "routes.client.ts"), "utf-8");
		expect(client).not.toContain("once(");
		expect(client).toContain('page: () => import("../src/routes/blog/+page.ts")');
	});
});

describe("sortRoutes() — static segment beats dynamic beats catch-all", () => {
	const order = (...patterns: string[]) =>
		sortRoutes(patterns.map((pattern) => ({ pattern }))).map((r) => r.pattern);

	test("static first segment wins over dynamic at the same length", () => {
		expect(order("/[folder]/[thread]", "/label/[id]")).toEqual([
			"/label/[id]",
			"/[folder]/[thread]",
		]);
	});

	test("catch-all under a static segment wins over a dynamic first segment", () => {
		expect(order("/[lang]/about", "/blog/[...slug]")).toEqual(["/blog/[...slug]", "/[lang]/about"]);
	});

	test("[...x] is a catch-all anywhere, whatever its name", () => {
		expect(order("/a/[...x]/b", "/a/[y]/b")).toEqual(["/a/[y]/b", "/a/[...x]/b"]);
		expect(order("/[...my-rest]", "/[slug]")).toEqual(["/[slug]", "/[...my-rest]"]);
	});

	test("exact before dynamic before catch-all at the same spot", () => {
		expect(order("/[...rest]", "/[slug]", "/about")).toEqual(["/about", "/[slug]", "/[...rest]"]);
	});
});
