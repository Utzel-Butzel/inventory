export class MultipartBodyTooLargeError extends Error {}

export async function readBoundedMultipart(request: Request, maximumBytes: number) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data") || !request.body) {
    throw new Error("Expected a multipart upload.");
  }
  const length = request.headers.get("content-length");
  if (length !== null) {
    const bytes = Number(length);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid Content-Length.");
    if (bytes > maximumBytes) throw new MultipartBodyTooLargeError();
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new MultipartBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(Buffer.concat(chunks, bytes), { headers: { "Content-Type": contentType } }).formData();
}
