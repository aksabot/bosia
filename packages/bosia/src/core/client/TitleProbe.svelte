<script lang="ts">
	import { chainTitles, takeTitleWrite, titleNav } from "./titleMemory.svelte.ts";

	// Sits after layout `depth`, before what it wraps. It lives as long as that
	// layout does, so `own` remembers the title the layout wrote last.
	let { depth }: { depth: number } = $props();
	let own: string | null = null;

	$effect(() => {
		titleNav.seq; // read again on every navigation
		const w = takeTitleWrite();
		if (w !== null) own = w;
		chainTitles[depth] = own ?? (depth > 0 ? (chainTitles[depth - 1] ?? null) : null);
	});
</script>
