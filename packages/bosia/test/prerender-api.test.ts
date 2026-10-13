import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	detectPrerenderRoutes,
	PrerenderEntriesError,
	prerenderApiOutPath,
	substituteParams,
} from "../src/core/prerender.ts";

describe("prerenderApiOutPath()", () => {
	test("flat API path → .json file", () => {
		expect(prerenderApiOutPath("/api/skills")).toBe("./dist/prerendered/api/skills.json");
	});

	test("nested API path → nested .json file", () => {
		expect(prerenderApiOutPath("/api/components/ui/button")).toBe(
			"./dist/prerendered/api/components/ui/button.json",
		);
	});

	test("strips trailing slash before composing", () => {
		expect(prerenderApiOutPath("/api/skills/")).toBe("./dist/prerendered/api/skills.json");
	});

	test("never emits trailing-slash variants (no index.json)", () => {
		expect(prerenderApiOutPath("/api/blocks")).not.toContain("index.json");
	});
});

describe("substituteParams() — API rest-segment cases", () => {
	test("[...path] expands to multi-segment value used by registry routes", () => {
		expect(substituteParams("/api/components/[...path]", { path: "ui/button" })).toBe(
			"/api/components/ui/button",
		);
		expect(
			substituteParams("/api/blocks/[...path]", {
				path: "cards/feature",
			}),
		).toBe("/api/blocks/cards/feature");
	});

	test("[name] expands to single-segment skill value", () => {
		expect(substituteParams("/api/skills/[name]", { name: "bosia-svelte-runes" })).toBe(
			"/api/skills/bosia-svelte-runes",
		);
	});

	test("a missing param fails instead of writing a literal [slug] path", () => {
		expect(() => substituteParams("/blog/[slug]/[id]", { id: "5" })).toThrow("no value for [slug]");
		expect(() => substituteParams("/blog/[slug]", { slug: undefined as any })).toThrow("no value");
		expect(() => substituteParams("/blog/[slug]", { slug: null as any })).toThrow("no value");
	});

	test("unreserved URL characters pass; a catch-all also takes /", () => {
		expect(substituteParams("/blog/[slug]", { slug: "Hello_World-2.0~x" })).toBe(
			"/blog/Hello_World-2.0~x",
		);
		expect(substituteParams("/compare/[range]", { range: "v1..v2" })).toBe("/compare/v1..v2");
		expect(substituteParams("/docs/[...p]", { p: "guide/v1..v2/intro" })).toBe(
			"/docs/guide/v1..v2/intro",
		);
		expect(substituteParams("/[a]/[b]", { a: "x", b: "5" })).toBe("/x/5");
	});

	test("a catch-all value may end in one slash", () => {
		expect(substituteParams("/docs/[...p]", { p: "guide/intro/" })).toBe("/docs/guide/intro");
	});

	test("any other character fails, encoded or not", () => {
		const slugs = ["50%-off", "100%", "%2e%2e", "a%2Fb", "what%3F", "café", "a b", "foo ", "a\tb"];
		for (const slug of [...slugs, "a?b", "a#b", "a/b", "[draft]", "a$&b", "a\\b", "a\x7fb"])
			expect(() => substituteParams("/blog/[slug]", { slug })).toThrow(/use only ASCII letters/);
		expect(() => substituteParams("/docs/[...p]", { p: "a/50%" })).toThrow(
			/use only ASCII letters/,
		);
	});

	test("empty parts and parts ending in `.` fail (they'd land on another route's file)", () => {
		for (const slug of ["...", "v1.", "a.."])
			expect(() => substituteParams("/blog/[slug]", { slug })).toThrow(/can't end with `\.`/);
		expect(() => substituteParams("/blog/[slug]", { slug: "" })).toThrow(/no empty parts/);
		expect(() => substituteParams("/docs/[...p]", { p: "a//b" })).toThrow(/no empty parts/);
		expect(() => substituteParams("/docs/[...p]", { p: "/" })).toThrow(/no empty parts/);
		expect(() => substituteParams("/blog/[slug]", { slug: "." })).toThrow(/can't end with `\.`/);
		expect(() => substituteParams("/blog/[slug]", { slug: ".." })).toThrow(/can't end with `\.`/);
		expect(() => substituteParams("/docs/[...p]", { p: "a/../b" })).toThrow(/can't end with `\.`/);
	});

	test("`.html`/`.json` endings and Windows device names fail", () => {
		for (const slug of ["post.html", "a.JSON"])
			expect(() => substituteParams("/blog/[slug]", { slug })).toThrow(/\.html or \.json/);
		for (const slug of ["con", "NUL", "aux.txt", "com1", "lpt9"])
			expect(() => substituteParams("/blog/[slug]", { slug })).toThrow(/device names/);
		expect(substituteParams("/blog/[slug]", { slug: "console" })).toBe("/blog/console");
		expect(substituteParams("/blog/[slug]", { slug: "post.htm" })).toBe("/blog/post.htm");
	});

	test("the error quotes the value, so a newline can't split the message", () => {
		expect(() => substituteParams("/blog/[slug]", { slug: { id: 1n } as any })).toThrow(
			'"[object Object]"',
		);
		expect(() => substituteParams("/blog/[slug]", { slug: "a\nb" })).toThrow('"a\\nb"');
	});
});

describe("detectPrerenderRoutes()", () => {
	const cwdBefore = process.cwd();
	let dir = "";
	const route = (name: string, server: string) => {
		mkdirSync(join(dir, "src/routes", name, "[slug]"), { recursive: true });
		writeFileSync(join(dir, "src/routes", name, "[slug]/+page.server.ts"), server);
		return {
			pattern: `/${name}/[slug]`,
			pageServer: `${name}/[slug]/+page.server.ts`,
			trailingSlash: "never",
		};
	};
	const detect = (pages: unknown[]) =>
		detectPrerenderRoutes({ pages, apis: [], errorPage: null } as any).catch((e) => e);

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "bosia-detect-"));
		process.chdir(dir);
	});
	afterEach(() => {
		process.chdir(cwdBefore);
		rmSync(dir, { recursive: true, force: true });
	});

	test("lists every broken entries() route in one error", async () => {
		const pages = ["a", "b"].map((n) => route(n, "export const prerender = true;\n"));
		const err = await detect(pages);
		expect(err).toBeInstanceOf(PrerenderEntriesError);
		expect(err.message).toContain("/a/[slug]");
		expect(err.message).toContain("/b/[slug]");
		expect(err.message.split("\n").filter((l: string) => l.startsWith("❌"))).toHaveLength(2);
		expect(err.cause).toHaveLength(2);
	});

	test("values that differ only by case fail (one file on macOS/Windows)", async () => {
		const server = `export const prerender = true;
export const entries = () => [{ slug: "About" }, { slug: "about" }];
`;
		const err = await detect([route("c", server)]);
		expect(err).toBeInstanceOf(PrerenderEntriesError);
		expect(err.message).toContain("/c/About and /c/about write the same file");
	});
});
