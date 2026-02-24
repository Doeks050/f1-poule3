import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

// --------------------
// Debug helpers
// --------------------
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
  const prefix = `[WEEKEND_ANSWERS][${reqId}] ${label}`;
  if (data !== undefined) console.log(prefix, data);
  else console.log(prefix);
}
function jsonError(message: string, status = 400, extra?: any) {
  if (extra) console.log("[WEEKEND_ANSWERS] ERROR EXTRA:", extra);
  return NextResponse.json({ error: message }, { status });
}

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function getUserFromToken(accessToken: string, reqId: string, DBG: boolean) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supa = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await supa.auth.getUser(accessToken);
  dbg(reqId, DBG, "auth.getUser", { ok: !!data?.user, err: error?.message ?? null });
  if (error || !data?.user) return null;
  return data.user;
}

// Accept both: boolean OR { value: boolean|null }
function normalizeAnswerJson(input: any): any {
  if (typeof input === "boolean") return input;
  if (input && typeof input === "object" && "value" in input) {
    const v = (input as any).value;
    if (typeof v === "boolean") return v;
    return null; // treat null/undefined as "no answer"
  }
  if (input === null || input === undefined) return null;
  return input; // keep as-is (debugging)
}

// body support:
// A) { poolId, eventId, answers: { [questionId]: true/false } }
// B) { poolId, eventId, answers: [ { question_id, answer_json } ] }
// C) { poolId, eventId, responses: [...] } (fallback)
function parseAnswers(body: any) {
  const poolId = body?.poolId ?? body?.pool_id ?? null;
  const eventId = body?.eventId ?? body?.event_id ?? null;

  const raw =
    body?.answers ??
    body?.responses ??
    body?.data ??
    null;

  const rows: Array<{ question_id: string; answer_json: any }> = [];

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    // map form
    for (const [qid, val] of Object.entries(raw)) {
      if (!qid) continue;
      rows.push({ question_id: qid, answer_json: val });
    }
  } else if (Array.isArray(raw)) {
    for (const r of raw) {
      const qid = r?.question_id ?? r?.questionId ?? r?.qid ?? null;
      if (!qid) continue;
      const aj = r?.answer_json ?? r?.answerJson ?? r?.value ?? r?.answer ?? null;
      rows.push({ question_id: qid, answer_json: aj });
    }
  }

  return { poolId, eventId, rows };
}

export async function POST(req: Request) {
  const reqId = makeReqId();
  const DBG = isDbgEnabled(req);

  try {
    const url = new URL(req.url);

    const accessToken =
      getBearerToken(req) || url.searchParams.get("accessToken");

    dbg(reqId, DBG, "token present", { hasAccessToken: !!accessToken });

    if (!accessToken) return jsonError("Missing accessToken", 401);

    const user = await getUserFromToken(accessToken, reqId, DBG);
    if (!user) return jsonError("Invalid session", 401);

    const body = await req.json().catch(() => null);
    dbg(reqId, DBG, "body received", body);

    if (!body) return jsonError("Invalid JSON body", 400);

    const { poolId, eventId, rows } = parseAnswers(body);

    dbg(reqId, DBG, "parsed", {
      poolId,
      eventId,
      rowsCount: rows.length,
      sample: rows.slice(0, 3),
    });

    if (!poolId || !eventId) return jsonError("Missing poolId or eventId", 400);
    if (!rows || rows.length === 0) return jsonError("No answers provided", 400);

    const admin = supabaseAdmin();

    // membership check
    const { data: mem, error: memErr } = await admin
      .from("pool_members")
      .select("pool_id,user_id")
      .eq("pool_id", poolId)
      .eq("user_id", user.id)
      .maybeSingle();

    dbg(reqId, DBG, "membership", { ok: !!mem, err: memErr?.message ?? null });

    if (memErr) return jsonError(memErr.message, 500);
    if (!mem) return jsonError("Not a pool member", 403);

    // We will do "update if exists else insert" PER question.
    // This works even if there is NO unique constraint.
    const results: Array<{ question_id: string; action: string }> = [];

    for (const r of rows) {
      const questionId = r.question_id;
      const answerJson = normalizeAnswerJson(r.answer_json);

      // If answerJson is null => we still store null (or you can delete row). We'll store null.
      dbg(reqId, DBG, "upsert row", { questionId, answerJson });

      // 1) check if row exists
      const { data: existing, error: exErr } = await admin
        .from("event_bonus_answers")
        .select("id")
        .eq("pool_id", poolId)
        .eq("event_id", eventId)
        .eq("user_id", user.id)
        .eq("question_id", questionId)
        .maybeSingle();

      if (exErr) {
        dbg(reqId, DBG, "select existing error", { questionId, err: exErr.message });
        return jsonError(exErr.message, 500, { step: "select-existing", questionId });
      }

      if (existing?.id) {
        // 2a) update
        const { error: updErr } = await admin
          .from("event_bonus_answers")
          .update({
            answer_json: answerJson,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        if (updErr) {
          dbg(reqId, DBG, "update error", { questionId, err: updErr.message });
          return jsonError(updErr.message, 500, { step: "update", questionId });
        }

        results.push({ question_id: questionId, action: "updated" });
      } else {
        // 2b) insert
        const { error: insErr } = await admin
          .from("event_bonus_answers")
          .insert({
            pool_id: poolId,
            event_id: eventId,
            user_id: user.id,
            question_id: questionId,
            answer_json: answerJson,
          });

        if (insErr) {
          dbg(reqId, DBG, "insert error", { questionId, err: insErr.message });
          return jsonError(insErr.message, 500, { step: "insert", questionId });
        }

        results.push({ question_id: questionId, action: "inserted" });
      }
    }

    dbg(reqId, DBG, "done", { saved: results.length });

    return NextResponse.json(
      { ok: true, poolId, eventId, saved: results },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    console.log(`[WEEKEND_ANSWERS][${reqId}] ERROR 500`, e?.message ?? e, e?.stack ?? "");
    return jsonError(e?.message ?? "Unknown error", 500);
  }
}
