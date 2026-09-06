import type { ScanCodeType } from "@/lib/scan-code-types";

type CodePreview = { viewBox: string; path: string };

function matrix(rows: readonly string[]): CodePreview {
  return {
    viewBox: `-1 -1 ${rows[0].length + 2} ${rows.length + 2}`,
    path: rows.flatMap((row, y) =>
      [...row].flatMap((cell, x) => cell === "1" ? [`M${x} ${y}h1v1h-1z`] : []),
    ).join(""),
  };
}

function bars(widths: string, guards: readonly number[] = []): CodePreview {
  let x = 0;
  const path = [...widths].map((width, index) => {
    const size = Number(width);
    const bar = index % 2 === 0
      ? `M${x} 2h${size}v${guards.includes(index) ? 27 : 23}h-${size}z`
      : "";
    x += size;
    return bar;
  }).join("");
  return { viewBox: `-2 0 ${x + 4} 32`, path };
}

// Small illustrative silhouettes, not scannable payloads. Preserve each
// symbology's finder patterns, proportions, and characteristic bar structure.
const previews = {
  qr_code: matrix([
    "111111101010101111111",
    "100000101101001000001",
    "101110100011101011101",
    "101110101010101011101",
    "101110100110101011101",
    "100000100101001000001",
    "111111101010101111111",
    "000000001101000000000",
    "110100110010101110110",
    "001011001101010010001",
    "111001110010111101100",
    "010110001110000110011",
    "101101111001101001110",
    "000000001011010110001",
    "111111101100111011010",
    "100000100011001100101",
    "101110101101101011110",
    "101110100110010100001",
    "101110101011111001110",
    "100000101100001110010",
    "111111101011101011101",
  ]),
  data_matrix: matrix([
    "10101010101010",
    "11011000110101",
    "10100111001110",
    "11101001010001",
    "10011110101110",
    "11000101110001",
    "10111010011010",
    "11100111000111",
    "10011001101000",
    "11010110011101",
    "10101101100010",
    "11110010011011",
    "10001111010100",
    "11111111111111",
  ]),
  aztec: matrix([
    "101101001011010",
    "011011110100101",
    "110100001110010",
    "101111111111100",
    "010100000001011",
    "110101111101010",
    "100101000101001",
    "011101010101110",
    "101101000101011",
    "010101111101100",
    "101100000001010",
    "110111111111101",
    "001011100010011",
    "111000101101100",
    "100110110010111",
  ]),
  pdf417: {
    viewBox: "-2 -1 90 30",
    path: [
      "81111113" + "41111333" + "31221233" + "22133123" + "711311121",
      "81111113" + "31221233" + "22133123" + "41111333" + "711311121",
      "81111113" + "22133123" + "41111333" + "31221233" + "711311121",
      "81111113" + "31221233" + "41111333" + "22133123" + "711311121",
      "81111113" + "41111333" + "22133123" + "31221233" + "711311121",
      "81111113" + "22133123" + "31221233" + "41111333" + "711311121",
    ].map((row, y) => {
      let x = 0;
      return [...row].map((width, index) => {
        const size = Number(width);
        const bar = index % 2 === 0 ? `M${x} ${y * 4.5}h${size}v4h-${size}z` : "";
        x += size;
        return bar;
      }).join("");
    }).join(""),
  },
  code_128: bars("2112141231221311231213222331112"),
  code_93: bars("111141211113211212121131111141"),
  code_39: bars("1211212111112212111121122111211211211"),
  codabar: bars("11221211111112211211211112112211"),
  ean_13: bars("111321122211114111112311411111", [0, 2, 14, 16, 26, 28]),
  ean_8: bars("11132111114111112311411111", [0, 2, 12, 14, 22, 24]),
  upc_a: bars("1113211212211141111123112321111", [0, 2, 14, 16, 26, 28]),
  upc_e: bars("111321121221411111111", [0, 2, 14, 16, 18]),
  itf: bars("111131131113313111133131111"),
} satisfies Record<ScanCodeType, CodePreview>;

export function ScanCodeTypeIcon({
  codeType,
  className,
}: {
  codeType: ScanCodeType;
  className?: string;
}) {
  const preview = previews[codeType];

  return (
    <svg
      viewBox={preview.viewBox}
      preserveAspectRatio="none"
      className={className}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={preview.path} />
    </svg>
  );
}
