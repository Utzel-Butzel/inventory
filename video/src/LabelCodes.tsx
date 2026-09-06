import { useMemo } from "react";

type QrMatrix = boolean[][];

type RsBlockGroup = {
  count: number;
  totalCodewords: number;
  dataCodewords: number;
};

// QR Code Model 2, error-correction level M. Versions 1–10 cover URLs up to
// 213 UTF-8 bytes while keeping the implementation intentionally small.
const RS_BLOCKS_M: RsBlockGroup[][] = [
  [{ count: 1, totalCodewords: 26, dataCodewords: 16 }],
  [{ count: 1, totalCodewords: 44, dataCodewords: 28 }],
  [{ count: 1, totalCodewords: 70, dataCodewords: 44 }],
  [{ count: 2, totalCodewords: 50, dataCodewords: 32 }],
  [{ count: 2, totalCodewords: 67, dataCodewords: 43 }],
  [{ count: 4, totalCodewords: 43, dataCodewords: 27 }],
  [{ count: 4, totalCodewords: 49, dataCodewords: 31 }],
  [
    { count: 2, totalCodewords: 60, dataCodewords: 38 },
    { count: 2, totalCodewords: 61, dataCodewords: 39 },
  ],
  [
    { count: 3, totalCodewords: 58, dataCodewords: 36 },
    { count: 2, totalCodewords: 59, dataCodewords: 37 },
  ],
  [
    { count: 4, totalCodewords: 69, dataCodewords: 43 },
    { count: 1, totalCodewords: 70, dataCodewords: 44 },
  ],
];

export function canEncodeQr(value: string) {
  return new TextEncoder().encode(value).length <= 213;
}

const ALIGNMENT_POSITIONS: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const gfExponent = new Uint8Array(512);
const gfLogarithm = new Uint8Array(256);

let gfValue = 1;
for (let index = 0; index < 255; index += 1) {
  gfExponent[index] = gfValue;
  gfLogarithm[gfValue] = index;
  gfValue <<= 1;
  if (gfValue & 0x100) gfValue ^= 0x11d;
}
for (let index = 255; index < gfExponent.length; index += 1) {
  gfExponent[index] = gfExponent[index - 255];
}

function gfMultiply(left: number, right: number) {
  if (left === 0 || right === 0) return 0;
  return gfExponent[gfLogarithm[left] + gfLogarithm[right]];
}

function multiplyPolynomials(left: number[], right: number[]) {
  const product = Array.from(
    { length: left.length + right.length - 1 },
    () => 0,
  );
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      product[leftIndex + rightIndex] ^=
        gfMultiply(left[leftIndex], right[rightIndex]);
    }
  }
  return product;
}

function errorCorrectionCodewords(data: number[], count: number) {
  let generator = [1];
  for (let index = 0; index < count; index += 1) {
    generator = multiplyPolynomials(generator, [1, gfExponent[index]]);
  }

  const remainder = [...data, ...Array.from({ length: count }, () => 0)];
  for (let offset = 0; offset < data.length; offset += 1) {
    const coefficient = remainder[offset];
    if (coefficient === 0) continue;
    for (let index = 0; index < generator.length; index += 1) {
      remainder[offset + index] ^=
        gfMultiply(generator[index], coefficient);
    }
  }
  return remainder.slice(data.length);
}

function appendBits(target: number[], value: number, length: number) {
  for (let bit = length - 1; bit >= 0; bit -= 1) {
    target.push((value >>> bit) & 1);
  }
}

function expandedBlocks(version: number) {
  return RS_BLOCKS_M[version - 1].flatMap((group) =>
    Array.from({ length: group.count }, () => ({
      totalCodewords: group.totalCodewords,
      dataCodewords: group.dataCodewords,
    })),
  );
}

