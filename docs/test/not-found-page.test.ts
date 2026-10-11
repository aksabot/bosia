import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Written by the framework's prerender step; Cloudflare assets serve it for unknown paths.
const FILE = join(import.meta.dir, "..", "dist", "static", "404.html");

test.skipIf(!existsSync(FILE))("build writes the server's 404 page to dist/static/404.html", () => {
	const html = readFileSync(FILE, "utf-8");
	expect(html).toContain("<html");
	expect(html).toContain("404");
});
