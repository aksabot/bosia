<script lang="ts">
	import type { ErrorProps } from "./$types";
	let { error }: ErrorProps = $props();
</script>

<svelte:head>
	<title>Oops {error.status}</title>
</svelte:head>

<p class="text-2xl font-bold">Error {error.status}</p>
<a class="underline" href="/title-error" data-back>Back</a>
