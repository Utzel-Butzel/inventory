import assert from "node:assert/strict";
import test from "node:test";

import {
  markdownToPlainText,
  renderSimpleMarkdown,
} from "../lib/simple-markdown.ts";

test("renders the Markdown supported by the visual description editor", () => {
  const html = renderSimpleMarkdown(
    "# Heading\n\n- **Bold**\n- <u>Underlined</u>\n- [Link](https://example.com)\n\n> Quoted",
  );

  assert.match(html, /<h1/);
  assert.match(html, /<ul/);
  assert.match(html, /<strong/);
  assert.match(html, /<u class="underline underline-offset-2">Underlined<\/u>/);
  assert.match(html, /<a [^>]*href="https:\/\/example\.com\/"/);
  assert.match(html, /<blockquote/);
});

test("escapes HTML and rejects unsafe Markdown URLs", () => {
  const html = renderSimpleMarkdown(
    '<script>alert("x")</script>\n\n[Unsafe](javascript:alert(1))',
  );

  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
});

test("creates clean excerpts from Markdown descriptions", () => {
  assert.equal(
    markdownToPlainText(
      "## Heading\n\n- **Bold** <u>Underlined</u> [Link](https://example.com) ![Photo](/photo.jpg)",
    ),
    "Heading Bold Underlined Link Photo",
  );
});
