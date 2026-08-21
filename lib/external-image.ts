import "server-only";

import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";

import sharp from "sharp";

import { isPrivateWebhookAddress } from "@/lib/webhook-contract";

const maximumDownloadBytes = 15_000_000;
const maximumInputPixels = 64_000_000;
const maximumOutputDimension = 2_048;
const maximumRedirects = 4;

function validatePublicImageUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The image search returned an invalid image URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("The searched image must be available over HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("The searched image URL must not contain credentials.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isPrivateWebhookAddress(hostname)
  ) {
    throw new Error("The searched image must be hosted on a public network.");
  }
  url.hostname = hostname;
  url.hash = "";
  return url;
}

async function resolvePublicAddresses(url: URL) {
  const lookupPromise = lookup(url.hostname, { all: true, verbatim: true });
  const addresses = await Promise.race([
    lookupPromise,
    new Promise<never>((_, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("The searched image host did not resolve in time.")),
        10_000,
      );
      timeout.unref?.();
    }),
  ]);
  if (!addresses.length) {
    throw new Error("The searched image host could not be resolved.");
  }
  if (addresses.some(({ address }) => isPrivateWebhookAddress(address))) {
    throw new Error("The searched image host resolves to a private network.");
  }
  return addresses;
}

function pinnedLookupFor(
  addresses: Awaited<ReturnType<typeof resolvePublicAddresses>>,
): LookupFunction {
  return (_hostname, options, callback) => {
    const candidates =
      options.family === 4 || options.family === 6
        ? addresses.filter(({ family }) => family === options.family)
        : addresses;
    if (!candidates.length) {
      const error = new Error(
        "The searched image host has no address in the requested family.",
      ) as NodeJS.ErrnoException;
      error.code = "ENOTFOUND";
      callback(error, []);
      return;
    }
    if (options.all) {
      callback(null, candidates);
      return;
    }
    const [candidate] = candidates;
    callback(null, candidate!.address, candidate!.family);
  };
}

async function downloadOnce(url: URL) {
  const addresses = await resolvePublicAddresses(url);
  const signal = AbortSignal.timeout(30_000);

  return new Promise<
    | { kind: "redirect"; location: string }
    | { kind: "image"; bytes: Buffer; contentType: string }
  >((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: {
          Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
          "User-Agent": "InventoryImageFetcher/1.0",
        },
        lookup: pinnedLookupFor(addresses),
        signal,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location) {
          response.resume();
          resolve({ kind: "redirect", location });
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(
            new Error(`Unable to download the searched image (HTTP ${status}).`),
          );
          return;
        }

        const contentTypeHeader = response.headers["content-type"];
        const contentType = (
          Array.isArray(contentTypeHeader)
            ? contentTypeHeader[0]
            : contentTypeHeader
        )
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        if (!contentType?.startsWith("image/")) {
          response.resume();
          reject(new Error("The searched URL did not return an image."));
          return;
        }

        const declaredLength = Number(response.headers["content-length"] ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > maximumDownloadBytes) {
          response.resume();
          reject(new Error("The searched image is too large to import."));
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer | Uint8Array) => {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > maximumDownloadBytes) {
            response.destroy(new Error("The searched image is too large to import."));
            return;
          }
          chunks.push(bytes);
        });
        response.once("end", () => {
          resolve({
            kind: "image",
            bytes: Buffer.concat(chunks, size),
            contentType,
          });
        });
        response.once("error", reject);
      },
    );
    request.once("error", reject);
    request.end();
  });
}

export async function downloadExternalImage(value: string) {
  let url = validatePublicImageUrl(value);
  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
    const result = await downloadOnce(url);
    if (result.kind === "redirect") {
      if (redirectCount === maximumRedirects) {
        throw new Error("The searched image redirected too many times.");
      }
      url = validatePublicImageUrl(new URL(result.location, url).toString());
      continue;
    }

    const image = sharp(result.bytes, {
      failOn: "warning",
      limitInputPixels: maximumInputPixels,
    });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("The searched image dimensions could not be read.");
    }
    if ((metadata.pages ?? 1) !== 1) {
      throw new Error("Animated or multi-page searched images are not supported.");
    }
    const bytes = await image
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({
        width: maximumOutputDimension,
        height: maximumOutputDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    return {
      bytes,
      mimeType: "image/jpeg" as const,
      finalUrl: url.toString(),
    };
  }
  throw new Error("Unable to download the searched image.");
}
