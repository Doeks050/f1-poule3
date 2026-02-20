// lib/scoring.ts
// Centrale scoring helpers voor:
// - Top10 per sessie (FP/Quali/Sprint/Race)
// - Bonusvragen (weekend/season)

// -----------------------------
// Top10 helpers
// -----------------------------

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

// -----------------------------
// Bonus helpers
// -----------------------------

// ✅ weekend bonus = 5 punten per goed antwoord
export const WEEKEND_BONUS_POINTS_PER_CORRECT = 5;

// (season bonus = later; jij wil 50 per goed antwoord, maar leaderboard telt nu alleen weekend.)
export const SEASON_BONUS_POINTS_PER_CORRECT = 50;

export type BoolMap = Record<string, boolean>;

/**
 * Normaliseert antwoord-json naar: { [questionId]: boolean }
 * We accepteren:
 * - boolean true/false
 * - strings: "yes"/"no", "true"/"false", "ja"/"nee", "1"/"0"
 */
export function mapAnswersByQuestionId(input: any): BoolMap {
  const out: BoolMap = {};
  if (!input || typeof input !== "object") return out;

  for (const [k, v] of Object.entries(input)) {
    const key = String(k);

    if (typeof v === "boolean") {
      out[key] = v;
      continue;
    }

    if (typeof v === "number") {
      out[key] = v !== 0;
      continue;
    }

    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (s === "true" || s === "yes" || s === "ja" || s === "y" || s === "1") {
        out[key] = true;
        continue;
      }
      if (s === "false" || s === "no" || s === "nee" || s === "n" || s === "0") {
        out[key] = false;
        continue;
      }
      // Onbekend -> skip
      continue;
    }

    // onbekend type -> skip
  }

  return out;
}

/**
 * Weekend bonus score:
 * - questionIds = de 3 question_id’s die in de set zitten (die voor iedereen gelijk zijn)
 * - answerJson = gebruiker answers (answer_json)
 * - correctJson = admin answers (correct_json)
 */
export function pointsForWeekendBonusAnswers(args: {
  questionIds: string[];
  answerJson: any;
  correctJson: any;
}): number {
  const questionIds = Array.isArray(args.questionIds) ? args.questionIds : [];
  if (questionIds.length === 0) return 0;

  const got = mapAnswersByQuestionId(args.answerJson);
  const expected = mapAnswersByQuestionId(args.correctJson);

  let correct = 0;
  for (const qid of questionIds) {
    // Alleen scoren als admin correct answer gezet heeft
    if (typeof expected[qid] !== "boolean") continue;

    // Alleen scoren als user antwoord gezet heeft
    if (typeof got[qid] !== "boolean") continue;

    if (got[qid] === expected[qid]) correct++;
  }

  return correct * WEEKEND_BONUS_POINTS_PER_CORRECT;
}
