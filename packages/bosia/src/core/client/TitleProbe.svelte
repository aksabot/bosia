<script lang="ts">
	import { chainTitles, layoutTitles, takeTitleWrite, titleNav } from "./titleMemory.svelte.ts";

	// Sits after layout `depth`, before what it wraps, and takes the title that
	// layout wrote. `layout` is the layout component, the key it is remembered by.
	let { depth, layout }: { depth: number; layout: unknown } = $props();

	$effect(() => {
		titleNav.seq; // read again on every navigation
		const w = takeTitleWrite();
		if (w !== null) layoutTitles.set(layout, w);
		chainTitles[depth] =
			layoutTitles.get(layout) ?? (depth > 0 ? (chainTitles[depth - 1] ?? null) : null);
	});
</script>
