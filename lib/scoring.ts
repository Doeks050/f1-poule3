// =====================================================
// TOP 10 POSITION SCORING
// =====================================================

export function countCorrectPositions(
  predicted: string[] | null,
  result: string[] | null
): number {
  if (!predicted || !result) return 0;

  let correct = 0;

  for (let i = 0; i < 10; i++) {
    if (predicted[i] && result[i] && predicted[i] === result[i]) {
      correct++;
    }
  }

  return correct;
}

export function pointsForTop10(
  predicted: string[] | null,
  result: string[] | null
): number {
  const correct = countCorrectPositions(predicted, result);
  return correct * 5; // 5 punten per juiste positie
}

// =====================================================
// HELPER: NORMALIZE ANSWERS
// Ondersteunt:
// - { value: true }
// - true
// - rows van Supabase
// =====================================================

type AnswerJson = { value?: any } | boolean | null;

function extractBoolean(raw: AnswerJson): boolean | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === "boolean") return raw;

  if (typeof raw === "object" && "value" in raw) {
    const v = (raw as any).value;
    return typeof v === "boolean" ? v : null;
  }

  return null;
}

export function normalizeAnswerRows(
  rows: Array<{ question_id: string; answer_json: AnswerJson }> | null
): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  if (!rows) return map;

  for (const row of rows) {
    const value = extractBoolean(row.answer_json);
    if (typeof value === "boolean") {
      map[row.question_id] = value;
    }
  }

  return map;
}

export function normalizeAnswerMap(
  obj: Record<string, any> | null
): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  if (!obj) return map;

  for (const [qid, raw] of Object.entries(obj)) {
    const value = extractBoolean(raw);
    if (typeof value === "boolean") {
      map[qid] = value;
    }
  }

  return map;
}

// =====================================================
// WEEKEND BONUS SCORING (5 punten per correct)
// =====================================================

export function pointsForWeekendBonus(
  userAnswersInput:
    | Record<string, any>
    | Array<{ question_id: string; answer_json: any }>
    | null,
  correctAnswersInput:
    | Record<string, any>
    | Array<{ question_id: string; answer_json: any }>
    | null
): number {
  const userAnswers = Array.isArray(userAnswersInput)
    ? normalizeAnswerRows(userAnswersInput)
    : normalizeAnswerMap(userAnswersInput);

  const correctAnswers = Array.isArray(correctAnswersInput)
    ? normalizeAnswerRows(correctAnswersInput)
    : normalizeAnswerMap(correctAnswersInput);

  if (!userAnswers || !correctAnswers) return 0;

  let points = 0;

  for (const qid of Object.keys(correctAnswers)) {
    if (
      typeof userAnswers[qid] === "boolean" &&
      typeof correctAnswers[qid] === "boolean" &&
      userAnswers[qid] === correctAnswers[qid]
    ) {
      points += 5;
    }
  }

  return points;
}

// =====================================================
// SEASON BONUS SCORING (50 punten per correct)
// =====================================================

export function pointsForSeasonBonus(
  userAnswersInput:
    | Record<string, any>
    | Array<{ question_id: string; answer_json: any }>
    | null,
  correctAnswersInput:
    | Record<string, any>
    | Array<{ question_id: string; answer_json: any }>
    | null
): number {
  const userAnswers = Array.isArray(userAnswersInput)
    ? normalizeAnswerRows(userAnswersInput)
    : normalizeAnswerMap(userAnswersInput);

  const correctAnswers = Array.isArray(correctAnswersInput)
    ? normalizeAnswerRows(correctAnswersInput)
    : normalizeAnswerMap(correctAnswersInput);

  if (!userAnswers || !correctAnswers) return 0;

  let points = 0;

  for (const qid of Object.keys(correctAnswers)) {
    if (
      typeof userAnswers[qid] === "boolean" &&
      typeof correctAnswers[qid] === "boolean" &&
      userAnswers[qid] === correctAnswers[qid]
    ) {
      points += 50;
    }
  }

  return points;
}

// =====================================================
// TOTAL EVENT SCORE
// =====================================================

export function calculateTotalEventPoints({
  predictedTop10,
  resultTop10,
  weekendUserAnswers,
  weekendOfficialAnswers,
}: {
  predictedTop10: string[] | null;
  resultTop10: string[] | null;
  weekendUserAnswers:
    | Record<string, any>
    | Array<{ question_id: string; answer_json: any }>
    | null;
  weekendOfficialAnswers:
    | Record<string, any>
    | Array<{ question_id: string; answer_json: any }>
    | null;
}) {
  const top10Points = pointsForTop10(predictedTop10, resultTop10);
  const weekendBonusPoints = pointsForWeekendBonus(
    weekendUserAnswers,
    weekendOfficialAnswers
  );

  return top10Points + weekendBonusPoints;
}

// =====================================================
// TOTAL SEASON SCORE (optioneel)
// =====================================================

export function calculateTotalSeasonBonusPoints({
  seasonUserAnswers,
  seasonOfficialAnswers,
}: {
  seasonUserAnswers:
    | Record<string, any>
    | Array<{ question_id: string; answer_json: any }>
    | null;
  seasonOfficialAnswers:
    | Record<string, any>
    | Array<{ question_id: string; answer_json: any }>
    | null;
}) {
  return pointsForSeasonBonus(seasonUserAnswers, seasonOfficialAnswers);
}
