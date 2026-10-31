// Browsers (including Safari) request byte ranges when loading/seeking videos.
export function mediaByteResponse(bytes: Uint8Array, range: string | null, inputHeaders: HeadersInit) {
  const headers = new Headers(inputHeaders);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(bytes.length));
  if (!range) return new Response(new Uint8Array(bytes), { headers });
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start = 0;
  let end = bytes.length - 1;
  if (match && (match[1] || match[2])) {
    if (!match[1]) start = Math.max(0, bytes.length - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
  } else start = -1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= bytes.length) {
    headers.set("Content-Range", `bytes */${bytes.length}`);
    headers.set("Content-Length", "0");
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status: 206, headers });
}
