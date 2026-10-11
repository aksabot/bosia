<script lang="ts">
	let { children } = $props();
	const site = "Live";
</script>

<!-- A dynamic layout title: client navigation can't know it, so it uses the default. -->
<svelte:head>
	<title>{site} · Bosia Demo</title>
</svelte:head>

<nav class="flex gap-3 text-sm mb-4" data-title-live-nav>
	<a class="underline" href="/title-live">plain</a>
	<a class="underline" href="/title-live/named">named</a>
</nav>

{@render children()}
