export type DocumentPoint = {
  x: number;
  y: number;
};

export type DocumentCorners = [
  DocumentPoint,
  DocumentPoint,
  DocumentPoint,
  DocumentPoint,
];

export type DocumentScanFilter = "color" | "grayscale" | "black-white";

type OpenCv = typeof import("@techstark/opencv-js");

let openCvPromise: Promise<OpenCv> | null = null;

export const loadDocumentScanner = (): Promise<OpenCv> => {
  if (!openCvPromise) {
    openCvPromise = new Promise<OpenCv>((resolve, reject) => {
      if (typeof window === "undefined") {
        reject(new Error("Document scanning is only available in a browser."));
        return;
      }
      const browserWindow = window as typeof window & {
        cv?: OpenCv | Promise<OpenCv>;
      };
      const finish = () => {
        if (!browserWindow.cv) {
          reject(new Error("OpenCV did not initialize."));
          return;
        }
        void Promise.resolve(browserWindow.cv).then(resolve, reject);
      };
      if (browserWindow.cv) {
        finish();
        return;
      }
      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-inventory-opencv="true"]',
      );
      if (existing) {
        existing.addEventListener("load", finish, { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error("OpenCV could not be loaded.")),
          { once: true },
        );
        return;
      }
      const script = document.createElement("script");
      script.src = "/opencv/opencv.js";
      script.async = true;
      script.dataset.inventoryOpencv = "true";
      script.addEventListener("load", finish, { once: true });
      script.addEventListener(
        "error",
        () => reject(new Error("OpenCV could not be loaded.")),
        { once: true },
      );
      document.head.append(script);
    });
  }
  return openCvPromise;
};

export const orderDocumentCorners = (
  points: ReadonlyArray<DocumentPoint>,
): DocumentCorners | null => {
  if (points.length !== 4) return null;

  const bySum = [...points].sort(
    (left, right) => left.x + left.y - (right.x + right.y),
  );
  const byDifference = [...points].sort(
    (left, right) => left.y - left.x - (right.y - right.x),
  );
  const topLeft = bySum[0]!;
  const bottomRight = bySum[3]!;
  const topRight = byDifference[0]!;
  const bottomLeft = byDifference[3]!;
  const ordered = [topLeft, topRight, bottomRight, bottomLeft] as DocumentCorners;
  if (new Set(ordered).size !== 4) return null;
  return ordered;
};

const distance = (left: DocumentPoint, right: DocumentPoint) =>
  Math.hypot(left.x - right.x, left.y - right.y);

