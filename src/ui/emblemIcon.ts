import type { EmblemGrade } from "../types";

// UNITE-DB emblem faces are named <pokedex><gradeLetter>.png — A=gold, B=silver,
// C=bronze. Some newer Pokémon only have A-grade art on the CDN; fetch_art.py
// mirrors the gold face to B/C locally so these paths always resolve.
const GRADE_LETTER: Record<EmblemGrade, string> = {
  gold: "A",
  silver: "B",
  bronze: "C",
  platinum: "A",
};

export function emblemIconForGrade(emblem: { id: string }, grade: EmblemGrade): string {
  const pokedex = emblem.id.split("-")[0];
  return `/assets/emblems/pokedex/${pokedex}${GRADE_LETTER[grade]}.png`;
}
