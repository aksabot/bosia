// ─── Request Deduplication ──────────────────────────────
// Concurrent in-flight coalescing. When N parallel requests hit the same URL,
// run the loader once and share the resolved value across all N waiters.
// Settled responses are NOT cached — once the promise resolves, the entry is
// dropped, so the next request runs the loader again.
//
// The caller's key includes the CACHE_KEYS identity hash (see cache.ts), so
// different users never share a loader result. Custom session cookie names
// must be listed in CACHE_KEYS. See docs/guides/request-deduplication.md.

type Inflight = { promise: Promise<unknown>; start: number; expiry?: Promise<void> };
const inflight = new Map<string, Inflight>();

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
 * take every later request for the key down with it. A call that started
 * before `replaceStartedBefore` is replaced rather than joined (the caller
 * knows it is stuck); later calls join the new one.
 */
export function dedup<T>(
	key: string,
	fn: () => Promise<T>,
	maxAgeMs = 0,
	replaceStartedBefore = -Infinity,
): Promise<T> {
	const existing = inflight.get(key);
	if (existing && existing.start >= replaceStartedBefore) {
		if (maxAgeMs <= 0) return existing.promise as Promise<T>;
		const left = maxAgeMs - (performance.now() - existing.start);
		if (left > 0) {
			// Joined until the call reaches maxAgeMs; one timer per call. Then
			// the first joiner replaces it and the rest join the new call.
			existing.expiry ??= new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, left);
				(timer as { unref?: () => void }).unref?.();
				const stop = () => clearTimeout(timer);
				existing.promise.then(stop, stop);
			});
			return Promise.race([
				existing.promise as Promise<T>,
				existing.expiry.then(() =>
					dedup(key, fn, maxAgeMs, inflight.get(key) === existing ? Infinity : -Infinity),
				),
			]);
		}
	}
	const entry: Inflight = { promise: null as unknown as Promise<T>, start: performance.now() };
	const promise = fn().finally(() => {
		// Never drops a newer call that replaced a stale one.
		if (inflight.get(key) === entry) inflight.delete(key);
	});
	entry.promise = promise;
	inflight.set(key, entry);
	return promise;
}
