import { useState } from "react";
import { asset } from "../ui/asset";

/** A move/skill icon that falls back to a name chip if the art is missing. */
export function MoveIcon({
  src,
  alt,
  size = "h-10 w-10",
}: {
  src?: string;
  alt: string;
  size?: string;
}) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <span
        className={`flex ${size} items-center justify-center rounded-lg bg-raise text-center text-[9px] font-medium leading-tight text-faint`}
      >
        {alt.slice(0, 4)}
      </span>
    );
  }
  return (
    <img
      src={asset(src)}
      alt={alt}
      onError={() => setErr(true)}
      className={`${size} rounded-lg object-contain`}
    />
  );
}