function makeCodewords(value: string) {
  const bytes = Array.from(new TextEncoder().encode(value));
  let version = 0;
  for (let candidate = 1; candidate <= RS_BLOCKS_M.length; candidate += 1) {
    const dataCapacity = expandedBlocks(candidate).reduce(
      (total, block) => total + block.dataCodewords,
      0,
    );
    const characterCountBits = candidate < 10 ? 8 : 16;
    if (4 + characterCountBits + bytes.length * 8 <= dataCapacity * 8) {
      version = candidate;
      break;
    }
  }
  if (!version) {
    throw new Error("The inventory URL is too long for the label QR code.");
  }

  const blocks = expandedBlocks(version);
  const dataCapacity = blocks.reduce(
    (total, block) => total + block.dataCodewords,
    0,
  );
  const bitCapacity = dataCapacity * 8;
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4); // Byte mode.
  appendBits(bits, bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) appendBits(bits, byte, 8);
  for (let index = 0; index < Math.min(4, bitCapacity - bits.length); index += 1) {
    bits.push(0);
  }
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCodewords: number[] = [];
  for (let offset = 0; offset < bits.length; offset += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      byte = (byte << 1) | bits[offset + bit];
    }
    dataCodewords.push(byte);
  }
  const padding = [0xec, 0x11];
  while (dataCodewords.length < dataCapacity) {
    dataCodewords.push(padding[(dataCodewords.length - Math.ceil(bits.length / 8)) % 2]);
  }

  const dataBlocks: number[][] = [];
  const correctionBlocks: number[][] = [];
  let dataOffset = 0;
  for (const block of blocks) {
    const blockData = dataCodewords.slice(
      dataOffset,
      dataOffset + block.dataCodewords,
    );
    dataOffset += block.dataCodewords;
    dataBlocks.push(blockData);
    correctionBlocks.push(
      errorCorrectionCodewords(
        blockData,
        block.totalCodewords - block.dataCodewords,
      ),
    );
  }

  const codewords: number[] = [];
  const longestDataBlock = Math.max(...dataBlocks.map((block) => block.length));
  for (let index = 0; index < longestDataBlock; index += 1) {
    for (const block of dataBlocks) {
      if (index < block.length) codewords.push(block[index]);
    }
  }
  const longestCorrectionBlock = Math.max(
    ...correctionBlocks.map((block) => block.length),
  );
  for (let index = 0; index < longestCorrectionBlock; index += 1) {
    for (const block of correctionBlocks) {
      if (index < block.length) codewords.push(block[index]);
    }
  }
  return { version, codewords };
}

function bchRemainder(value: number, polynomial: number) {
  const bitLength = (input: number) =>
    input === 0 ? 0 : Math.floor(Math.log2(input)) + 1;
  let remainder = value;
  const polynomialLength = bitLength(polynomial);
  while (bitLength(remainder) >= polynomialLength) {
    remainder ^=
      polynomial << (bitLength(remainder) - polynomialLength);
  }
  return remainder;
}

function formatBits(mask: number) {
  // Level M is represented by 00 in the two error-correction format bits.
  const data = mask;
  return ((data << 10) | bchRemainder(data << 10, 0x537)) ^ 0x5412;
}

function versionBits(version: number) {
  return (version << 12) | bchRemainder(version << 12, 0x1f25);
}

function maskAt(mask: number, row: number, column: number) {
  switch (mask) {
    case 0:
      return (row + column) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return column % 3 === 0;
    case 3:
      return (row + column) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    case 5:
      return ((row * column) % 2) + ((row * column) % 3) === 0;
    case 6:
      return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
    default:
      return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0;
  }
}

