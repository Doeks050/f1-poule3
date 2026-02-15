import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../../../../lib/supabaseAdmin";

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function getUserFromToken(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supa = createClient(url, anon, { auth: { persistSession: false } });

  const { data, error } = await supa.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user;
}

function asJsonAnswer(v: any) {
  return v ?? null;
}

async function getWeekendLockAt(admin: ReturnType<typeof supabaseAdmin>, eventId: string) {
  // lock moment = earliest lock_at of sessions for that event
  const { data, error } = await admin
    .from("event_sessions")
    .select("lock_at")
    .eq("event_id", eventId)
    .order("lock_at", { ascending: true })
    .limit(1);

  if (error) throw new Error(error.message);
  const lockAt = data?.[0]?.lock_at ?? null;
  return lockAt ? String(lockAt) : null;
}

function pickRandom<T>(arr: T[], n: number): T[] {
  const a = [...arr];
  // Fisher-Yates
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export async function GET(
  req: Request,
  { params }: { params: { id: string; eventId: string } }
) {
  try {
    const poolId = params.id;
    const eventId = params.eventId;

    const accessToken =
      getBearerToken(req) || new URL(req.url).searchParams.get("accessToken");

    if (!accessToken) return NextResponse.json({ error: "Missing accessToken" }, { status: 401 });

    const user = await getUserFromToken(accessToken);
    if (!user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    const admin = supabaseAdmin();

    // membership check
    const { data: mem, error: memErr } = await admin
      .from("pool_members")
      .select("pool_id,user_id")
      .eq("pool_id", poolId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
    if (!mem) return NextResponse.json({ error: "Not a pool member" }, { status: 403 });

    const lockAt = await getWeekendLockAt(admin, eventId);
    const locked = lockAt ? Date.now() >= new Date(lockAt).getTime() : false;

    // ensure weekend set exists (pool+event => question_ids[3])
    const { data: existingSet, error: setErr } = await admin
      .from("bonus_weekend_sets")
      .select("id,pool_id,event_id,question_ids")
      .eq("pool_id", poolId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 });

    let questionIds: string[] = (existingSet?.question_ids ?? []) as any;

    if (!existingSet) {
      // pick 3 random active weekend questions
      const { data: allQ, error: qErr } = await admin
        .from("bonus_questions")
        .select("id")
        .eq("scope", "weekend")
        .eq("is_active", true);

      if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

      const ids = (allQ ?? []).map((x: any) => x.id);
      if (ids.length < 3) {
        return NextResponse.json(
          { error: "Not enough active weekend bonus questions (need at least 3)" },
          { status: 400 }
        );
      }

      questionIds = pickRandom(ids, 3).map(String);

      const { error: insErr } = await admin
        .from("bonus_weekend_sets")
        .insert({ pool_id: poolId, event_id: eventId, question_ids: questionIds });

      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    // load question text
    const { data: qs, error: qsErr } = await admin
      .from("bonus_questions")
      .select("id,question,answer_type")
      .in("id", questionIds);

    if (qsErr) return NextResponse.json({ error: qsErr.message }, { status: 500 });

    // existing answers for this user/pool/event
    const { data: ans, error: aErr } = await admin
      .from("bonus_weekend_answers")
      .select("question_id,answer_json,updated_at")
      .eq("pool_id", poolId)
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .in("question_id", questionIds);

    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

    const ansByQ: Record<string, any> = {};
    for (const a of ans ?? []) ansByQ[a.question_id] = a;

    // keep stable order according to questionIds
    const qById: Record<string, any> = {};
    for (const q of qs ?? []) qById[q.id] = q;

    const out = questionIds
      .map((id) => qById[id])
      .filter(Boolean)
      .map((q: any) => ({
        id: q.id,
        question: q.question,
        answer_type: q.answer_type,
        answer: ansByQ[q.id]?.answer_json ?? null,
        updated_at: ansByQ[q.id]?.updated_at ?? null,
      }));

    return NextResponse.json({
      ok: true,
      poolId,
      eventId,
      lockAt,
      locked,
      questions: out,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string; eventId: string } }
) {
  try {
    const poolId = params.id;
    const eventId = params.eventId;

    const accessToken =
      getBearerToken(req) || new URL(req.url).searchParams.get("accessToken");

    if (!accessToken) return NextResponse.json({ error: "Missing accessToken" }, { status: 401 });

    const user = await getUserFromToken(accessToken);
    if (!user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const items = Array.isArray(body?.answers) ? body.answers : null;

    if (!items) {
      return NextResponse.json({ error: "Missing answers[] payload" }, { status: 400 });
    }

    const admin = supabaseAdmin();

    // membership check
    const { data: mem, error: memErr } = await admin
      .from("pool_members")
      .select("pool_id,user_id")
      .eq("pool_id", poolId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
    if (!mem) return NextResponse.json({ error: "Not a pool member" }, { status: 403 });

    const lockAt = await getWeekendLockAt(admin, eventId);
    if (lockAt && Date.now() >= new Date(lockAt).getTime()) {
      return NextResponse.json({ error: "Weekend bonus is locked" }, { status: 423 });
    }

    // get weekend set (must exist)
    const { data: setRow, error: setErr } = await admin
      .from("bonus_weekend_sets")
      .select("question_ids")
      .eq("pool_id", poolId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 });
    if (!setRow?.question_ids || (setRow.question_ids as any[]).length !== 3) {
      return NextResponse.json({ error: "Weekend bonus set not initialized" }, { status: 400 });
    }

    const allowed = new Set((setRow.question_ids as any[]).map(String));

    // validate payload only contains allowed question_ids
    for (const it of items) {
      const qid = String(it?.question_id ?? "").trim();
      if (!qid || !allowed.has(qid)) {
        return NextResponse.json({ error: `Invalid question_id: ${qid}` }, { status: 400 });
      }
    }

    const rows = items.map((x: any) => ({
      pool_id: poolId,
      event_id: eventId,
      user_id: user.id,
      question_id: String(x.question_id),
      answer_json: asJsonAnswer(x.answer),
    }));

    const { error: upErr } = await admin
      .from("bonus_weekend_answers")
      .upsert(rows, { onConflict: "pool_id,event_id,user_id,question_id" });

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, poolId, eventId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
