<script lang="ts">
	// A stand-in for an SEO component that writes the title for its parent.
	let { title }: { title: string } = $props();
</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>
