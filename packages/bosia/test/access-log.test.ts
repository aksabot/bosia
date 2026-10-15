import { describe, expect, test } from "bun:test";
import { BosiaApp } from "../src/core/backend.ts";
import { accessLog, type AccessLogOptions } from "../src/core/plugins/access-log.ts";

async function appWith(options: AccessLogOptions) {
	const plugin = accessLog(options);
	let app = new BosiaApp();
	app = (await plugin.backend!.before!(app)) ?? app;
	return app;
}

describe("accessLog plugin", () => {
	test("declares plugin name", () => {
		expect(accessLog({ write: () => {} }).name).toBe("access-log");
	});

	test("logs method, path without query, status and duration", async () => {
		const out: string[] = [];
		const app = (await appWith({ write: (c) => out.push(c), flushMs: 0 }))
			.get("/blog", () => "ok")
			.get("/missing", ({ set }) => {
				set.status = 404;
				return "nope";
			});
		await app.fetch(new Request("http://localhost/blog?x=1"));
		await app.fetch(new Request("http://localhost/missing"));
		expect(out[0]).toMatch(/^\[GET\] \/blog 200 \(\d+\.\dms\)\n$/);
		expect(out[1]).toMatch(/^\[GET\] \/missing 404 /);
	});

	test("a request that throws is logged as 500", async () => {
		const out: string[] = [];
		const app = (await appWith({ write: (c) => out.push(c), flushMs: 0 })).get("/boom", () => {
			throw new Error("boom");
		});
		const res = await app.fetch(new Request("http://localhost/boom"));
		expect(res.status).toBe(500);
		expect(out.join("")).toMatch(/^\[GET\] \/boom 500 /);
	});

	test("batches lines into one write per flush", async () => {
		const out: string[] = [];
		const app = (await appWith({ write: (c) => out.push(c), flushMs: 20 })).get("/", () => "ok");
		for (let i = 0; i < 5; i++) await app.fetch(new Request("http://localhost/"));
		expect(out.length).toBe(0);
		await Bun.sleep(50);
		expect(out.length).toBe(1);
		expect(out[0]!.split("\n").filter(Boolean).length).toBe(5);
	});

	test("filter and format are honored", async () => {
		const out: string[] = [];
		const app = (
			await appWith({
				write: (c) => out.push(c),
				flushMs: 0,
				filter: (e) => e.status >= 400,
				format: (e) => `${e.status} ${e.path}`,
			})
		)
			.get("/ok", () => "ok")
			.get("/bad", ({ set }) => {
				set.status = 400;
				return "bad";
			});
		await app.fetch(new Request("http://localhost/ok"));
		await app.fetch(new Request("http://localhost/bad"));
		expect(out).toEqual(["400 /bad\n"]);
	});

	test("a throwing sink doesn't break the response", async () => {
		const app = (
			await appWith({
				write: () => {
					throw new Error("disk full");
				},
				flushMs: 0,
			})
		).get("/", () => "ok");
		const res = await app.fetch(new Request("http://localhost/"));
		expect(await res.text()).toBe("ok");
	});
});
