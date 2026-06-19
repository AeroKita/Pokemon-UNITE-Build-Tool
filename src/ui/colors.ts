import type { EmblemColor, EmblemGrade } from "../types";

// Emblem color → swatch hex, for color dots/badges.
export const EMBLEM_COLOR_HEX: Record<EmblemColor, string> = {
  brown: "#8b5a2b",
  green: "#22c55e",
  blue: "#3b82f6",
  purple: "#a855f7",
  white: "#e5e7eb",
  red: "#ef4444",
  yellow: "#eab308",
  black: "#374151",
  pink: "#ec4899",
  navy: "#1e3a8a",
  gray: "#9ca3af",
};

export const ALL_EMBLEM_COLORS: EmblemColor[] = [
  "brown",
  "green",
  "blue",
  "purple",
  "white",
  "red",
  "yellow",
  "black",
  "pink",
  "navy",
  "gray",
];

// Single-letter grade badge.
export const GRADE_LETTER: Record<string, string> = {
  bronze: "B",
  silver: "S",
  gold: "G",
  platinum: "P",
};

// Bronze/Silver/Gold swatch hex (platinum reuses gold).
export const EMBLEM_GRADE_HEX: Record<EmblemGrade, string> = {
  bronze: "#b45309",
  silver: "#94a3b8",
  gold: "#eab308",
  platinum: "#eab308",
};

/** Pick black or white text for legibility on a given background hex. */
export function readableTextColor(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.6 ? "#171717" : "#ffffff";
}
