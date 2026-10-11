<script lang="ts">
	import { afterNavigate, page } from "bosia/client";
	let { children } = $props();

	// A listener that writes the title, as an unread-count badge would. It runs
	// before Svelte flushes; that write must not pass for a layout's title.
	afterNavigate(() => {
		document.title = document.title;
	});
</script>

<!-- A static layout title: client navigation puts it back on pages that set none. -->
<svelte:head>
	<title>Title Test &middot; Bosia Demo</title>
</svelte:head>

<nav class="flex gap-3 text-sm mb-4" data-title-nav>
	<a class="underline" href="/title-test">plain</a>
	<a class="underline" href="/title-test/named">named</a>
	<a class="underline" href="/title-test/cond">cond</a>
	<a class="underline" href="/page-url-test">away</a>
</nav>

<!-- {#key} remounts what this layout wraps on every page, a page-transition pattern. -->
{#key page.url.pathname}
	{@render children()}
{/key}
