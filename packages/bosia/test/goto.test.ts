import { beforeEach, describe, expect, mock, test } from "bun:test";

// The real router/appState use Svelte runes, so stand in plain objects. `navigate`
// changes the route unless the target is the current one (its short-circuit).
const router = {
	currentRoute: "/a",
	suppressScroll: false,
	navigate(path: string) {
		if (path !== router.currentRoute) router.currentRoute = path;
	},
};
const appState = { invalidationTick: 0, dirty: { all: false }, navResolvers: [] as (() => void)[] };
mock.module("../src/core/client/router.svelte.ts", () => ({ router }));
mock.module("../src/core/client/appState.svelte.ts", () => ({ appState }));
(globalThis as any).window ??= {};

const { goto } = await import("../src/core/client/navigation.ts");

beforeEach(() => {
	router.currentRoute = "/a";
	router.suppressScroll = false;
	appState.invalidationTick = 0;
	appState.dirty.all = false;
	appState.navResolvers = [];
});

describe("goto", () => {
	test("same URL + invalidateAll bumps the tick and waits for the re-run", () => {
		goto("/a", { invalidateAll: true });
		expect(appState.invalidationTick).toBe(1);
		expect(appState.navResolvers.length).toBe(1);
	});

	test("same URL without invalidateAll resolves now", () => {
		goto("/a");
		expect(appState.invalidationTick).toBe(0);
		expect(appState.navResolvers.length).toBe(0);
	});

	test("noScroll sticks only to a nav that happens", () => {
		goto("/a", { noScroll: true });
		expect(router.suppressScroll).toBe(false);
		goto("/b", { noScroll: true });
		expect(router.suppressScroll).toBe(true);
	});
});
