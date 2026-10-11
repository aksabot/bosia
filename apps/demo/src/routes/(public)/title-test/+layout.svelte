<script lang="ts">
	let { children } = $props();
</script>

<!-- A static layout title: client navigation puts it back on pages that set none. -->
<svelte:head>
	<title>Title Test &middot; Bosia Demo</title>
</svelte:head>

<nav class="flex gap-3 text-sm mb-4" data-title-nav>
	<a class="underline" href="/title-test">plain</a>
	<a class="underline" href="/title-test/named">named</a>
	<a class="underline" href="/title-test/cond">cond</a>
</nav>

{@render children()}
