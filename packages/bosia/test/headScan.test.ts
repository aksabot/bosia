import { describe, expect, test } from "bun:test";

import { titleText } from "../src/core/headScan.ts";
import { appHtmlTitle } from "../src/core/appHtml.ts";
import type { AppHtmlSegments } from "../src/core/appHtml.ts";

// Client navigation names a page with no title after app.html's <title>, as SSR
// does. titleText has to find the same <title> hasTitle finds, or the two disagree.

describe("titleText()", () => {
	test("reads the text, trimmed, with attributes on the tag", () => {
		expect(titleText(`<meta charset="utf-8">\n<title data-x="1">  Fisika \n</title>`)).toBe(
			"Fisika",
		);
	});

	test("decodes the entities a title uses", () => {
		expect(titleText(`<title>Tom &amp; Jerry &#8212; &#x2603; &lt;3 &quot;hi&quot;</title>`)).toBe(
			`Tom & Jerry — ☃ <3 "hi"`,
		);
		expect(titleText(`<title>&unknown; stays</title>`)).toBe("&unknown; stays");
	});

	test("skips a <title> in a comment, a script or an inline svg", () => {
		const html =
			`<!-- <title>no</title> -->` +
			`<script>document.write("<title>no</title>")</script>` +
			`<svg><title>icon</title></svg>` +
			`<title>yes</title>`;
		expect(titleText(html)).toBe("yes");
	});

	test("null when there is no title", () => {
		expect(titleText(`<meta charset="utf-8">`)).toBeNull();
		expect(titleText(`<!-- <title>commented out</title> -->`)).toBeNull();
	});

	test("an unclosed <title> runs to the end", () => {
		expect(titleText(`<title>Open`)).toBe("Open");
	});
});

describe("appHtmlTitle()", () => {
	const segments = (headOpen: string, headClose: string): AppHtmlSegments => ({
		headOpen,
		headClose,
		tail: "\n</body>\n</html>",
		hasCustomFavicon: false,
	});

	test("finds a title before %bosia.head%", () => {
		expect(appHtmlTitle(segments(`<html><head><title>Fisika</title>`, `</head><body>`))).toBe(
			"Fisika",
		);
	});

	test("finds a title after %bosia.head%, up to </head>", () => {
		expect(appHtmlTitle(segments(`<html><head>`, `<title>After</title></head><body>`))).toBe(
			"After",
		);
	});

	test("ignores a <title> in the body", () => {
		expect(appHtmlTitle(segments(`<html><head>`, `</head><body><title>Body</title>`))).toBeNull();
	});

	test("null for an app.html with no title", () => {
		expect(appHtmlTitle(segments(`<html><head>`, `</head><body>`))).toBeNull();
	});
});
