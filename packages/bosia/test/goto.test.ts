import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// The real router/appState use Svelte runes, so stand in plain objects. `navigate`
// reports `next` (default: "same" on the current route, else "started").
let next: string | null = null;
const router = {
	currentRoute: "/a",
	suppressScroll: false,
	navigate(path: string) {
		const result = next ?? (path === router.currentRoute ? "same" : "started");
		if (result === "started") router.currentRoute = path;
		return result;
	},
};
const appState = {
	invalidationTick: 0,
	dirty: { all: false },
	navResolvers: [] as (() => void)[],
};
mock.module("../src/core/client/router.svelte.ts", () => ({ router }));
mock.module("../src/core/client/appState.svelte.ts", () => ({ appState }));
// Only this file needs a browser `window`; later files must still see the server.
const hadWindow = "window" in globalThis;
if (!hadWindow) (globalThis as any).window = {};
afterAll(() => {
	if (!hadWindow) delete (globalThis as any).window;
});

const { goto, go } = await import("../src/core/client/navigation.ts");

beforeEach(() => {
	next = null;
	router.currentRoute = "/a";
	router.suppressScroll = false;
	appState.invalidationTick = 0;
	appState.dirty.all = false;
	appState.navResolvers = [];
});

describe("goto", () => {
	test("same URL + invalidateAll bumps the tick and waits for the re-run", () => {
		goto("/a", { invalidateAll: true });
		expect(appState.dirty.all).toBe(true);
		expect(appState.invalidationTick).toBe(1);
		expect(appState.navResolvers.length).toBe(1);
	});

	test("same URL without invalidateAll resolves now", () => {
		goto("/a");
		expect(appState.invalidationTick).toBe(0);
		expect(appState.navResolvers.length).toBe(0);
	});

	test("noScroll sticks only to a nav that starts", () => {
		goto("/a", { noScroll: true });
		expect(router.suppressScroll).toBe(false);
		goto("/b", { noScroll: true });
		expect(router.suppressScroll).toBe(true);
	});

	for (const result of ["cancelled", "left"]) {
		test(`${result} nav marks nothing and resolves now`, () => {
			next = result;
			goto("/b", { invalidateAll: true, noScroll: true });
			expect(appState.dirty.all).toBe(false);
			expect(appState.invalidationTick).toBe(0);
			expect(router.suppressScroll).toBe(false);
			expect(appState.navResolvers.length).toBe(0);
		});
	}
});

describe("go (use:enhance redirect)", () => {
	test("a no-op call resolves itself, not a nav still loading", async () => {
		const loading = goto("/b");
		let loadingDone = false;
		loading.then(() => (loadingDone = true));
		await go("/b", {}, false);
		await Promise.resolve();
		expect(loadingDone).toBe(false);
		expect(appState.navResolvers.length).toBe(1);
	});
});