function makeBaseMatrix(version: number) {
  const size = 17 + version * 4;
  const matrix = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );
  const reserved = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );
  const set = (row: number, column: number, dark: boolean) => {
    if (row < 0 || column < 0 || row >= size || column >= size) return;
    matrix[row][column] = dark;
    reserved[row][column] = true;
  };

  const finder = (top: number, left: number) => {
    for (let row = -1; row <= 7; row += 1) {
      for (let column = -1; column <= 7; column += 1) {
        const inside =
          row >= 0 && row <= 6 && column >= 0 && column <= 6;
        const dark =
          inside &&
          (row === 0 ||
            row === 6 ||
            column === 0 ||
            column === 6 ||
            (row >= 2 && row <= 4 && column >= 2 && column <= 4));
        set(top + row, left + column, dark);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  for (const centerRow of ALIGNMENT_POSITIONS[version - 1]) {
    for (const centerColumn of ALIGNMENT_POSITIONS[version - 1]) {
      if (reserved[centerRow][centerColumn]) continue;
      for (let row = -2; row <= 2; row += 1) {
        for (let column = -2; column <= 2; column += 1) {
          set(
            centerRow + row,
            centerColumn + column,
            Math.max(Math.abs(row), Math.abs(column)) !== 1,
          );
        }
      }
    }
  }

  for (let index = 8; index < size - 8; index += 1) {
    if (!reserved[6][index]) set(6, index, index % 2 === 0);
    if (!reserved[index][6]) set(index, 6, index % 2 === 0);
  }

  const reserveFormatCell = (row: number, column: number) => set(row, column, false);
  for (let index = 0; index < 15; index += 1) {
    const verticalRow =
      index < 6 ? index : index < 8 ? index + 1 : size - 15 + index;
    reserveFormatCell(verticalRow, 8);

    const horizontalColumn =
      index < 8 ? size - index - 1 : index === 8 ? 7 : 15 - index - 1;
    reserveFormatCell(8, horizontalColumn);
  }
  reserveFormatCell(size - 8, 8);

  if (version >= 7) {
    for (let index = 0; index < 18; index += 1) {
      reserveFormatCell(Math.floor(index / 3), (index % 3) + size - 11);
      reserveFormatCell((index % 3) + size - 11, Math.floor(index / 3));
    }
  }

  return { matrix, reserved };
}

function writeMetadata(matrix: QrMatrix, version: number, mask: number) {
  const size = matrix.length;
  const format = formatBits(mask);
  for (let index = 0; index < 15; index += 1) {
    const dark = ((format >>> index) & 1) === 1;
    const verticalRow =
      index < 6 ? index : index < 8 ? index + 1 : size - 15 + index;
    matrix[verticalRow][8] = dark;

    const horizontalColumn =
      index < 8 ? size - index - 1 : index === 8 ? 7 : 15 - index - 1;
    matrix[8][horizontalColumn] = dark;
  }
  matrix[size - 8][8] = true;

  if (version >= 7) {
    const encodedVersion = versionBits(version);
    for (let index = 0; index < 18; index += 1) {
      const dark = ((encodedVersion >>> index) & 1) === 1;
      matrix[Math.floor(index / 3)][(index % 3) + size - 11] = dark;
      matrix[(index % 3) + size - 11][Math.floor(index / 3)] = dark;
    }
  }
}

function placeCodewords(
  matrix: QrMatrix,
  reserved: boolean[][],
  codewords: number[],
  mask: number,
) {
  const size = matrix.length;
  const bits = codewords.flatMap((codeword) =>
    Array.from({ length: 8 }, (_, index) => (codeword >>> (7 - index)) & 1),
  );
  let bitIndex = 0;
  let row = size - 1;
  let direction = -1;

  for (let rightColumn = size - 1; rightColumn > 0; rightColumn -= 2) {
    if (rightColumn === 6) rightColumn -= 1;
    while (true) {
      for (let offset = 0; offset < 2; offset += 1) {
        const column = rightColumn - offset;
        if (reserved[row][column]) continue;
        const sourceBit = bitIndex < bits.length && bits[bitIndex] === 1;
        matrix[row][column] = sourceBit !== maskAt(mask, row, column);
        bitIndex += 1;
      }
      row += direction;
      if (row >= 0 && row < size) continue;
      row -= direction;
      direction *= -1;
      break;
    }
  }
}

function penaltyScore(matrix: QrMatrix) {
  const size = matrix.length;
  let score = 0;

  const scoreRuns = (line: boolean[]) => {
    let result = 0;
    let runLength = 1;
    for (let index = 1; index <= line.length; index += 1) {
      if (index < line.length && line[index] === line[index - 1]) {
        runLength += 1;
      } else {
        if (runLength >= 5) result += 3 + runLength - 5;
        runLength = 1;
      }
    }
    return result;
  };

  for (let row = 0; row < size; row += 1) {
    score += scoreRuns(matrix[row]);
    score += scoreRuns(matrix.map((line) => line[row]));
  }

  for (let row = 0; row < size - 1; row += 1) {
    for (let column = 0; column < size - 1; column += 1) {
      const value = matrix[row][column];
      if (
        matrix[row][column + 1] === value &&
        matrix[row + 1][column] === value &&
        matrix[row + 1][column + 1] === value
      ) {
        score += 3;
      }
    }
  }

  const finderLikePatterns = [
    "00001011101",
    "10111010000",
  ];
  for (let row = 0; row < size; row += 1) {
    const horizontal = matrix[row].map(Number).join("");
    const vertical = matrix.map((line) => Number(line[row])).join("");
    for (const pattern of finderLikePatterns) {
      score += horizontal.split(pattern).length > 1 ? 40 : 0;
      score += vertical.split(pattern).length > 1 ? 40 : 0;
    }
  }

  const darkModules = matrix.reduce(
    (total, line) => total + line.filter(Boolean).length,
    0,
  );
  score +=
    Math.floor(Math.abs((darkModules * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

export function makeQrMatrix(value: string): QrMatrix {
  const { version, codewords } = makeCodewords(value);
  const base = makeBaseMatrix(version);
  let bestMatrix: QrMatrix | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let mask = 0; mask < 8; mask += 1) {
    const matrix = base.matrix.map((row) => [...row]);
    placeCodewords(matrix, base.reserved, codewords, mask);
    writeMetadata(matrix, version, mask);
    const score = penaltyScore(matrix);
    if (score < bestScore) {
      bestScore = score;
      bestMatrix = matrix;
    }
  }
  if (!bestMatrix) throw new Error("Unable to create QR code.");
  return bestMatrix;
}

function qrPath(matrix: QrMatrix, quietZone: number) {
  const commands: string[] = [];
  for (let row = 0; row < matrix.length; row += 1) {
    let column = 0;
    while (column < matrix.length) {
      if (!matrix[row][column]) {
        column += 1;
        continue;
      }
      const start = column;
      while (column < matrix.length && matrix[row][column]) column += 1;
      commands.push(
        `M${start + quietZone} ${row + quietZone}h${column - start}v1H${start + quietZone}z`,
      );
    }
  }
  return commands.join("");
}

export function QrCode({
  value,
  className,
  ariaLabel,
  foregroundColor = "#000000",
  backgroundColor = "#ffffff",
  quietZoneModules = 0,
}: {
  value: string;
  className?: string;
  ariaLabel?: string;
  foregroundColor?: string;
  backgroundColor?: string;
  quietZoneModules?: number;
}) {
  const quietZone = Math.min(4, Math.max(0, Math.round(quietZoneModules)));
  const matrix = useMemo(() => makeQrMatrix(value), [value]);
  const size = matrix.length + quietZone * 2;
  const path = useMemo(() => qrPath(matrix, quietZone), [matrix, quietZone]);
  return (
    <svg
      className={className}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={ariaLabel ?? `QR code for ${value}`}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill={backgroundColor} />
      <path d={path} fill={foregroundColor} />
    </svg>
  );
}

// Symbol widths for Code 128. Values 0–105 contain six alternating bar/space
// widths (11 modules); stop value 106 contains seven widths (13 modules).
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222",
  "122213", "122312", "132212", "221213", "221312", "231212",
  "112232", "122132", "122231", "113222", "123122", "123221",
  "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321",
  "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131",
  "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124",
  "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111",
  "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141",
  "411131", "211412", "211214", "211232", "2331112",
] as const;

export function canEncodeCode128B(value: string) {
  return (
    value.length > 0 &&
    Array.from(value).every((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code <= 126;
    })
  );
}

function code128Bars(value: string) {
  if (!canEncodeCode128B(value)) {
    throw new Error("Code 128-B supports printable ASCII values only.");
  }
  const symbols = Array.from(value, (character) => character.charCodeAt(0) - 32);
  let checksum = 104;
  symbols.forEach((symbol, index) => {
    checksum += symbol * (index + 1);
  });
  const encoded = [104, ...symbols, checksum % 103, 106];
  const quietZone = 10;
  const modules = encoded.reduce(
    (total, symbol) =>
      total +
      Array.from(CODE128_PATTERNS[symbol], Number).reduce(
        (width, valueWidth) => width + valueWidth,
        0,
      ),
    quietZone * 2,
  );
  let cursor = quietZone;
  const bars: Array<{ x: number; width: number }> = [];
  for (const symbol of encoded) {
    const pattern = CODE128_PATTERNS[symbol];
    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number(pattern[index]);
      if (index % 2 === 0) bars.push({ x: cursor, width });
      cursor += width;
    }
  }
  return { bars, modules };
}

export function Code128Barcode({
  value,
  className,
  ariaLabel,
}: {
  value: string;
  className?: string;
  ariaLabel?: string;
}) {
  const { bars, modules } = useMemo(() => code128Bars(value), [value]);
  return (
    <svg
      className={className}
      viewBox={`0 0 ${modules} 48`}
      role="img"
      aria-label={ariaLabel ?? `Code 128 barcode for ${value}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
    >
      <rect width={modules} height="48" fill="#fff" />
      {bars.map((bar, index) => (
        <rect key={`${bar.x}-${index}`} x={bar.x} width={bar.width} height="48" fill="#000" />
      ))}
    </svg>
  );
}
