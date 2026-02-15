import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../../../lib/supabaseAdmin";

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
  // we store as jsonb, keep it simple
  return v ?? null;
}

async function getSeasonLockAt(admin: ReturnType<typeof supabaseAdmin>) {
  // lock moment = earliest lock_at of all sessions (season start)
  const { data, error } = await admin
    .from("event_sessions")
    .select("lock_at")
    .order("lock_at", { ascending: true })
    .limit(1);

  if (error) throw new Error(error.message);
  const lockAt = data?.[0]?.lock_at ?? null;
  return lockAt ? String(lockAt) : null;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const poolId = params.id;

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

    const lockAt = await getSeasonLockAt(admin);
    const locked = lockAt ? Date.now() >= new Date(lockAt).getTime() : false;

    // active season questions
    const { data: questions, error: qErr } = await admin
      .from("bonus_questions")
      .select("id,scope,question,answer_type,is_active")
      .eq("scope", "season")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

    // existing answers for this user/pool
    const qIds = (questions ?? []).map((q: any) => q.id);
    let answers: any[] = [];
    if (qIds.length > 0) {
      const { data: a, error: aErr } = await admin
        .from("bonus_season_answers")
        .select("question_id,answer_json,updated_at")
        .eq("pool_id", poolId)
        .eq("user_id", user.id)
        .in("question_id", qIds);

      if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
      answers = a ?? [];
    }

    const answersByQ: Record<string, any> = {};
    for (const a of answers) answersByQ[a.question_id] = a;

    return NextResponse.json({
      ok: true,
      poolId,
      lockAt,
      locked,
      questions: (questions ?? []).map((q: any) => ({
        id: q.id,
        question: q.question,
        answer_type: q.answer_type,
        answer: answersByQ[q.id]?.answer_json ?? null,
        updated_at: answersByQ[q.id]?.updated_at ?? null,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const poolId = params.id;

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

    const lockAt = await getSeasonLockAt(admin);
    if (lockAt && Date.now() >= new Date(lockAt).getTime()) {
      return NextResponse.json({ error: "Season bonus is locked" }, { status: 423 });
    }

    // validate question ids are season+active
    const qIds = Array.from(
      new Set(items.map((x: any) => String(x?.question_id ?? "").trim()).filter(Boolean))
    );

    if (qIds.length === 0) {
      return NextResponse.json({ error: "No question_id in answers" }, { status: 400 });
    }

    const { data: qs, error: qErr } = await admin
      .from("bonus_questions")
      .select("id,scope,is_active")
      .in("id", qIds);

    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

    const okSet = new Set(
      (qs ?? [])
        .filter((q: any) => q.scope === "season" && q.is_active === true)
        .map((q: any) => q.id)
    );

    for (const id of qIds) {
      if (!okSet.has(id)) {
        return NextResponse.json({ error: `Invalid season question_id: ${id}` }, { status: 400 });
      }
    }

    // upsert answers
    const rows = items.map((x: any) => ({
      pool_id: poolId,
      user_id: user.id,
      question_id: String(x.question_id),
      answer_json: asJsonAnswer(x.answer),
    }));

    const { error: upErr } = await admin
      .from("bonus_season_answers")
      .upsert(rows, { onConflict: "pool_id,user_id,question_id" });

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, poolId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