export const documentAreaRatio = (
  corners: DocumentCorners,
  width: number,
  height: number,
) => {
  const polygonArea = Math.abs(
    corners.reduce((sum, point, index) => {
      const next = corners[(index + 1) % corners.length]!;
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
  return polygonArea / Math.max(1, width * height);
};

export const normalizedCornerMovement = (
  previous: DocumentCorners,
  current: DocumentCorners,
  width: number,
  height: number,
) =>
  previous.reduce(
    (sum, point, index) =>
      sum +
      Math.hypot(
        (point.x - current[index]!.x) / Math.max(1, width),
        (point.y - current[index]!.y) / Math.max(1, height),
      ),
    0,
  ) / previous.length;

const cornerAnglePenalty = (corners: DocumentCorners) =>
  corners.reduce((penalty, point, index) => {
    const previous = corners[(index + corners.length - 1) % corners.length]!;
    const next = corners[(index + 1) % corners.length]!;
    const first = { x: previous.x - point.x, y: previous.y - point.y };
    const second = { x: next.x - point.x, y: next.y - point.y };
    const denominator = Math.max(
      1,
      Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y),
    );
    return penalty + Math.abs((first.x * second.x + first.y * second.y) / denominator);
  }, 0);

export async function detectDocumentCorners(
  canvas: HTMLCanvasElement,
): Promise<DocumentCorners | null> {
  const cv = await loadDocumentScanner();
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const closed = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const kernel = cv.getStructuringElement(
    cv.MORPH_RECT,
    new cv.Size(5, 5),
  );

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 55, 165, 3, true);
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
    cv.findContours(
      closed,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE,
    );

    const minimumArea = canvas.width * canvas.height * 0.16;
    let best: { corners: DocumentCorners; score: number } | null = null;

    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      const approximation = new cv.Mat();
      try {
        const area = Math.abs(cv.contourArea(contour));
        if (area < minimumArea) continue;
        const perimeter = cv.arcLength(contour, true);
        cv.approxPolyDP(contour, approximation, perimeter * 0.022, true);
        if (approximation.rows !== 4 || !cv.isContourConvex(approximation)) {
          continue;
        }
        const raw = approximation.data32S;
        const corners = orderDocumentCorners([
          { x: raw[0]!, y: raw[1]! },
          { x: raw[2]!, y: raw[3]! },
          { x: raw[4]!, y: raw[5]! },
          { x: raw[6]!, y: raw[7]! },
        ]);
        if (!corners) continue;
        const areaRatio = documentAreaRatio(corners, canvas.width, canvas.height);
        const shortestEdge = Math.min(
          ...corners.map((point, cornerIndex) =>
            distance(point, corners[(cornerIndex + 1) % corners.length]!),
          ),
        );
        if (areaRatio < 0.16 || shortestEdge < Math.min(canvas.width, canvas.height) * 0.18) {
          continue;
        }
        const score = areaRatio - cornerAnglePenalty(corners) * 0.035;
        if (!best || score > best.score) best = { corners, score };
      } finally {
        approximation.delete();
        contour.delete();
      }
    }

    return best?.corners ?? null;
  } finally {
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    closed.delete();
    contours.delete();
    hierarchy.delete();
    kernel.delete();
  }
}

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Unable to encode scan."))),
      type,
      quality,
    );
  });

const outputDimensions = (corners: DocumentCorners) => {
  const measuredWidth = Math.max(
    distance(corners[0], corners[1]),
    distance(corners[3], corners[2]),
  );
  const measuredHeight = Math.max(
    distance(corners[0], corners[3]),
    distance(corners[1], corners[2]),
  );
  const maximum = 2_400;
  const scale = Math.min(1, maximum / Math.max(measuredWidth, measuredHeight));
  return {
    width: Math.max(480, Math.round(measuredWidth * scale)),
    height: Math.max(480, Math.round(measuredHeight * scale)),
  };
};

export async function captureDocumentPage(options: {
  video: HTMLVideoElement;
  corners: DocumentCorners | null;
  filter: DocumentScanFilter;
}) {
  const { video } = options;
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("Camera preview is not ready.");
  }
  const sourceScale = Math.min(
    1,
    2_800 / Math.max(video.videoWidth, video.videoHeight),
  );
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = Math.round(video.videoWidth * sourceScale);
  sourceCanvas.height = Math.round(video.videoHeight * sourceScale);
  const context = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable.");
  context.drawImage(video, 0, 0, sourceCanvas.width, sourceCanvas.height);

  const corners = (options.corners ?? [
    { x: 0, y: 0 },
    { x: video.videoWidth, y: 0 },
    { x: video.videoWidth, y: video.videoHeight },
    { x: 0, y: video.videoHeight },
  ]).map((point) => ({
    x: point.x * sourceScale,
    y: point.y * sourceScale,
  })) as DocumentCorners;
  const dimensions = outputDimensions(corners);
  const cv = await loadDocumentScanner();
  const src = cv.imread(sourceCanvas);
  const warped = new cv.Mat();
  const enhanced = new cv.Mat();
  const sourcePoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
    corners[0].x,
    corners[0].y,
    corners[1].x,
    corners[1].y,
    corners[2].x,
    corners[2].y,
    corners[3].x,
    corners[3].y,
  ]);
  const destinationPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,
    0,
    dimensions.width - 1,
    0,
    dimensions.width - 1,
    dimensions.height - 1,
    0,
    dimensions.height - 1,
  ]);
  const transform = cv.getPerspectiveTransform(sourcePoints, destinationPoints);

  try {
    cv.warpPerspective(
      src,
      warped,
      transform,
      new cv.Size(dimensions.width, dimensions.height),
      cv.INTER_CUBIC,
      cv.BORDER_REPLICATE,
    );

    if (options.filter === "black-white") {
      const gray = new cv.Mat();
      try {
        cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
        cv.adaptiveThreshold(
          gray,
          enhanced,
          255,
          cv.ADAPTIVE_THRESH_GAUSSIAN_C,
          cv.THRESH_BINARY,
          31,
          13,
        );
      } finally {
        gray.delete();
      }
    } else if (options.filter === "grayscale") {
      cv.cvtColor(warped, enhanced, cv.COLOR_RGBA2GRAY);
      cv.equalizeHist(enhanced, enhanced);
    } else {
      const soft = new cv.Mat();
      try {
        cv.GaussianBlur(warped, soft, new cv.Size(0, 0), 2.2);
        cv.addWeighted(warped, 1.28, soft, -0.28, 6, enhanced);
      } finally {
        soft.delete();
      }
    }

    const outputCanvas = document.createElement("canvas");
    cv.imshow(outputCanvas, enhanced);
    return {
      blob: await canvasBlob(outputCanvas, "image/jpeg", 0.91),
      width: outputCanvas.width,
      height: outputCanvas.height,
    };
  } finally {
    src.delete();
    warped.delete();
    enhanced.delete();
    sourcePoints.delete();
    destinationPoints.delete();
    transform.delete();
  }
}

