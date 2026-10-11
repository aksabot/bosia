import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Written by the framework's prerender step; Cloudflare assets serve it for unknown paths.
// Skips only before any build; a build that lost the file (probe warned) fails here.
const STATIC = join(import.meta.dir, "..", "dist", "static");

test.skipIf(!existsSync(STATIC))(
	"build writes the server's 404 page to dist/static/404.html",
	() => {
		const file = join(STATIC, "404.html");
		expect(existsSync(file)).toBe(true);
		const html = readFileSync(file, "utf-8");
		expect(html).toContain("<title>404");
		expect(html).toContain('<div id="app">');
	},
);
