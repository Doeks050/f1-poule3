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
  if (k === "qual1" || k === "q" || k === "quali" || k === "qualifying") return 3;

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
// Bonus answers mapping helpers
// (werkt met jsonb die óf true/false is, óf { value: true/false/null })
// ------------------------------
export type AnswerRow = {
  question_id: string;
  answer_json: any;
};

function extractBoolean(answer_json: any): boolean | undefined {
  // Case A: jsonb is direct boolean
  if (typeof answer_json === "boolean") return answer_json;

  // Case B: jsonb is { value: boolean|null }
  if (answer_json && typeof answer_json === "object" && "value" in answer_json) {
    if (typeof (answer_json as any).value === "boolean") return (answer_json as any).value;
    return undefined; // null/undefined => geen officieel antwoord of geen user antwoord
  }

  // Case C: soms string "true"/"false"
  if (typeof answer_json === "string") {
    const v = answer_json.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }

  return undefined;
}

export function mapAnswersByQuestionId(
  rows: AnswerRow[] | null | undefined
): Record<string, boolean | undefined> {
  const out: Record<string, boolean | undefined> = {};
  for (const r of rows ?? []) {
    if (!r?.question_id) continue;
    out[r.question_id] = extractBoolean(r.answer_json);
  }
  return out;
}

// ------------------------------
// Weekend bonusvragen (5 punten per correct)
// Verwacht Records met booleans (true/false) of undefined (geen antwoord)
// ------------------------------
export function pointsForWeekendBonusAnswers(
  userAnswers: Record<string, boolean | undefined> | null,
  correctAnswers: Record<string, boolean | undefined> | null
): number {
  if (!userAnswers || !correctAnswers) return 0;

  let points = 0;

  // Score uitsluitend vragen waarvoor een official correct answer bestaat
  for (const qid of Object.keys(correctAnswers)) {
    const u = userAnswers[qid];
    const c = correctAnswers[qid];

    // Alleen score als beide echt boolean zijn
    if (typeof u === "boolean" && typeof c === "boolean") {
      if (u === c) points += 5;
    }
  }

  return points;
}

// Backwards-compatible alias (als je route.ts nog pointsForWeekendBonus gebruikt)
export const pointsForWeekendBonus = pointsForWeekendBonusAnswers;

// ------------------------------
// DEBUG helper (NOOP tenzij je hem aanroept)
// ------------------------------
export function pointsForWeekendBonusAnswersDebug(
  userAnswers: Record<string, boolean | undefined> | null,
  correctAnswers: Record<string, boolean | undefined> | null,
  debug?: (msg: string, data?: any) => void
): number {
  if (!userAnswers || !correctAnswers) {
    debug?.("BONUS_V1: missing maps", { hasUser: !!userAnswers, hasCorrect: !!correctAnswers });
    return 0;
  }

  const correctKeys = Object.keys(correctAnswers);
  debug?.("BONUS_V1: scoring start", {
    correctKeys: correctKeys.length,
    userKeys: Object.keys(userAnswers).length,
  });

  let points = 0;
  for (const qid of correctKeys) {
    const u = userAnswers[qid];
    const c = correctAnswers[qid];
    if (typeof u === "boolean" && typeof c === "boolean" && u === c) points += 5;
  }

  debug?.("BONUS_V1: scoring done", { points });
  return points;
}

// ------------------------------
// Season champion vragen (50 punten)
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

export const DEFAULT_WIN_PICK_POINTS: Record<string, number> = {
  VERSTAPPEN: 5,
  HAMILTON: 8,
  LECLERC: 10,
  NORRIS: 12,
  RUSSELL: 14,
  PIASTRI: 16,
  SAINZ: 20,
  ALONSO: 22,
  GASLY: 28,
  OCON: 30,
  TSUNODA: 35,
  ALBON: 40,
  HULKENBERG: 50,
};
