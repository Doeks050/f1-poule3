import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const poolId = url.searchParams.get("poolId");

  // accepteer BEIDE varianten: eventId en eventid
  const eventId =
    url.searchParams.get("eventId") ?? url.searchParams.get("eventid");

  if (!poolId || !eventId) {
    return jsonError("Missing poolId or eventId", 400);
  }

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!token) return jsonError("Missing bearer token", 401);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonError("Server env missing", 500);
  }

  // 1) Auth check via anon client (token -> user)
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await authClient.auth.getUser(
    token
  );
  if (userErr || !userData?.user) return jsonError("Invalid session", 401);
  const userId = userData.user.id;

  // 2) Service client voor DB acties
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Membership check
  const { data: memberRow, error: memberErr } = await db
    .from("pool_members")
    .select("user_id")
    .eq("pool_id", poolId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberErr) return jsonError(memberErr.message, 500);
  if (!memberRow) return jsonError("Not a pool member", 403);

  // Helper om questions voor een set te laden (volgorde via position)
  async function loadQuestionsForSet(setId: string) {
    const { data: links, error: linkErr } = await db
      .from("pool_event_bonus_set_questions")
      .select("question_id, position")
      .eq("set_id", setId)
      .order("position", { ascending: true });

    if (linkErr) return { error: linkErr.message, questions: [] as any[] };

    const qids = (links ?? [])
      .map((x: any) => x.question_id)
      .filter(Boolean);

    if (qids.length === 0) return { questions: [] as any[] };

    const { data: qs, error: qsErr } = await db
      .from("bonus_question_bank")
      .select("id, scope, prompt, answer_kind, options, is_active, created_at")
      .in("id", qids);

    if (qsErr) return { error: qsErr.message, questions: [] as any[] };

    // behoud volgorde volgens position
    const byId = new Map((qs ?? []).map((q: any) => [q.id, q]));
    const ordered = (links ?? [])
      .map((l: any) => byId.get(l.question_id))
      .filter(Boolean);

    return { questions: ordered };
  }

  // Helper om answers te laden en te mappen naar { [question_id]: value }
  async function loadAnswers(poolId: string, eventId: string, userId: string) {
    const { data: rows, error } = await db
      .from("bonus_weekend_answers")
      .select("question_id, answer_json, updated_at")
      .eq("pool_id", poolId)
      .eq("event_id", eventId)
      .eq("user_id", userId);

    if (error) return { error: error.message, answers: {}, answersUpdatedAt: null };

    const answers: Record<string, any> = {};
    let answersUpdatedAt: string | null = null;

    for (const r of rows ?? []) {
      answers[r.question_id] = r.answer_json;
      if (r.updated_at && (!answersUpdatedAt || r.updated_at > answersUpdatedAt)) {
        answersUpdatedAt = r.updated_at;
      }
    }

    return { answers, answersUpdatedAt };
  }

  // 3) Bestaat er al een set voor deze pool+event?
  const { data: existingSet, error: setErr } = await db
    .from("pool_event_bonus_sets")
    .select("id, pool_id, event_id, lock_at, created_at")
    .eq("pool_id", poolId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (setErr) return jsonError(setErr.message, 500);

  // Als set bestaat: return met questions + answers
  if (existingSet) {
    const q = await loadQuestionsForSet(existingSet.id);
    if ((q as any).error) return jsonError((q as any).error, 500);

    const lockAt = existingSet.lock_at ? new Date(existingSet.lock_at).getTime() : null;
    const isLocked = lockAt ? Date.now() >= lockAt : false;

    const a = await loadAnswers(poolId, eventId, userId);
    if ((a as any).error) return jsonError((a as any).error, 500);

    return NextResponse.json({
      set: existingSet,
      questions: (q as any).questions,
      isLocked,
      answers: (a as any).answers,
      answersUpdatedAt: (a as any).answersUpdatedAt,
    });
  }

  // 4) Anders: maak set + kies 3 random vragen
  const { data: firstSession, error: sesErr } = await db
    .from("event_sessions")
    .select("starts_at")
    .eq("event_id", eventId)
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (sesErr) return jsonError(sesErr.message, 500);

  let lockAtIso: string | null = null;
  if (firstSession?.starts_at) {
    const t = new Date(firstSession.starts_at).getTime();
    const lockMs = t - 5 * 60 * 1000;
    lockAtIso = new Date(lockMs).toISOString();
  }

  const { data: randomQs, error: qErr } = await db
    .from("bonus_question_bank")
    .select("id")
    .eq("scope", "weekend")
    .eq("is_active", true);

  if (qErr) return jsonError(qErr.message, 500);

  const ids: string[] = (randomQs ?? []).map((x: any) => x.id);
  if (ids.length < 3) return jsonError("Not enough active weekend questions in bank", 400);

  const picked: string[] = [];
  while (picked.length < 3) {
    const idx = Math.floor(Math.random() * ids.length);
    const id = ids[idx];
    if (!picked.includes(id)) picked.push(id);
  }

  const { data: newSet, error: insSetErr } = await db
    .from("pool_event_bonus_sets")
    .insert([{ pool_id: poolId, event_id: eventId, lock_at: lockAtIso }])
    .select("id, pool_id, event_id, lock_at, created_at")
    .single();

  if (insSetErr) return jsonError(insSetErr.message, 500);

  const rows = picked.map((qid, i) => ({
    set_id: newSet.id,
    question_id: qid,
    position: i + 1,
  }));

  const { error: insLinksErr } = await db
    .from("pool_event_bonus_set_questions")
    .insert(rows);

  if (insLinksErr) return jsonError(insLinksErr.message, 500);

  const q = await loadQuestionsForSet(newSet.id);
  if ((q as any).error) return jsonError((q as any).error, 500);

  const lockAt = newSet.lock_at ? new Date(newSet.lock_at).getTime() : null;
  const isLocked = lockAt ? Date.now() >= lockAt : false;

  // Nieuwe set = nog geen answers (maar we geven ze wel consistent mee)
  return NextResponse.json({
    set: newSet,
    questions: (q as any).questions,
    isLocked,
    answers: {},
    answersUpdatedAt: null,
  });
}
