// lib/scoring.ts

/**
 * Top10 format:
 * - exactly 10 entries
 * - driver codes uppercase (e.g. "VER")
 * - empty string allowed while editing, but for scoring we require a non-null top10 array
 */

export function normalizeTop10(input: any): string[] | null {
  if (!Array.isArray(input) || input.length !== 10) return null;

  const arr = input.map((x) =>
    typeof x === "string" ? x.trim().toUpperCase().replace(/\s+/g, "") : ""
  );

  // If all empty -> treat as "no top10"
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
 * Score = (#correct positions) * (points per correct position)
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

/* ------------------------------------------------------------
 * BONUS SCORING
 * ------------------------------------------------------------
 * We score bonus based on:
 * - answer_json: what users answered
 * - correct_json: what admin marked as correct
 *
 * Convention (recommended):
 * - Weekend bonus: 3 yes/no questions per weekend-set
 *   answer_json = { "<questionId>": true/false }
 *   correct_json = { "<questionId>": true/false }
 *
 * - Season bonus: 3 questions for the season
 *   answer_json = { "q_driverChampion": "VER", "q_teamChampion": "MCL", "q_firstTimeWinner": "ANT" }
 *   correct_json = same keys/values
 *
 * Points:
 * - Weekend: 5 per correct answer (your latest rule)
 * - Season: 50 per correct answer
 */

export const WEEKEND_BONUS_POINTS_PER_CORRECT = 5;
export const SEASON_BONUS_POINTS_PER_CORRECT = 50;

function isPlainObject(v: any) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function normStr(v: any): string {
  return String(v ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normBool(v: any): boolean | null {
  if (v === true || v === false) return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "ja") return true;
    if (s === "false" || s === "no" || s === "nee") return false;
  }
  if (typeof v === "number") {
    if (v === 1) return true;
    if (v === 0) return false;
  }
  return null;
}

/**
 * Weekend bonus scoring:
 * - only scores keys that exist in correct_json
 * - expects boolean answers
 */
export function scoreWeekendBonus(
  answerJson: any,
  correctJson: any,
  pointsPerCorrect = WEEKEND_BONUS_POINTS_PER_CORRECT
): { points: number; correctCount: number; totalCount: number } {
  if (!isPlainObject(answerJson) || !isPlainObject(correctJson)) {
    return { points: 0, correctCount: 0, totalCount: 0 };
  }

  let correctCount = 0;
  let totalCount = 0;

  for (const qid of Object.keys(correctJson)) {
    const c = normBool((correctJson as any)[qid]);
    if (c === null) continue; // skip invalid admin entry
    totalCount++;

    const a = normBool((answerJson as any)[qid]);
    if (a === null) continue; // user didn't answer (or invalid)
    if (a === c) correctCount++;
  }

  return {
    points: correctCount * pointsPerCorrect,
    correctCount,
    totalCount,
  };
}

/**
 * Season bonus scoring:
 * - compares string answers (normalized)
 * - only scores keys that exist in correct_json
 */
export function scoreSeasonBonus(
  answerJson: any,
  correctJson: any,
  pointsPerCorrect = SEASON_BONUS_POINTS_PER_CORRECT
): { points: number; correctCount: number; totalCount: number } {
  if (!isPlainObject(answerJson) || !isPlainObject(correctJson)) {
    return { points: 0, correctCount: 0, totalCount: 0 };
  }

  let correctCount = 0;
  let totalCount = 0;

  for (const key of Object.keys(correctJson)) {
    const c = normStr((correctJson as any)[key]);
    if (!c) continue;
    totalCount++;

    const a = normStr((answerJson as any)[key]);
    if (!a) continue;
    if (a === c) correctCount++;
  }

  return {
    points: correctCount * pointsPerCorrect,
    correctCount,
    totalCount,
  };
}
