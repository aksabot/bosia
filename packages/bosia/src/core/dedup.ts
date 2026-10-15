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
 * window. With `maxAgeMs` > 0 a call is joined only until it is that old:
 * one that never settles (a hung loader with LOAD_TIMEOUT=0) would otherwise
 * take every later request for the key down with it. `replace` starts a new call even
 * when one is in flight (the caller already knows it is stuck); later calls
 * join the new one.
 */
export function dedup<T>(
	key: string,
	fn: () => Promise<T>,
	maxAgeMs = 0,
	replace = false,
): Promise<T> {
	const existing = inflight.get(key);
	const age = existing ? performance.now() - existing.start : 0;
	if (existing && !replace && (maxAgeMs <= 0 || age < maxAgeMs)) {
		if (maxAgeMs <= 0) return existing.promise as Promise<T>;
		// Joined, but only until the call reaches maxAgeMs: then the first
		// joiner starts a new one and the rest join that.
		const joined = existing.promise as Promise<T>;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				dedup(key, fn, maxAgeMs, inflight.get(key) === existing).then(resolve, reject);
			}, maxAgeMs - age);
			(timer as { unref?: () => void }).unref?.();
			joined.then(
				(v) => {
					clearTimeout(timer);
					resolve(v);
				},
				(e) => {
					clearTimeout(timer);
					reject(e);
				},
			);
		});
	}
	const entry = { promise: null as unknown as Promise<T>, start: performance.now() };
	entry.promise = fn().finally(() => {
		// Never drops a newer call that replaced a stale one.
		if (inflight.get(key) === entry) inflight.delete(key);
	});
	inflight.set(key, entry);
	return entry.promise;
}
