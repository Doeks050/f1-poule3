// lib/scoring.ts

// ------------------------------
// Helpers: normalize / compare
// ------------------------------
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
  if (k === "qual1" || k === "q") return 3;

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
 *
 * - FP: max 10
 * - Sprint/quali: max 30
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

// ------------------------------
// Weekend bonusvragen (5 punten per correct)
// Verwacht booleans (true/false) of null/undefined.
// ------------------------------
function toBool(v: any): boolean | null {
  if (typeof v === "boolean") return v;
  if (v && typeof v === "object" && typeof v.value === "boolean") return v.value;
  return null;
}

export function pointsForWeekendBonus(
  userAnswers: Record<string, any> | null,
  correctAnswers: Record<string, any> | null
): number {
  if (!userAnswers || !correctAnswers) return 0;

  let points = 0;

  for (const qid of Object.keys(correctAnswers)) {
    const u = toBool(userAnswers[qid]);
    const c = toBool(correctAnswers[qid]);

    // Alleen scoren als beiden echt boolean zijn
    if (u !== null && c !== null && u === c) points += 5;
  }

  return points;
}

// ------------------------------
// Season champion vragen (50 punten)
// Handig voor:
// - driver champion
// - team champion
// ------------------------------
export function pointsForSeasonChampion(
  userPick: string | null,
  correctValue: string | null
): number {
  if (!userPick || !correctValue) return 0;

  return userPick.trim().toUpperCase() === correctValue.trim().toUpperCase() ? 50 : 0;
}

// ------------------------------
// Season: "Welke coureur wint minstens 1 GP?"
// Variabele punten op basis van risico.
//
// raceWinners = lijst met coureurs die minimaal 1 race hebben gewonnen (strings)
// winPickPoints = mapping { "VERSTAPPEN": 5, "NORRIS": 12, ... }
//
// Als coureur heeft gewonnen -> return winPickPoints[pick] (of 0 als niet in mapping)
// ------------------------------
export function pointsForSeasonWinPick(
  userPick: string | null,
  raceWinners: string[] | null,
  winPickPoints: Record<string, number> | null
): number {
  if (!userPick || !raceWinners || !winPickPoints) return 0;

  const pick = userPick.trim().toUpperCase();

  const winnersUpper = raceWinners.map((x) => (x ?? "").trim().toUpperCase());
  const hasWon = winnersUpper.includes(pick);

  if (!hasWon) return 0;

  return winPickPoints[pick] ?? 0;
}

// ------------------------------
// (OPTIONEEL) Default mapping voor winPickPoints
// Je kunt dit vervangen door data uit Supabase.
// Keys MOETEN uppercase zijn om match te krijgen.
// ------------------------------
export const DEFAULT_WIN_PICK_POINTS: Record<string, number> = {
  // Topfavorieten (laag)
  VERSTAPPEN: 5,
  HAMILTON: 8,
  LECLERC: 10,
  NORRIS: 12,
  RUSSELL: 14,
  PIASTRI: 16,

  // Midden (meer)
  SAINZ: 20,
  ALONSO: 22,
  GASLY: 28,
  OCON: 30,

  // Underdogs (hoog)
  TSUNODA: 35,
  ALBON: 40,
  HULKENBERG: 50,
};
