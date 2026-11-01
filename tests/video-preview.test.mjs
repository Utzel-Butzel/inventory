import test from "node:test";
import assert from "node:assert/strict";
import { videoPreviewSources, videoGalleryMedia } from "../lib/video-preview.ts";

const original = { id: "original", kind: "video", mimeType: "video/mp4", url: "/original", previewMediaId: "preview", posterMediaId: "poster" };
const preview = { id: "preview", kind: "video", mimeType: "video/mp4", url: "/preview" };
const poster = { id: "poster", kind: "image", mimeType: "image/jpeg", url: "/poster" };

test("videos resolve attached previews and posters without duplicating gallery entries", () => {
  const items = [original, preview, poster];
  const sources = videoPreviewSources(original, items);
  assert.equal(sources.src, "/preview");
  assert.equal(sources.poster, "/poster");
  assert.deepEqual(videoGalleryMedia(items), [original]);
  assert.equal(items.length, 3); // underlying media stays available for cleanup
});

test("missing, self-referencing or incorrect preview types fall back to the original", () => {
  assert.equal(videoPreviewSources(original, []).src, original.url);
  assert.equal(videoPreviewSources({ ...original, previewMediaId: original.id }, [original]).src, original.url);
  assert.equal(videoPreviewSources(original, [{ ...preview, kind: "image", mimeType: "image/png" }]).src, original.url);
  assert.equal(videoPreviewSources(original, [{ ...poster, mimeType: "image/svg+xml" }]).poster, undefined);
  assert.deepEqual(videoGalleryMedia([original]), [original]);
});

test("public shares use the supplied scoped delivery URLs", () => {
  const items = [original, { ...preview, url: "/api/public/shares/example/media/preview" }, { ...poster, url: "/api/public/shares/example/media/poster" }];
  const sources = videoPreviewSources(original, items);
  assert.equal(sources.src, items[1].url);
  assert.equal(sources.poster, items[2].url);
});
