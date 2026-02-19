// lib/scoring.ts
// ------------------------------------------------------------
// Scoring helpers (Top10 sessions + weekend bonus + season picks)
// ------------------------------------------------------------

/**
 * Normaliseert allerlei vormen naar een string[10] van driverIds/codes.
 * - accepteert: string[], (string|null)[], {top10:[...]}, {value:[...]}, objects met {id}/{driverId}/{code}
 */
export function normalizeTop10(input: any): string[] {
  const arr =
    Array.isArray(input)
      ? input
      : Array.isArray(input?.top10)
        ? input.top10
        : Array.isArray(input?.value)
          ? input.value
          : [];

  const cleaned = arr
    .map((x: any) => {
      if (x == null) return null;
      if (typeof x === "string") return x.trim();
      if (typeof x === "number") return String(x);
      if (typeof x === "object") {
        // veelvoorkomende vormen
        const v =
          x.driverId ??
          x.driver_id ??
          x.id ??
          x.code ??
          x.value ??
          null;
        return typeof v === "string" || typeof v === "number" ? String(v).trim() : null;
      }
      return null;
    })
    .filter((x: any) => typeof x === "string" && x.length > 0);

  return cleaned.slice(0, 10);
}

export function countCorrectPositions(predTop10: string[], resultTop10: string[]): number {
  const len = Math.min(predTop10.length, resultTop10.length, 10);
  let correct = 0;
  for (let i = 0; i < len; i++) {
    if (predTop10[i] && resultTop10[i] && predTop10[i] === resultTop10[i]) correct++;
  }
  return correct;
}

/**
 * Points per correct position, afhankelijk van sessionKey.
 * Voeg gerust extra aliases toe als je app andere keys gebruikt.
 */
function pointsPerCorrectPosition(sessionKeyRaw: string): number {
  const k = (sessionKeyRaw || "").toLowerCase();

  // practice
  if (k === "fp1" || k === "fp2" || k === "fp3" || k.includes("practice")) return 1;

  // sprint qualy / sprint shootout
  if (
    k === "sprint_quali" ||
    k === "sprint_qualifying" ||
    k === "sprint_shootout" ||
    k.includes("shootout")
  )
    return 2;

  // sprint race
  if (k === "sprint" || k === "sprint_race") return 3;

  // qualifying
  if (
    k === "qual1" ||
    k === "q" ||
    k === "quali" ||
    k === "qualifying" ||
    k.includes("qual")
  )
    return 2;

  // race
  if (k === "race" || k === "gp") return 4;

  // fallback
  return 1;
}

/**
 * Berekent punten voor een sessie op basis van Top10 (positie exact goed).
 * pred/result mogen array zijn, of json dat normalizeTop10 aankan.
 */
export function pointsForSession(predTop10Raw: any, resultTop10Raw: any, sessionKey: string): number {
  const predTop10 = normalizeTop10(predTop10Raw);
  const resultTop10 = normalizeTop10(resultTop10Raw);

  if (predTop10.length === 0 || resultTop10.length === 0) return 0;

  const correct = countCorrectPositions(predTop10, resultTop10);
  return correct * pointsPerCorrectPosition(sessionKey);
}

// ------------------------------------------------------------------
// Weekend bonusvragen (5 punten per correct boolean antwoord)
// userAnswers/correctAnswers: Record<questionId, boolean | null | undefined> of { [qid]: {value:boolean} }
// ------------------------------------------------------------------

function readBool(v: any): boolean | null {
  if (typeof v === "boolean") return v;
  if (v && typeof v === "object" && typeof v.value === "boolean") return v.value;
  return null;
}

export function pointsForWeekendBonusAnswers(
  userAnswers: Record<string, any> | null,
  correctAnswers: Record<string, any> | null
): number {
  if (!userAnswers || !correctAnswers) return 0;

  let points = 0;

  for (const qid of Object.keys(correctAnswers)) {
    const u = readBool(userAnswers[qid]);
    const c = readBool(correctAnswers[qid]);

    // Alleen scoren als user echt heeft geantwoord (true/false) en official ook gezet is
    if (u === null || c === null) continue;
    if (u === c) points += 5;
  }

  return points;
}

// Backwards-compatible alias (als je ergens nog de oude naam gebruikt)
export const pointsForWeekendBonus = pointsForWeekendBonusAnswers;

// ------------------------------------------------------------------
// Season champion pick (50 punten)
// ------------------------------------------------------------------

export function pointsForSeasonChampionPick(userPick: any, correctPick: any): number {
  const u =
    typeof userPick === "string"
      ? userPick
      : typeof userPick?.value === "string"
        ? userPick.value
        : null;

  const c =
    typeof correctPick === "string"
      ? correctPick
      : typeof correctPick?.value === "string"
        ? correctPick.value
        : null;

  if (!u || !c) return 0;
  return u === c ? 50 : 0;
}
