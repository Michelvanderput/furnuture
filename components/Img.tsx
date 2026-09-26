"use client";

import { useState } from "react";
import { proxied } from "@/lib/images";

/**
 * Funda serves the same photo in any width (?options=width=…): ask for what is
 * shown instead of the full 1440 px, which matters a lot on an iPad with 30 photos.
 */
export function sized(url: string, width: number): string {
  if (!/^https?:\/\/cloud\.funda\.nl\//.test(url)) return url;
  const u = url.replace(/([?&])options=width=\d+/, `$1options=width=${width}`);
  return u === url && !url.includes("options=") ? `${url}${url.includes("?") ? "&" : "?"}options=width=${width}` : u;
}

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string; width?: number };

/**
 * Loads images straight from the shop or Funda (fast, no server hop) and only
 * falls back to our image proxy when the direct request is refused.
 */
export function Img({ src, width, ...rest }: Props) {
  const direct = width ? sized(src, width) : src;
  const [viaProxy, setViaProxy] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img
      {...rest}
      src={viaProxy ? proxied(direct) : direct}
      referrerPolicy="no-referrer"
      decoding="async"
      onError={(e) => {
        if (!viaProxy && /^https?:/.test(direct)) setViaProxy(true);
        rest.onError?.(e);
      }}
    />
  );
}
