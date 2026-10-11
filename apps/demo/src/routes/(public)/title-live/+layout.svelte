<script lang="ts">
	let { children } = $props();
	// State, so the title compiles to an expression, not static text.
	let site = $state("Live");
</script>

<!-- A layout title from an expression: client navigation remembers what it wrote. -->
<svelte:head>
	<title>{site} · Bosia Demo</title>
</svelte:head>

<nav class="flex gap-3 text-sm mb-4" data-title-live-nav>
	<a class="underline" href="/title-live">plain</a>
	<a class="underline" href="/title-live/named">named</a>
</nav>

{@render children()}
