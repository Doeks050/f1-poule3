// lib/scoring.ts

export type SessionKind = "fp" | "quali" | "sprint" | "race";

export type Top10 = string[];

/**
 * Normaliseert een Top10 array naar:
 * - trimmed strings
 * - uppercase
 * - max 10 entries
 */
export function normalizeTop10(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((x) => (typeof x === "string" ? x.trim().toUpperCase() : ""))
    .filter(Boolean)
    .slice(0, 10);
}

/** Aantal posities exact correct (index match) */
export function countCorrectPositions(a: string[], b: string[]): number {
  const n = Math.min(a.length, b.length, 10);
  let correct = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] && b[i] && a[i] === b[i]) correct++;
  }
  return correct;
}

function pointsPerCorrectPosition(sessionKind: SessionKind): number {
  // Pas dit aan als je andere waardes wil.
  // (Dit volgt jouw bestaande opzet: Race zwaarder dan quali/fp)
  switch (sessionKind) {
    case "race":
      return 5;
    case "sprint":
      return 3;
    case "quali":
      return 2;
    case "fp":
    default:
      return 1;
  }
}

/**
 * Core scoring voor één session (Top10 voorspelling vs resultaat)
 */
export function pointsForSession(
  sessionKind: SessionKind,
  predTop10: unknown,
  resultTop10: unknown
): number {
  const pred = normalizeTop10(predTop10);
  const res = normalizeTop10(resultTop10);

  const correct = countCorrectPositions(pred, res);
  return correct * pointsPerCorrectPosition(sessionKind);
}

// ------------------------------------
// Bonus answers helpers (jsonb parsing)
// ------------------------------------

/**
 * Supabase jsonb kan in je tables voorkomen als:
 * - true/false (primitive jsonb)
 * - { value: true/false/"text"/null }
 * - null
 */
export function extractAnswerValue(answerJson: any): any {
  if (answerJson === null || answerJson === undefined) return null;

  // jsonb primitive
  if (typeof answerJson === "boolean") return answerJson;
  if (typeof answerJson === "number") return answerJson;
  if (typeof answerJson === "string") return answerJson;

  // jsonb object: { value: ... }
  if (typeof answerJson === "object" && "value" in answerJson) {
    return (answerJson as any).value ?? null;
  }

  // fallback
  return answerJson;
}

export type QArow = {
  question_id: string;
  answer_json: any;
};

/**
 * Zet rows (question_id, answer_json) om naar map:
 * { [questionId]: extractedValue }
 */
export function buildAnswerMap(rows: QArow[] | null | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  if (!rows) return out;

  for (const r of rows) {
    if (!r?.question_id) continue;
    out[r.question_id] = extractAnswerValue(r.answer_json);
  }
  return out;
}

/**
 * Filter een answerMap naar alleen de geselecteerde questionIds (bijv. die 3 uit de set).
 */
export function pickSelectedAnswerMap(
  answerMap: Record<string, any>,
  selectedQuestionIds: string[]
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const qid of selectedQuestionIds) {
    if (qid in answerMap) out[qid] = answerMap[qid];
  }
  return out;
}

// ------------------------------------
// Weekend bonus scoring (3 vragen, 5 pnt per correct)
// ------------------------------------

/**
 * Weekend bonus: 5 punten per correct antwoord.
 * Verwacht maps: { [questionId]: boolean/string/... }
 *
 * Belangrijk:
 * - We scoren alleen als user echt heeft geantwoord (true/false of string),
 *   dus null/undefined telt niet mee.
 */
export function pointsForWeekendBonus(
  userAnswers: Record<string, any> | null,
  correctAnswers: Record<string, any> | null
): number {
  if (!userAnswers || !correctAnswers) return 0;

  let points = 0;

  for (const qid of Object.keys(correctAnswers)) {
    const u = userAnswers[qid];
    const c = correctAnswers[qid];

    if (u === null || u === undefined) continue;
    if (c === null || c === undefined) continue;

    // boolean
    if (typeof u === "boolean" && typeof c === "boolean") {
      if (u === c) points += 5;
      continue;
    }

    // string compare (case-insensitive)
    if (typeof u === "string" && typeof c === "string") {
      if (u.trim().toUpperCase() === c.trim().toUpperCase()) points += 5;
      continue;
    }

    // number compare
    if (typeof u === "number" && typeof c === "number") {
      if (u === c) points += 5;
      continue;
    }

    // fallback strict equality
    if (u === c) points += 5;
  }

  return points;
}

// ------------------------------------
// Season bonus helpers (optioneel)
// ------------------------------------

/**
 * Season champion vraag (bijv. 50 punten) – simpele equality.
 */
export function pointsForSeasonChampion(
  userPick: string | null | undefined,
  correctPick: string | null | undefined,
  points = 50
): number {
  if (!userPick || !correctPick) return 0;
  if (userPick.trim().toUpperCase() === correctPick.trim().toUpperCase()) return points;
  return 0;
}

/**
 * “Race winner pick” (underdog points) – gebruikt mapping.
 */
export function pointsForWinPick(
  userPick: string | null | undefined,
  raceWinners: (string | null | undefined)[] | null | undefined,
  winPickPoints: Record<string, number> | null | undefined
): number {
  if (!userPick || !raceWinners || !winPickPoints) return 0;

  const pick = userPick.trim().toUpperCase();
  const winnersUpper = raceWinners.map((x) => (x ?? "").trim().toUpperCase());
  const hasWon = winnersUpper.includes(pick);

  if (!hasWon) return 0;
  return winPickPoints[pick] ?? 0;
}

/**
 * Default mapping (OPTIONEEL) – liever uit DB halen.
 * Zet alle keys UPPERCASE.
 */
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
  ALBON: 38,
  HULKENBERG: 40,
  STROLL: 45,
  MAGNUSSEN: 50,
  // Voeg hier de rest toe of laad dit uit Supabase (drivers table) + admin input.
};
