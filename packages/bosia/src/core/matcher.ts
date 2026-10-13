import type { RouteMatch, TrailingSlash } from "./types.ts";

// ─── Route Matcher ───────────────────────────────────────
// Single shared matcher used by both client and server at runtime.
// Replaces the old code-generated match functions.
//
// Routes arrive sorted by sortRoutes (routeFile.ts): segment by segment,
// static beats "[param]" beats "[...rest]" (same as SvelteKit). First match wins.

// ─── Compiled Route Types ────────────────────────────────

interface CompiledRoute {
	regex: RegExp;
	paramNames: string[];
	isExact: boolean;
}

// ─── Pattern Compiler ────────────────────────────────────

/** How every part of Bosia reads one route segment (matcher, sortRoutes, scanner):
 *  0 static, 1 `[param]`, 2 `[...rest]`. Doubles as the sort rank. */
export function segmentRank(seg: string): 0 | 1 | 2 {
	if (!seg.startsWith("[") || !seg.endsWith("]")) return 0;
	return seg.startsWith("[...") ? 2 : 1;
}

/** Escape regex special chars in a literal string segment. */
function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pre-compile a route pattern into a RegExp for fast matching.
 */
function compilePattern(pattern: string): CompiledRoute {
	// No dynamic segments — exact match via ===
	if (!pattern.includes("[")) {
		return { regex: null!, paramNames: [], isExact: true };
	}

	const paramNames: string[] = [];

	// /blog/[slug]/comments → ^\/blog\/([^/]+)\/comments$
	// [...rest] spans one or more segments, anywhere: /[lang]/[...rest], /docs/[...path]/edit.
	const segments = pattern.split("/").filter(Boolean);
	let regexStr = "^";
	for (const seg of segments) {
		regexStr += "\\/";
		const rank = segmentRank(seg);
		if (rank === 2) {
			paramNames.push(seg.slice(4, -1));
			regexStr += "(.+)";
		} else if (rank === 1) {
			paramNames.push(seg.slice(1, -1));
			regexStr += "([^/]+)";
		} else {
			regexStr += escapeRegex(seg);
		}
	}
	regexStr += "$";

	return { regex: new RegExp(regexStr), paramNames, isExact: false };
}

// Exact routes bucketed by pathname, keyed by the routes-array identity so
// findMatch can O(1) Map.get before linearly scanning the dynamic/catch-all
// remainder. WeakMap keeps it tied to whichever array (server/api/client) was
// compiled; uncompiled arrays simply fall back to the full linear scan.
const exactMaps = new WeakMap<object, Map<string, unknown>>();

/**
 * Pre-compile all route patterns in-place.
 * Mutates each route by adding a `_compiled` property.
 * Call once at startup — all modules sharing the same route array see the result.
 */
export function compileRoutes<T extends { pattern: string }>(
	routes: T[],
): (T & { _compiled: CompiledRoute })[] {
	const exact = new Map<string, T>();
	for (const route of routes) {
		const compiled = compilePattern(route.pattern);
		(route as any)._compiled = compiled;
		// Exact patterns contain no dynamic segments, so pattern === pathname.
		if (compiled.isExact) exact.set(route.pattern, route);
	}
	exactMaps.set(routes, exact);
	return routes as (T & { _compiled: CompiledRoute })[];
}

// ─── Route Matching ──────────────────────────────────────

/**
 * Match a compiled route against a pathname using regex.
 * Returns extracted params if matched, null otherwise.
 */
function matchCompiled(
	compiled: CompiledRoute,
	pattern: string,
	pathname: string,
): Record<string, string> | null {
	if (compiled.isExact) {
		return pattern === pathname ? {} : null;
	}

	const m = compiled.regex.exec(pathname);
	if (!m) return null;

	const params: Record<string, string> = {};
	for (let i = 0; i < compiled.paramNames.length; i++) {
		params[compiled.paramNames[i]!] = m[i + 1]!;
	}
	return params;
}

/**
 * Find the first matching route from a list.
 * Routes must be pre-sorted by sortRoutes (most specific segment first).
 * Single pass — first match wins.
 */
export function findMatch<T extends { pattern: string }>(
	routes: T[],
	pathname: string,
): RouteMatch<T> | null {
	// Strip trailing slash (but keep "/" as-is)
	if (pathname.length > 1 && pathname.endsWith("/")) {
		pathname = pathname.slice(0, -1);
	}

	// Exact-match fast path: one Map.get instead of scanning every exact route.
	const exact = exactMaps.get(routes) as Map<string, T> | undefined;
	if (exact) {
		const hit = exact.get(pathname);
		if (hit) return { route: hit, params: {} };
	}

	for (const route of routes) {
		// Arrays that skipped compileRoutes compile lazily, once per route.
		const compiled: CompiledRoute = ((route as any)._compiled ??= compilePattern(route.pattern));
		// Exact routes already covered by the Map lookup above — skip them.
		if (exact && compiled.isExact) continue;
		const params = matchCompiled(compiled, route.pattern, pathname);
		if (params !== null) return { route, params };
	}

	return null;
}

// ─── Trailing-Slash Canonicalization ──────────────────────
// Returns the canonical pathname for a given mode, or null if pathname is
// already canonical. Root "/" is never modified. Caller decides whether to
// 308-redirect (server) or replaceState (client).

export function canonicalPathname(pathname: string, mode: TrailingSlash): string | null {
	if (mode === "ignore") return null;
	if (pathname === "/") return null;
	const endsWithSlash = pathname.endsWith("/");
	if (mode === "never" && endsWithSlash) return pathname.slice(0, -1);
	if (mode === "always" && !endsWithSlash) return pathname + "/";
	return null;
}
