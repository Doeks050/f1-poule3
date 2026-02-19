// lib/scoring.ts
// Centrale scoring helpers (sessions + bonusvragen)

export type Top10 = string[];

// ------------------------------
// Helpers
// ------------------------------

export function normalizeTop10(input: any): Top10 | null {
  if (!input) return null;
  if (!Array.isArray(input)) return null;

  const arr = input
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);

  if (arr.length === 0) return null;
  return arr.slice(0, 10);
}

function safeString(x: any): string {
  return typeof x === "string" ? x : "";
}

function toBoolAnswer(x: any): boolean | null {
  // Ondersteun:
  // - jsonb boolean: true/false
  // - json object: { value: true/false }
  // - string "true"/"false" (voor de zekerheid)
  if (typeof x === "boolean") return x;

  if (x && typeof x === "object" && "value" in x) {
    const v = (x as any).value;
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      if (v.toLowerCase() === "true") return true;
      if (v.toLowerCase() === "false") return false;
    }
  }

  if (typeof x === "string") {
    if (x.toLowerCase() === "true") return true;
    if (x.toLowerCase() === "false") return false;
  }

  return null;
}

export function mapAnswersByQuestionId(
  rows: Array<{ question_id: string; answer_json: any }> | null
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const r of rows ?? []) {
    if (!r?.question_id) continue;
    out[r.question_id] = r.answer_json;
  }
  return out;
}

// ------------------------------
// Session scoring
// ------------------------------

export function countCorrectPositions(predTop10: Top10, resultTop10: Top10): number {
  const n = Math.min(predTop10.length, resultTop10.length, 10);
  let correct = 0;
  for (let i = 0; i < n; i++) {
    if (predTop10[i] === resultTop10[i]) correct++;
  }
  return correct;
}

export function pointsForSession(
  sessionKey: string,
  predTop10: Top10 | null,
  resultTop10: Top10 | null
): number {
  if (!predTop10 || !resultTop10) return 0;

  const pred = predTop10.slice(0, 10);
  const res = resultTop10.slice(0, 10);

  // Basic model: per correct positie punten (pas aan naar jouw regels)
  // Voor nu: 5 punten per correcte positie
  const correct = countCorrectPositions(pred, res);
  return correct * 5;
}

// ------------------------------
// Weekend bonus (3 vragen per weekend)
// ------------------------------

// Verwacht maps: { [questionId]: answer_json }
// answer_json mag boolean zijn of {value:boolean}
export function pointsForWeekendBonusAnswers(
  userAnswers: Record<string, any> | null,
  correctAnswers: Record<string, any> | null
): number {
  if (!userAnswers || !correctAnswers) return 0;

  let points = 0;

  for (const qid of Object.keys(correctAnswers)) {
    const correct = toBoolAnswer(correctAnswers[qid]);
    const user = toBoolAnswer(userAnswers[qid]);

    // Alleen scoren als user daadwerkelijk true/false heeft ingevuld
    if (typeof user === "boolean" && typeof correct === "boolean") {
      if (user === correct) points += 5; // 5 punten per correcte bonusvraag
    }
  }

  return points;
}

// Backwards compatible alias (als je ergens nog de oude naam gebruikt)
export function pointsForWeekendBonus(
  userAnswers: Record<string, any> | null,
  correctAnswers: Record<string, any> | null
): number {
  return pointsForWeekendBonusAnswers(userAnswers, correctAnswers);
}
