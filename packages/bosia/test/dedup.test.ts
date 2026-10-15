import { describe, expect, test } from "bun:test";
import { dedup, dedupKey } from "../src/core/dedup.ts";
import { join } from "path";

describe("dedupKey()", () => {
	test("returns pathname when no query", () => {
		expect(dedupKey(new URL("https://x.test/blog"))).toBe("/blog");
	});

	test("normalizes trailing slash on non-root paths", () => {
		expect(dedupKey(new URL("https://x.test/blog/"))).toBe("/blog");
	});

	test("preserves root /", () => {
		expect(dedupKey(new URL("https://x.test/"))).toBe("/");
	});

	test("sorts query params for stable keys", () => {
		const a = dedupKey(new URL("https://x.test/list?b=2&a=1"));
		const b = dedupKey(new URL("https://x.test/list?a=1&b=2"));
		expect(a).toBe(b);
		expect(a).toBe("/list?a=1&b=2");
	});

	test("different paths produce different keys", () => {
		expect(dedupKey(new URL("https://x.test/a"))).not.toBe(dedupKey(new URL("https://x.test/b")));
	});
});

describe("dedup()", () => {
	test("concurrent calls with same key share one inflight promise", async () => {
		let calls = 0;
		const fn = async () => {
			calls++;
			await Bun.sleep(20);
			return "result";
		};
		const [a, b, c] = await Promise.all([dedup("k", fn), dedup("k", fn), dedup("k", fn)]);
		expect(calls).toBe(1);
		expect(a).toBe("result");
		expect(b).toBe("result");
		expect(c).toBe("result");
	});

	test("different keys do not share", async () => {
		let calls = 0;
		const fn = async () => {
			calls++;
			return calls;
		};
		await Promise.all([dedup("a", fn), dedup("b", fn)]);
		expect(calls).toBe(2);
	});

	test("entry removed after settle so subsequent calls re-run", async () => {
		let calls = 0;
		const fn = async () => {
			calls++;
			return calls;
		};
		await dedup("k2", fn);
		await dedup("k2", fn);
		expect(calls).toBe(2);
	});

	test("entry removed even when fn rejects", async () => {
		let calls = 0;
		const fn = async () => {
			calls++;
			throw new Error("boom");
		};
		await expect(dedup("k3", fn)).rejects.toThrow("boom");
		await expect(dedup("k3", fn)).rejects.toThrow("boom");
		expect(calls).toBe(2);
	});

	test("a call older than maxAgeMs isn't joined, and its late finish keeps the new one", async () => {
		let release!: () => void;
		const stuck = dedup("k4", () => new Promise<string>((r) => (release = () => r("old"))), 80);
		await Bun.sleep(90);
		let runs = 0;
		const fresh = () => {
			runs++;
			return new Promise<string>((r) => setTimeout(() => r("new"), 20));
		};
		const a = dedup("k4", fresh, 80);
		release();
		await stuck;
		// The old call settled; the new one is still in flight and still joined.
		const b = dedup("k4", fresh, 80);
		expect(await a).toBe("new");
		expect(await b).toBe("new");
		expect(runs).toBe(1);
	});
});

describe("a stuck build past CACHE_WAIT_TIMEOUT", () => {
	// CACHE_WAIT_TIMEOUT is read at import, so this runs in its own process.
	test("waiters and the next leader don't join its dedup() call", async () => {
		const script = `
			const { coalesceMiss } = await import(${JSON.stringify(join(import.meta.dir, "../src/core/cache.ts"))});
			const { dedup } = await import(${JSON.stringify(join(import.meta.dir, "../src/core/dedup.ts"))});
			const leader = coalesceMiss("k");
			dedup("k", () => new Promise(() => {}), 40);
			// Same order as the data endpoint: gate first, then dedup.
			const run = async () => {
				const gate = coalesceMiss("k");
				let fresh = false;
				if (gate.wait) fresh = !(await gate.wait);
				else fresh = gate.stale;
				return dedup("k", async () => "ok", 40, fresh);
			};
			const timeout = new Promise((r) => setTimeout(() => r("hung"), 1000));
			const waiters = await Promise.race([Promise.all(Array.from({ length: 20 }, run)), timeout]);
			await Bun.sleep(50);
			const next = await Promise.race([run(), timeout]);
			// The stuck leader's gate was replaced: it must not write.
			const owned = leader.current();
			// A request that joins a stuck call still gives up at maxAgeMs.
			let runs = 0;
			dedup("j", () => new Promise(() => {}), 40);
			const joiners = await Promise.race([
				Promise.all(Array.from({ length: 5 }, () => dedup("j", () => (runs++, Bun.sleep(20).then(() => "ok")), 40))),
				timeout,
			]);
			console.log(JSON.stringify({ waiters, next, owned, joiners, runs }));
		`;
		const proc = Bun.spawn(["bun", "-e", script], {
			env: { ...process.env, CACHE_WAIT_TIMEOUT: "40" },
			stdout: "pipe",
			stderr: "pipe",
		});
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		const line = out.trim().split("\n").pop()!;
		const result = JSON.parse(line);
		expect(result.waiters).toEqual(Array(20).fill("ok"));
		expect(result.next).toBe("ok");
		expect(result.owned).toBe(false);
		expect(result.joiners).toEqual(Array(5).fill("ok"));
		expect(result.runs).toBe(1);
	});
});
