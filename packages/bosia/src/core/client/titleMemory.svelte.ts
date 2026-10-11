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

let written: string | null = null;

/** The last title written since the previous call, or null. */
export function takeTitleWrite(): string | null {
	const w = written;
	written = null;
	return w;
}

// Every write to document.title, from Svelte or anyone, passes through here.
// The probes run in tree order, each right after its layout's head effects,
// so the write each one takes is its layout's.
if (typeof document !== "undefined" && !Object.hasOwn(document, "title")) {
	const native = Object.getOwnPropertyDescriptor(Document.prototype, "title");
	if (native?.get && native.set) {
		const { get, set } = native;
		Object.defineProperty(document, "title", {
			configurable: true,
			get() {
				return get.call(this);
			},
			set(v: string) {
				set.call(this, v);
				written = get.call(this);
			},
		});
	}
}
