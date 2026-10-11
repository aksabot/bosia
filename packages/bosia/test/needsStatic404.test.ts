import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { needsStatic404 } from "../src/core/prerender.ts";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "bosia-404-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("no wrangler config → not needed", () => {
	expect(needsStatic404(dir)).toBe(false);
});

test("wrangler.jsonc with 404-page → needed", () => {
	writeFileSync(
		join(dir, "wrangler.jsonc"),
		`{ "assets": { "directory": "./dist/static", "not_found_handling": "404-page", } }`,
	);
	expect(needsStatic404(dir)).toBe(true);
});

test("wrangler.toml with 404-page → needed", () => {
	writeFileSync(join(dir, "wrangler.toml"), `[assets]\nnot_found_handling = "404-page"\n`);
	expect(needsStatic404(dir)).toBe(true);
});

test("other handling or a commented-out line → not needed", () => {
	writeFileSync(
		join(dir, "wrangler.jsonc"),
		`{\n  // "not_found_handling": "404-page",\n  "assets": { "not_found_handling": "single-page-application" }\n}`,
	);
	expect(needsStatic404(dir)).toBe(false);
});

test("public/404.html covers it → not needed", () => {
	writeFileSync(join(dir, "wrangler.json"), `{"assets":{"not_found_handling":"404-page"}}`);
	mkdirSync(join(dir, "public"));
	writeFileSync(join(dir, "public", "404.html"), "<h1>404</h1>");
	expect(needsStatic404(dir)).toBe(false);
});
