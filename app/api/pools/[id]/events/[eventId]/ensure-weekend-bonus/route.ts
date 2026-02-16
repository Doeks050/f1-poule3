import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  req: Request,
  ctx: { params: { id: string; eventId: string } }
) {
  const poolId = ctx.params.id;
  const eventId = ctx.params.eventId;

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!poolId || !eventId) return jsonError("Missing poolId or eventId.", 400);
  if (!token) return jsonError("Missing Authorization bearer token.", 401);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonError("Server env missing Supabase keys.", 500);
  }

  // Client to validate token/user
  const authClient = createClient(supabaseUrl, anonKey);

  const { data: userRes, error: userErr } = await authClient.auth.getUser(token);
  if (userErr || !userRes?.user) return jsonError("Unauthorized.", 401);

  const userId = userRes.user.id;

  // Service client for DB (bypasses RLS, so we MUST enforce membership manually)
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // 1) membership check
  const { data: mem, error: memErr } = await db
    .from("pool_members")
    .select("pool_id,user_id")
    .eq("pool_id", poolId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memErr) return jsonError(memErr.message, 500);
  if (!mem) return jsonError("Not a member of this pool.", 403);

  // 2) If set already exists -> return it
  const { data: existing, error: exErr } = await db
    .from("pool_event_bonus_sets")
    .select("id,pool_id,event_id,lock_at,created_at")
    .eq("pool_id", poolId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (exErr) return jsonError(exErr.message, 500);

  if (existing) {
    const { data: qs, error: qsErr } = await db
      .from("pool_event_bonus_set_questions")
      .select("position, question_id, bonus_question_bank(prompt,answer_kind,options)")
      .eq("set_id", existing.id)
      .order("position", { ascending: true });

    if (qsErr) return jsonError(qsErr.message, 500);

    return NextResponse.json({
      set: existing,
      questions: (qs ?? []).map((r: any) => ({
        position: r.position,
        id: r.question_id,
        prompt: r.bonus_question_bank?.prompt ?? "",
        answer_kind: r.bonus_question_bank?.answer_kind ?? "boolean",
        options: r.bonus_question_bank?.options ?? null,
      })),
    });
  }

  // 3) determine lock_at: earliest session lock_at of that event
  const { data: firstSess, error: fsErr } = await db
    .from("event_sessions")
    .select("lock_at, starts_at")
    .eq("event_id", eventId)
    .order("starts_at", { ascending: true })
    .limit(1);

  if (fsErr) return jsonError(fsErr.message, 500);
  if (!firstSess || firstSess.length === 0) {
    return jsonError("No sessions found for this event (cannot determine lock_at).", 400);
  }

  const lockAt = firstSess[0].lock_at ?? null;

  // 4) pick 3 random weekend questions from bank
  const { data: bank, error: bankErr } = await db
    .from("bonus_question_bank")
    .select("id,prompt,answer_kind,options")
    .eq("scope", "weekend")
    .eq("is_active", true)
    .order("id", { ascending: true }); // deterministic fallback if needed

  if (bankErr) return jsonError(bankErr.message, 500);
  if (!bank || bank.length < 3) {
    return jsonError("Not enough active weekend questions in bonus_question_bank (need >= 3).", 400);
  }

  // Random pick 3 (server-side)
  const shuffled = [...bank].sort(() => Math.random() - 0.5);
  const pick = shuffled.slice(0, 3);

  // 5) insert set (handle race-condition via unique index)
  let setRow: any = null;

  const { data: inserted, error: insErr } = await db
    .from("pool_event_bonus_sets")
    .insert({ pool_id: poolId, event_id: eventId, lock_at: lockAt })
    .select("id,pool_id,event_id,lock_at,created_at")
    .maybeSingle();

  if (insErr) {
    // likely unique violation (someone else created it) -> re-read
    const { data: reread, error: rrErr } = await db
      .from("pool_event_bonus_sets")
      .select("id,pool_id,event_id,lock_at,created_at")
      .eq("pool_id", poolId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (rrErr || !reread) return jsonError(insErr.message, 500);
    setRow = reread;
  } else {
    setRow = inserted;
  }

  // 6) insert questions links if not present yet
  // If set already existed due to race, don’t double insert; we can check quickly:
  const { data: alreadyLinks } = await db
    .from("pool_event_bonus_set_questions")
    .select("set_id")
    .eq("set_id", setRow.id)
    .limit(1);

  if (!alreadyLinks || alreadyLinks.length === 0) {
    const rows = pick.map((q, idx) => ({
      set_id: setRow.id,
      question_id: q.id,
      position: idx + 1,
    }));

    const { error: linkErr } = await db
      .from("pool_event_bonus_set_questions")
      .insert(rows);

    if (linkErr) return jsonError(linkErr.message, 500);
  }

  // 7) Return final view
  const { data: qs2, error: qs2Err } = await db
    .from("pool_event_bonus_set_questions")
    .select("position, question_id, bonus_question_bank(prompt,answer_kind,options)")
    .eq("set_id", setRow.id)
    .order("position", { ascending: true });

  if (qs2Err) return jsonError(qs2Err.message, 500);

  return NextResponse.json({
    set: setRow,
    questions: (qs2 ?? []).map((r: any) => ({
      position: r.position,
      id: r.question_id,
      prompt: r.bonus_question_bank?.prompt ?? "",
      answer_kind: r.bonus_question_bank?.answer_kind ?? "boolean",
      options: r.bonus_question_bank?.options ?? null,
    })),
  });
}
