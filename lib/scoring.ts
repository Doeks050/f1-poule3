// lib/scoring.ts

export function normalizeTop10(input: any): string[] | null {
  if (!Array.isArray(input) || input.length !== 10) return null;

  const arr = input.map((x) =>
    typeof x === "string" ? x.trim().toUpperCase().replace(/\s+/g, "") : ""
  );

  // Als alles leeg is: behandelen als "geen top10"
  if (arr.every((x) => x === "")) return null;

  return arr;
}

export function pointsPerCorrectPosition(sessionKey: string): number {
  const k = (sessionKey ?? "").toLowerCase();

  // FP
  if (k === "fp1" || k === "fp2" || k === "fp3") return 1;

  // Sprint Quali
  if (k === "sprint_quali" || k === "sprintquali" || k === "sq") return 3;

  // Quali
  if (k === "quali" || k === "q") return 3;

  // Sprint Race
  if (k === "sprint_race" || k === "sprintrace" || k === "sr") return 4;

  // Race
  if (k === "race" || k === "r") return 5;

  return 0;
}

function countCorrectPositions(pred: string[], res: string[]): number {
  let correct = 0;
  for (let i = 0; i < 10; i++) {
    if ((pred[i] ?? "") !== "" && pred[i] === res[i]) correct++;
  }
  return correct;
}

/**
 * Score = (#correcte posities) * (punten per correcte positie)
 * - FP: max 10
 * - Sprint/Quali: max 30
 * - Sprint race: max 40
 * - Race: max 50
 */
export function pointsForSession(
  sessionKey: string,
  predTop10: string[] | null,
  resultTop10: string[] | null
): number {
  const ppc = pointsPerCorrectPosition(sessionKey);
  if (ppc <= 0) return 0;
  if (!predTop10 || !resultTop10) return 0;

  const correct = countCorrectPositions(predTop10, resultTop10);
  return correct * ppc;
}
