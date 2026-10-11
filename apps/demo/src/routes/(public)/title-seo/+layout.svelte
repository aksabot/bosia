<script lang="ts">
	import Seo from "$lib/components/Seo.svelte";
	let { children } = $props();
</script>

<!-- The title comes from a child component, which the build can't read. -->
<Seo title="Seo · Bosia Demo" />

<nav class="flex gap-3 text-sm mb-4" data-title-seo-nav>
	<a class="underline" href="/title-seo">plain</a>
	<a class="underline" href="/title-seo/named">named</a>
	<a class="underline" href="/title-redirect">redirect</a>
</nav>

{@render children()}
