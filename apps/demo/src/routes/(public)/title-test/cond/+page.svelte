<script lang="ts">
	let shown = $state(false);
</script>

<!-- A page title that doesn't render: the layout's title shows. -->
<svelte:head>
	{#if shown}
		<title>Shown | Title Test</title>
	{/if}
</svelte:head>

<h1 class="text-2xl font-bold">Conditional</h1>
<button class="underline" onclick={() => (shown = true)}>show title</button>
