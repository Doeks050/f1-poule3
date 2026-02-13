// lib/scoring.ts

export const SESSION_POINTS: Record<string, number> = {
  fp1: 1,
  fp2: 1,
  fp3: 1,
  sq: 3,
  quali: 3,
  sprint: 4,
  race: 5,
};

export function normalizeCode(v: any): string {
  return String(v ?? "").trim().toUpperCase();
}

export function normalizeTop10(arr: any): string[] | null {
  if (!Array.isArray(arr) || arr.length !== 10) return null;
  return arr.map(normalizeCode);
}

export function isExactTop10Match(predTop10: any, resultTop10: any): boolean {
  const p = normalizeTop10(predTop10);
  const r = normalizeTop10(resultTop10);
  if (!p || !r) return false;
  for (let i = 0; i < 10; i++) if (p[i] !== r[i]) return false;
  return true;
}

export function pointsForSession(sessionKey: string, predTop10: any, resultTop10: any): number {
  const pts = SESSION_POINTS[sessionKey] ?? 0;
  if (!pts) return 0;
  return isExactTop10Match(predTop10, resultTop10) ? pts : 0;
}
