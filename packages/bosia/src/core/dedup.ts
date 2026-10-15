// ─── Request Deduplication ──────────────────────────────
// Concurrent in-flight coalescing. When N parallel requests hit the same URL,
// run the loader once and share the resolved value across all N waiters.
// Settled responses are NOT cached — once the promise resolves, the entry is
// dropped, so the next request runs the loader again.
//
// The caller's key includes the CACHE_KEYS identity hash (see cache.ts), so
// different users never share a loader result. Custom session cookie names
// must be listed in CACHE_KEYS. See docs/guides/request-deduplication.md.

const inflight = new Map<string, { promise: Promise<unknown>; start: number }>();

/** Build a stable dedup key from a URL: normalized path + sorted query. */
export function dedupKey(url: URL): string {
	let path = url.pathname;
	if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
	const sorted = new URLSearchParams([...url.searchParams.entries()].sort());
	const search = sorted.toString();
	return search ? `${path}?${search}` : path;
}

/**
 * Coalesce concurrent calls under `key`. `fn` runs at most once per inflight
 * window. A call older than `maxAgeMs` (> 0) isn't joined: one that never
 * settles (a hung loader with LOAD_TIMEOUT=0) would otherwise take every
 * later request for the key down with it.
 */
export function dedup<T>(key: string, fn: () => Promise<T>, maxAgeMs = 0): Promise<T> {
	const existing = inflight.get(key);
	if (existing && (maxAgeMs <= 0 || performance.now() - existing.start < maxAgeMs)) {
		return existing.promise as Promise<T>;
	}
	const entry = { promise: null as unknown as Promise<T>, start: performance.now() };
	entry.promise = fn().finally(() => {
		// Never drops a newer call that replaced a stale one.
		if (inflight.get(key) === entry) inflight.delete(key);
	});
	inflight.set(key, entry);
	return entry.promise;
}
