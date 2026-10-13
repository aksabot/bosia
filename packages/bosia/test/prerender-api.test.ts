import { describe, expect, test } from "bun:test";
import { prerenderApiOutPath, substituteParams } from "../src/core/prerender.ts";

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

	test("`$&` in a value stays literal", () => {
		expect(substituteParams("/blog/[slug]", { slug: "a$&b" })).toBe("/blog/a$&b");
	});

	test("a missing param fails instead of writing a literal [slug] path", () => {
		expect(() => substituteParams("/blog/[slug]/[id]", { id: "5" })).toThrow("no value for [slug]");
	});

	test("null, undefined, empty or '.' values fail instead of writing a wrong file", () => {
		expect(() => substituteParams("/blog/[slug]", { slug: undefined as any })).toThrow("no value");
		expect(() => substituteParams("/blog/[slug]", { slug: null as any })).toThrow("no value");
		expect(() => substituteParams("/blog/[slug]", { slug: "" })).toThrow(/empty or `\.` parts/);
		expect(() => substituteParams("/blog/[slug]", { slug: "." })).toThrow(/empty or `\.` parts/);
		expect(() => substituteParams("/docs/[...p]", { p: "a//b" })).toThrow(/empty or `\.` parts/);
		expect(() => substituteParams("/docs/[...p]", { p: "/" })).toThrow(/empty or `\.` parts/);
	});

	test("a catch-all value may end in one slash", () => {
		expect(substituteParams("/docs/[...p]", { p: "guide/intro/" })).toBe("/docs/guide/intro");
	});

	test("? and # fail (fetched URL would differ from the written file)", () => {
		expect(() => substituteParams("/docs/[...p]", { p: "a?b" })).toThrow(/`\?` and `#`/);
		expect(() => substituteParams("/blog/[slug]", { slug: "a#b" })).toThrow(/`\?` and `#`/);
	});

	test("bracketed values stay literal and aren't re-substituted", () => {
		expect(substituteParams("/blog/[slug]", { slug: "[draft]" })).toBe("/blog/[draft]");
		expect(substituteParams("/[a]/[b]", { a: "[b]", b: "x" })).toBe("/[b]/x");
		expect(substituteParams("/notes/[...path]", { path: "a/[wip]" })).toBe("/notes/a/[wip]");
	});
});
