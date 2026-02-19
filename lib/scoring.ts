// lib/scoring.ts

// ==============================
// Top10 helpers (BESTAAND)
// ==============================

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

// ==============================
// Bonus scoring (NIEUW)
// ==============================

// Weekend bonus: 5 punten per correct antwoord
export const WEEKEND_BONUS_POINTS_PER_QUESTION = 5;

// Season bonus: 50 punten per correct (champion questions)
export const SEASON_BONUS_CHAMPION_POINTS = 50;

// Driver win-pick: variabele punten (outsiders meer)
export const DEFAULT_SEASON_WIN_PICK_POINTS_BY_DRIVER: Record<string, number> = {
  // Favorieten (laag)
  VER: 5,
  NOR: 8,
  LEC: 10,
  HAM: 10,
  RUS: 12,
  PIA: 12,

  // Sterk middenveld
  SAI: 16,
  ALO: 18,
  PER: 20,
  GAS: 22,
  OCO: 22,

  // Outsiders
  STR: 26,
  ALB: 28,
  TSU: 30,
  HUL: 34,
  BOT: 34,

  // Long shots
  ZHO: 40,
  MAG: 40,
  SAR: 45,
};

function normalizeCode(v: any): string {
  return typeof v === "string" ? v.trim().toUpperCase().replace(/\s+/g, "") : "";
}

function toBool(v: any): boolean | null {
  if (typeof v === "boolean") return v;

  // support shapes like { value: true }
  if (v && typeof v === "object" && typeof v.value === "boolean") return v.value;

  // support shapes like { answer: true }
  if (v && typeof v === "object" && typeof v.answer === "boolean") return v.answer;

  return null;
}

/**
 * Accepts multiple shapes:
 * - { "qid": true, "qid2": false }
 * - { answers: { "qid": true } }
 */
function extractAnswerMap(answerJson: any): Record<string, any> | null {
  if (!answerJson) return null;
  if (typeof answerJson === "object" && !Array.isArray(answerJson)) {
    if (answerJson.answers && typeof answerJson.answers === "object") {
      return answerJson.answers as Record<string, any>;
    }
    return answerJson as Record<string, any>;
  }
  return null;
}

/**
 * Weekend bonus score:
 * - We itereren over correctAnswers keys (bron van waarheid)
 * - 5 punten per exact match (true/false)
 */
export function pointsForWeekendBonus(
  userAnswerJson: any,
  correctAnswerJson: any
): number {
  const userMap = extractAnswerMap(userAnswerJson);
  const correctMap = extractAnswerMap(correctAnswerJson);
  if (!userMap || !correctMap) return 0;

  let points = 0;
  for (const qid of Object.keys(correctMap)) {
    const u = toBool(userMap[qid]);
    const c = toBool(correctMap[qid]);
    if (u !== null && c !== null && u === c) points += WEEKEND_BONUS_POINTS_PER_QUESTION;
  }
  return points;
}

/**
 * Season champion (driver/team):
 * 50 punten als exact gelijk (case-insensitive)
 */
export function pointsForSeasonChampion(
  userPick: string | null,
  correctValue: string | null
): number {
  const a = normalizeCode(userPick);
  const b = normalizeCode(correctValue);
  if (!a || !b) return 0;
  return a === b ? SEASON_BONUS_CHAMPION_POINTS : 0;
}

/**
 * Season: "driver wins at least 1 GP"
 * - raceWinners: array driver codes die minimaal 1 race gewonnen hebben
 * - mapping: driver->punten (outsiders hoger)
 */
export function pointsForSeasonWinPick(
  userPick: string | null,
  raceWinners: string[] | null,
  mapping: Record<string, number> | null
): number {
  const pick = normalizeCode(userPick);
  if (!pick) return 0;
  if (!raceWinners || !Array.isArray(raceWinners)) return 0;

  const winners = raceWinners.map((x) => normalizeCode(x)).filter(Boolean);
  if (!winners.includes(pick)) return 0;

  const m = mapping ?? DEFAULT_SEASON_WIN_PICK_POINTS_BY_DRIVER;
  return typeof m[pick] === "number" ? m[pick] : 0;
}

/**
 * Optioneel convenience: total bonus in één call
 * (handig voor leaderboard route)
 */
export function totalBonusPoints(args: {
  weekendUserAnswerJson?: any;
  weekendCorrectAnswerJson?: any;
  seasonDriverChampionPick?: string | null;
  seasonDriverChampionCorrect?: string | null;
  seasonTeamChampionPick?: string | null;
  seasonTeamChampionCorrect?: string | null;
  seasonWinPick?: string | null;
  seasonRaceWinners?: string[] | null;
  seasonWinPickMapping?: Record<string, number> | null;
} = {}): number {
  let total = 0;

  total += pointsForWeekendBonus(args.weekendUserAnswerJson, args.weekendCorrectAnswerJson);

  total += pointsForSeasonChampion(
    args.seasonDriverChampionPick ?? null,
    args.seasonDriverChampionCorrect ?? null
  );

  total += pointsForSeasonChampion(
    args.seasonTeamChampionPick ?? null,
    args.seasonTeamChampionCorrect ?? null
  );

  total += pointsForSeasonWinPick(
    args.seasonWinPick ?? null,
    args.seasonRaceWinners ?? null,
    args.seasonWinPickMapping ?? null
  );

  return total;
}
