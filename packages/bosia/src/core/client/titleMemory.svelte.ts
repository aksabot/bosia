// The title each layout depth shows, read at run time. Svelte writes a
// <svelte:head><title> only on mount or when its value changes, so a layout
// that stays mounted through a navigation never writes it again. A
// <TitleProbe> after each layout (App.svelte) notes the title written since
// the probe above it — that layout's own, a <Seo> in it, a dynamic one —
// so navigation can put it back.

/** Bumped once per navigation, so every probe reads again in that flush. */
export const titleNav = $state({ seq: 0 });

/** Per layout depth: the title the layouts down to it show, or null for none. */
export const chainTitles: (string | null)[] = [];

/** Per layout component: the title it wrote last. Kept here, not in the probe,
 *  since a layout that wraps its children in {#key} remounts the probe but
 *  doesn't write its title again. */
export const layoutTitles = new Map<unknown, string>();

// One record per page, on window, so a second copy of this module (a duplicate
// chunk, a dev reload) shares the patch instead of finding it taken.
type TitleWrites = { written: string | null; gen: number; patched: boolean };
const KEY = "__bosiaTitleWrites";
const store: TitleWrites =
	typeof window === "undefined"
		? { written: null, gen: 0, patched: false }
		: ((window as any)[KEY] ??= { written: null, gen: 0, patched: false });

/** The last title written since the previous call, or null. */
export function takeTitleWrite(): string | null {
	const w = store.written;
	store.written = null;
	return w;
}

// Every write to document.title, from Svelte or anyone, passes through here.
// The probes run in tree order, each right after its layout's head effects,
// so the write each one takes is its layout's. A write is kept only until the
// next microtask: Svelte flushes in one go, so a probe sees the writes of its
// own flush, never a page's from an earlier one.
if (typeof document !== "undefined" && !store.patched) {
	const native = Object.getOwnPropertyDescriptor(Document.prototype, "title");
	if (native?.get && native.set && !Object.prototype.hasOwnProperty.call(document, "title")) {
		const { get, set } = native;
		Object.defineProperty(document, "title", {
			configurable: true,
			get() {
				return get.call(this);
			},
			set(v: string) {
				set.call(this, v);
				store.written = get.call(this);
				const gen = ++store.gen;
				queueMicrotask(() => {
					if (store.gen === gen) store.written = null;
				});
			},
		});
		store.patched = true;
	} else if (process.env.NODE_ENV !== "production") {
		console.warn(
			"[bosia] document.title is already overridden, so client navigation can't put a layout's title back.",
		);
	}
}
