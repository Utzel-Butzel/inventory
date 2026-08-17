import type { SVGProps } from "react";

export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 256 256"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect width="256" height="256" rx="56" fill="#665cff" />
      <path d="M64 80 128 48l64 32-64 32-64-32Z" fill="#fff" />
      <path
        d="m64 96 56 28v72l-56-28V96Zm128 0-56 28v72l56-28V96Z"
        fill="#fff"
        opacity=".82"
      />
      <path d="M120 124h16v72h-16z" fill="#fff" opacity=".5" />
    </svg>
  );
}
