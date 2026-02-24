import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

function makeReqId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function isDbgEnabled(req: Request) {
  if (process.env.DBG === "1") return true;
  try {
    return new URL(req.url).searchParams.get("dbg") === "1";
  } catch {
    return false;
  }
}
function dbg(reqId: string, enabled: boolean, label: string, data?: any) {
  if (!enabled) return;
  const prefix = `[WEEKEND_SET][${reqId}] ${label}`;
  if (data !== undefined) console.log(prefix, data);
  else console.log(prefix);
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

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
  if (error || !data?.user) return null;
  return data.user;
}

// Random selectie zonder DB-functies: shuffle in JS
function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

export async function GET(req: Request) {
  const reqId = makeReqId();
  const DBG = isDbgEnabled(req);

  try {
    const url = new URL(req.url);
    const poolId = url.searchParams.get("poolId");
    const eventId = url.searchParams.get("eventId");

    dbg(reqId, DBG, "start", { poolId, eventId });

    if (!poolId || !eventId) return jsonError("Missing poolId or eventId", 400);

    const accessToken =
      getBearerToken(req) || url.searchParams.get("accessToken");

    dbg(reqId, DBG, "token present", { hasAccessToken: !!accessToken });

    if (!accessToken) return jsonError("Missing accessToken", 401);

    const user = await getUserFromToken(accessToken);
    dbg(reqId, DBG, "user", { ok: !!user, userId: user?.id ?? null });
    if (!user) return jsonError("Invalid session", 401);

    const admin = supabaseAdmin();

    // membership check (pool_members)
    const { data: mem, error: memErr } = await admin
      .from("pool_members")
      .select("pool_id,user_id")
      .eq("pool_id", poolId)
      .eq("user_id", user.id)
      .maybeSingle();

    dbg(reqId, DBG, "membership", { ok: !!mem, err: memErr?.message ?? null });
    if (memErr) return jsonError(memErr.message, 500);
    if (!mem) return jsonError("Not a pool member", 403);

    // 1) Bestaat er al een set voor (pool,event)?
    const { data: existing, error: exErr } = await admin
      .from("bonus_weekend_sets")
      .select("id,question_ids")
      .eq("pool_id", poolId)
      .eq("event_id", eventId)
      .maybeSingle();

    dbg(reqId, DBG, "existing set", {
      has: !!existing,
      setId: existing?.id ?? null,
      qCount: (existing?.question_ids ?? []).length,
      err: exErr?.message ?? null,
    });

    if (exErr) return jsonError(exErr.message, 500);

    let questionIds: string[] = (existing?.question_ids ?? []) as string[];

    // 2) Geen set? Maak hem aan met exact 3 random actieve weekend questions
    if (questionIds.length !== 3) {
      const { data: bankRows, error: bankErr } = await admin
        .from("bonus_question_bank")
        .select("id,scope,answer_kind,is_active")
        .eq("is_active", true)
        .eq("scope", "weekend")
        .eq("answer_kind", "boolean");

      dbg(reqId, DBG, "question bank fetch", {
        count: (bankRows ?? []).length,
        err: bankErr?.message ?? null,
      });

      if (bankErr) return jsonError(bankErr.message, 500);

      const ids = (bankRows ?? []).map((r: any) => r.id).filter(Boolean);

      if (ids.length < 3) {
        return jsonError("Not enough active weekend boolean questions in bonus_question_bank", 400);
      }

      questionIds = pickRandom(ids, 3);

      dbg(reqId, DBG, "picked random qids", { questionIds });

      // Upsert set
      // IMPORTANT: bonus_weekend_sets moet uniek zijn op (pool_id,event_id)
      const { data: upSet, error: upErr } = await admin
        .from("bonus_weekend_sets")
        .upsert(
          {
            pool_id: poolId,
            event_id: eventId,
            question_ids: questionIds,
          },
          { onConflict: "pool_id,event_id" }
        )
        .select("id,question_ids")
        .maybeSingle();

      dbg(reqId, DBG, "upsert set", {
        ok: !!upSet,
        setId: upSet?.id ?? null,
        qCount: (upSet?.question_ids ?? []).length,
        err: upErr?.message ?? null,
      });

      if (upErr) return jsonError(upErr.message, 500);

      questionIds = (upSet?.question_ids ?? questionIds) as string[];
    }

    // 3) Haal de 3 vragen op in de juiste volgorde (volgorde = array volgorde)
    const { data: qRows, error: qErr } = await admin
      .from("bonus_question_bank")
      .select("id,prompt,answer_kind,scope")
      .in("id", questionIds);

    dbg(reqId, DBG, "fetch selected questions", {
      want: questionIds.length,
      got: (qRows ?? []).length,
      err: qErr?.message ?? null,
    });

    if (qErr) return jsonError(qErr.message, 500);

    const byId: Record<string, any> = {};
    for (const r of qRows ?? []) byId[(r as any).id] = r;

    const ordered = questionIds
      .map((id) => byId[id])
      .filter(Boolean)
      .map((r: any) => ({
        id: r.id,
        prompt: r.prompt,
        answer_kind: r.answer_kind,
        scope: r.scope,
      }));

    dbg(reqId, DBG, "done", { returned: ordered.length });

    return NextResponse.json(
      {
        ok: true,
        poolId,
        eventId,
        questionIds,
        questions: ordered,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    console.log(`[WEEKEND_SET][${reqId}] ERROR 500`, e?.message ?? e, e?.stack ?? "");
    return jsonError(e?.message ?? "Unknown error", 500);
  }
}
