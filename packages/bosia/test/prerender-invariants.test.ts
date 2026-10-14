// Invariant sweep for prerender values. The regression table (prerender-entries.test.ts) checks
// rules; this checks outcomes, with an oracle that doesn't share the rules' code:
//   1. every URL of a page that prerender doesn't fetch (the other `/` form) reaches the page,
//      not the server's own handlers (real isStaticPath, same function server.ts uses). The
//      fetched URL is checked on the server's real reply (prerender-server.test.ts), so a
//      static-file ending there is the build test's job, not this sweep's;
//   2. the final static/ tree, modelled on a case-insensitive disk (macOS/Windows) in
//      generateStaticSite's copy order, keeps every file at its exact name with one writer.
// A value the rules accept that breaks either invariant fails here, even with no table row.
import { describe, expect, test } from "bun:test";
import {
	canonicalRouteFor,
	checkPrerenderPaths,
	findPrerenderClash,
	prerenderApiOutPath,
	prerenderDataOutPath,
	prerenderOutPath,
	substituteParams,
	type PrerenderTarget,
} from "../src/core/prerender.ts";
import { OUT_DIR } from "../src/core/paths.ts";
import { isStaticPath } from "../src/core/staticPath.ts";

type Kind = PrerenderTarget["kind"];
type Mode = PrerenderTarget["trailingSlash"];

// Tricky parts: framework folders and endpoints in every case, file endings, `index`, `404`.
const PARTS = ["a", "A", "dist", "DIST", "Dist", "__bosia", "__Bosia", "_health", "_Health"];
PARTS.push("404", "index", "logo.png", "logo.PNG", "robots.txt", "a.html", "a.json", "v1..v2");
PARTS.push("client", "data", "x.js", "con", "com0");
const VALUES = [
	...PARTS,
	...PARTS.flatMap((a) => ["x", "dist", "DIST", "client"].map((b) => `${a}/${b}`)),
];
const PATTERNS: Record<Kind, string[]> = {
	page: ["/[slug]", "/[...p]", "/blog/[slug]", "/docs/[...p]", "/[slug]/x", "/[slug]/client"],
	api: ["/[slug]", "/[...p]", "/api/[slug]"],
};
const MODES: Mode[] = ["never", "always", "ignore"];

/** The targets the rules accept, across every pattern × value × mode × kind. */
function accepted(): PrerenderTarget[] {
	const out: PrerenderTarget[] = [];
	for (const kind of ["page", "api"] as Kind[])
		for (const pattern of PATTERNS[kind])
			for (const ts of kind === "page" ? MODES : (["never"] as Mode[]))
				for (const value of VALUES) {
					const name = pattern.match(/\[(?:\.\.\.)?(\w+)\]/)![1]!;
					try {
						const path = substituteParams(pattern, { [name]: value });
						checkPrerenderPaths([path], kind, ts);
						out.push({ path, route: pattern, kind, trailingSlash: ts });
					} catch {}
				}
	return out;
}

/** Files under static/ a target writes, relative to it (prerendered/ is copied there). */
function files(t: PrerenderTarget): string[] {
	const pre = `${OUT_DIR}/prerendered/`;
	const abs =
		t.kind === "api"
			? [prerenderApiOutPath(t.path)]
			: [prerenderOutPath(t.path, t.trailingSlash), prerenderDataOutPath(t.path)];
	return abs.map((f) => f.slice(pre.length));
}

/**
 * Writes files in order on a case-insensitive disk: a name is created once, in its first case,
 * and later writes reuse it. Returns every file that didn't land at its exact path, or that
 * shares a file (or a file/folder spot) with another writer.
 */
function diskProblems(writes: { file: string; who: string }[]): string[] {
	const nodes = new Map<string, { name: string; file: boolean; who: string }>();
	const problems: string[] = [];
	for (const { file, who } of writes) {
		const segs = file.split("/");
		let actual = "";
		for (let i = 0; i < segs.length; i++) {
			const isFile = i === segs.length - 1;
			const key = segs
				.slice(0, i + 1)
				.join("/")
				.toLowerCase();
			const prev = nodes.get(key);
			if (!prev) nodes.set(key, { name: segs[i]!, file: isFile, who });
			else if (prev.file || isFile) problems.push(`${who} writes ${file}, taken by ${prev.who}`);
			actual += (i ? "/" : "") + (prev?.name ?? segs[i]);
		}
		if (actual !== file) problems.push(`${who} writes ${file}, lands at ${actual}`);
	}
	return problems;
}

// What generateStaticSite writes besides the pages: 404.html first, the bundle last.
const BEFORE = [{ file: "404.html", who: "the 404 page" }];
const AFTER = [
	{ file: "dist/client/app.js", who: "the client bundle" },
	{ file: "dist/client/chunks/x.js", who: "the client bundle" },
];
const site = (targets: PrerenderTarget[]) => [
	...BEFORE,
	...targets.flatMap((t) =>
		files(t).map((file) => ({ file, who: `${t.path} (${t.route}, ${t.trailingSlash})` })),
	),
	...AFTER,
];

const ACCEPTED = accepted();

describe("prerender invariants", () => {
	test("the sweep covers a real mix (some values build, some fail)", () => {
		expect(ACCEPTED.length).toBeGreaterThan(200);
		expect(ACCEPTED.some((t) => t.path === "/blog/v1..v2")).toBe(true);
		expect(ACCEPTED.some((t) => t.kind === "page" && /^dist$/i.test(t.path.split("/")[1]!))).toBe(
			false,
		);
	});

	test("every URL of an accepted page reaches the page", () => {
		const bad = ACCEPTED.filter((t) => t.kind === "page").flatMap((t) =>
			[t.path, `${t.path}/`]
				.filter(
					(u) =>
						u === "/_health" ||
						(u !== canonicalRouteFor(t.path, t.trailingSlash) && isStaticPath(u)),
				)
				.map((u) => `${t.path} (${t.route}, ${t.trailingSlash}): the server answers ${u}`),
		);
		expect(bad).toEqual([]);
	});

	test("an accepted API is never under the framework's static prefixes", () => {
		const bad = ACCEPTED.filter(
			(t) => t.kind === "api" && (t.path === "/_health" || /^\/(dist|__bosia)\//.test(t.path)),
		);
		expect(bad).toEqual([]);
	});

	test("one accepted target keeps the bundle, the 404 page and its own files intact", () => {
		const bad = ACCEPTED.flatMap((t) => diskProblems(site([t])));
		expect(bad).toEqual([]);
	});

	// Two targets the clash check lets through must also be fine on disk.
	test("a pair the clash check allows is fine on disk", () => {
		const sample = ACCEPTED.filter((_, i) => i % 3 === 0);
		const bad: string[] = [];
		for (let i = 0; i < sample.length; i++)
			for (let j = i + 1; j < sample.length; j++) {
				const pair = [sample[i]!, sample[j]!];
				if (findPrerenderClash(pair).length) continue;
				bad.push(...diskProblems(site(pair)));
			}
		expect(bad.slice(0, 10)).toEqual([]);
	});
});
