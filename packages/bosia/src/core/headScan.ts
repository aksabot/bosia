// Finding the <title> in a chunk of head markup. Pure string code with no
// imports, so build.ts and appHtml.ts can use it too — html.ts reads the dist
// manifest the moment it loads, which neither of them can afford.

/** The title a page gets when nothing else sets one. */
export const DEFAULT_TITLE = "Bosia App";

/** Whether a chunk of head markup already sets the document title. Matches a
 *  <title> with attributes too. Ignores one in a comment, an attribute value, a
 *  script or JSON-LD string, <style>, <noscript>, <template>, or an inline <svg>
 *  (which only labels the icon). */
export function hasTitle(html: string): boolean {
	return titleTagEnd(html) !== -1;
}

/** The raw text of the <title> that hasTitle finds, or null when there is none.
 *  Whitespace is collapsed and trimmed as document.title does; entities are left
 *  for the browser to decode. An unclosed <title> runs to the end, as in a browser. */
export function titleText(html: string): string | null {
	const start = titleTagEnd(html);
	if (start === -1) return null;
	const m = /<\/title(?=[\t\n\f\r />])/i.exec(html.slice(start));
	const raw = m ? html.slice(start, start + m.index) : html.slice(start);
	return raw.replace(/[\t\n\f\r ]+/g, " ").trim();
}

/** Index just past the `>` of the first real <title> tag, or -1. */
function titleTagEnd(html: string): number {
	// A single forward scan, not a regex: a lazy `<script…</script>` match retries
	// from every unclosed `<script` and goes quadratic on hostile {@html} output.
	// Each tag is skipped whole, quotes included, so nothing inside an attribute
	// looks like a tag. This is a heuristic, not a full HTML tokenizer.
	let unclosed: Set<string> | undefined;
	let i = 0;
	while ((i = html.indexOf("<", i)) !== -1) {
		if (html.startsWith("<!--", i)) {
			i = commentEnd(html, i);
			if (i === -1) return -1; // unclosed comment runs to the end
			continue;
		}
		if (!isAsciiAlpha(html.charCodeAt(i + 1))) {
			i++;
			continue;
		}
		const nameEnd = tagNameEnd(html, i + 1);
		const tagEnd = openTagEnd(html, nameEnd);
		if (tagEnd === -1) return -1; // the rest is inside an unfinished tag
		const name = nameEnd - i - 1 <= MAX_NAME ? html.slice(i + 1, nameEnd).toLowerCase() : "";
		if (name === "title") return tagEnd;
		i = tagEnd;
		const close = SKIPPED_TAGS.get(name);
		// Only foreign content like <svg/> honors the self-closing slash.
		const selfClosed = name === "svg" && html.charCodeAt(tagEnd - 2) === 47;
		if (!close || selfClosed || unclosed?.has(name)) continue;
		// An opener with no closer is read as a plain tag, and remembered, so
		// later openers of that tag don't search to the end again.
		close.lastIndex = tagEnd;
		const gt = close.exec(html) ? html.indexOf(">", close.lastIndex) : -1;
		if (gt === -1) (unclosed ??= new Set()).add(name);
		else i = gt + 1;
	}
	return -1;
}

/** `</tag` followed by whitespace, `/` or `>`; the caller finds the `>` itself,
 *  since a `[^>]*>` here would rescan to the end for every candidate. */
const SKIPPED_TAGS = new Map(
	["script", "style", "noscript", "template", "svg"].map((t) => [
		t,
		new RegExp(`</${t}(?=[\\t\\n\\f\\r />])`, "gi"),
	]),
);

/** Longest tag name the scan needs to tell apart; longer names are never sliced. */
const MAX_NAME = Math.max("title".length, ...[...SKIPPED_TAGS.keys()].map((t) => t.length));

/** Index just past the comment opening at `start`, or -1 when it never closes.
 *  `<!-->` and `<!--->` are complete empty comments. */
function commentEnd(html: string, start: number): number {
	if (html.startsWith(">", start + 4)) return start + 5;
	if (html.startsWith("->", start + 4)) return start + 6;
	const end = html.indexOf("-->", start + 4);
	return end === -1 ? -1 : end + 3;
}

/** End of the tag name starting at `start`: the first whitespace, `/` or `>`. */
function tagNameEnd(html: string, start: number): number {
	let j = start;
	while (j < html.length) {
		const c = html.charCodeAt(j);
		if (isHtmlSpace(c) || c === 47 || c === 62) break;
		j++;
	}
	return j;
}

/** Index just past the `>` closing a start tag, skipping quoted attribute
 *  values, or -1 when the tag never closes. */
function openTagEnd(html: string, from: number): number {
	for (let j = from; j < html.length; j++) {
		const c = html.charCodeAt(j);
		if (c === 62) return j + 1;
		if (c !== 61) continue; // `=` starts a value
		do j++;
		while (j < html.length && isHtmlSpace(html.charCodeAt(j)));
		const q = html.charCodeAt(j);
		if (q === 34 || q === 39) {
			j = html.indexOf(html[j]!, j + 1);
			if (j === -1) return -1;
			continue;
		}
		// Unquoted: runs to whitespace or `>`, quotes and `=` included.
		while (j < html.length && !isHtmlSpace(html.charCodeAt(j)) && html.charCodeAt(j) !== 62) j++;
		j--;
	}
	return -1;
}

/** HTML whitespace: tab, LF, FF, CR, space. Not \s, which also matches NBSP. */
function isHtmlSpace(c: number): boolean {
	return c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
}

function isAsciiAlpha(c: number): boolean {
	return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}