export type OcrProgress = {
  page: number;
  pageCount: number;
  progress: number;
  status: string;
};

export async function createSearchableScanPdf(
  pages: ReadonlyArray<Blob>,
  onProgress?: (progress: OcrProgress) => void,
) {
  if (!pages.length) throw new Error("Scan at least one page first.");
  const Tesseract = await import("tesseract.js");
  const { PDFDocument } = await import("pdf-lib");
  let activePage = 0;
  const worker = await Tesseract.createWorker(
    ["deu", "eng"],
    Tesseract.OEM.LSTM_ONLY,
    {
      workerPath: `${window.location.origin}/tesseract/worker.min.js`,
      corePath: `${window.location.origin}/tesseract-core`,
      langPath: `${window.location.origin}/tessdata`,
      gzip: true,
      logger: (message) =>
        onProgress?.({
          page: activePage + 1,
          pageCount: pages.length,
          progress: message.progress,
          status: message.status,
        }),
    },
  );

  try {
    const pagePdfs: Uint8Array[] = [];
    for (const [index, page] of pages.entries()) {
      activePage = index;
      onProgress?.({
        page: index + 1,
        pageCount: pages.length,
        progress: 0,
        status: "recognizing text",
      });
      const result = await worker.recognize(
        page,
        { pdfTitle: "Inventory document scan" },
        { text: true, pdf: true },
      );
      if (!result.data.pdf?.length) {
        throw new Error(`OCR did not create PDF page ${index + 1}.`);
      }
      pagePdfs.push(Uint8Array.from(result.data.pdf));
    }

    const merged = await PDFDocument.create();
    merged.setTitle("Inventory document scan");
    merged.setCreator("Open Inventory document scanner");
    for (const pagePdf of pagePdfs) {
      const source = await PDFDocument.load(pagePdf);
      const copied = await merged.copyPages(source, source.getPageIndices());
      copied.forEach((page) => merged.addPage(page));
    }
    onProgress?.({
      page: pages.length,
      pageCount: pages.length,
      progress: 1,
      status: "creating PDF",
    });
    const bytes = await merged.save({ useObjectStreams: true });
    return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  } finally {
    await worker.terminate();
  }
}

export const scannerFilename = (
  kind: "photo" | "video" | "document",
  mimeType: string,
  date = new Date(),
) => {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  const extension = kind === "document"
    ? "pdf"
    : mimeType.includes("webm")
      ? "webm"
      : kind === "video"
        ? "mp4"
        : "jpg";
  return `inventory-${kind}-${stamp}.${extension}`;
};
