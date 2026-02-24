import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  if (extra) console.log(`[WEEKEND_ANSWERS] ERROR EXTRA:`, extra);
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
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

// Normaliseert zowel boolean als {value:boolean|null}
function readAnswerJson(input: any): boolean | null | undefined {
  if (typeof input === "boolean") return input;
  if (input && typeof input === "object" && "value" in input) {
    const v = (input as any).value;
    if (typeof v === "boolean") return v;
    if (v === null) return null;
  }
  if (input === null) return null;
  return undefined;
}

type IncomingRow = {
  pool_id: string;
  event_id: string;
  question_id: string;
  answer_json: any; // boolean | null | {value: boolean|null}
};

export async function POST(req: Request) {
  const reqId = makeReqId();
  const DBG = isDbgEnabled(req);

  try {
    const url = new URL(req.url);
    const accessToken =
      getBearerToken(req) || url.searchParams.get("accessToken");

    dbg(reqId, DBG, "start", { hasAccessToken: !!accessToken });

    if (!accessToken) return jsonError("Missing accessToken", 401);

    const user = await getUserFromToken(accessToken);
    dbg(reqId, DBG, "user", { ok: !!user, userId: user?.id ?? null });
    if (!user) return jsonError("Invalid session", 401);

    const body = await req.json().catch(() => null);
    dbg(reqId, DBG, "body received", body);

    // Support:
    // { pool_id, event_id, question_id, answer_json }
    // or { rows: [ ... ] }
    const rows: IncomingRow[] = Array.isArray(body?.rows)
      ? body.rows
      : body
        ? [body]
        : [];

    if (!rows.length) return jsonError("No answers provided", 400);

    // Validate required fields (no assumptions)
    for (const r of rows) {
      if (!r?.pool_id || !r?.event_id || !r?.question_id) {
        return jsonError("Missing pool_id / event_id / question_id", 400, {
          badRow: r,
        });
      }
    }

    const admin = supabaseAdmin();

    // membership check per pool (veilig)
    // (we doen 1 check op de eerste pool_id; je frontend stuurt altijd 1 pool per call)
    const poolId = rows[0].pool_id;

    const { data: mem, error: memErr } = await admin
      .from("pool_members")
      .select("pool_id,user_id")
      .eq("pool_id", poolId)
      .eq("user_id", user.id)
      .maybeSingle();

    dbg(reqId, DBG, "membership", { ok: !!mem, err: memErr?.message ?? null });

    if (memErr) return jsonError(memErr.message, 500);
    if (!mem) return jsonError("Not a pool member", 403);

    // Process each row:
    // - boolean => upsert
    // - null => delete (wis)
    // - undefined/invalid => 400
    const results: any[] = [];

    for (const r of rows) {
      const parsed = readAnswerJson(r.answer_json);

      dbg(reqId, DBG, "parsed row", {
        pool_id: r.pool_id,
        event_id: r.event_id,
        question_id: r.question_id,
        parsed,
        raw: r.answer_json,
      });

      if (parsed === undefined) {
        return jsonError("Invalid answer_json (must be boolean or null)", 400, {
          question_id: r.question_id,
          answer_json: r.answer_json,
        });
      }

      if (parsed === null) {
        // WIS: delete existing row so NOT NULL never violated
        dbg(reqId, DBG, "delete row", {
          pool_id: r.pool_id,
          event_id: r.event_id,
          question_id: r.question_id,
          user_id: user.id,
        });

        const { error: delErr } = await admin
          .from("event_bonus_answers")
          .delete()
          .eq("pool_id", r.pool_id)
          .eq("event_id", r.event_id)
          .eq("user_id", user.id)
          .eq("question_id", r.question_id);

        if (delErr) {
          dbg(reqId, DBG, "delete error", {
            questionId: r.question_id,
            err: delErr.message,
          });
          return jsonError(delErr.message, 500, { step: "delete", r });
        }

        results.push({ question_id: r.question_id, action: "deleted" });
        continue;
      }

      // SAVE boolean true/false
      const payload = {
        pool_id: r.pool_id,
        event_id: r.event_id,
        user_id: user.id,
        question_id: r.question_id,
        answer_json: parsed, // always boolean here
      };

      dbg(reqId, DBG, "upsert row", payload);

      // IMPORTANT:
      // conflict target moet matchen met je unique constraint.
      // In jouw eerdere SQL/screenshot was dit meestal:
      // (pool_id, event_id, user_id, question_id)
      const { data: up, error: upErr } = await admin
        .from("event_bonus_answers")
        .upsert(payload, { onConflict: "pool_id,event_id,user_id,question_id" })
        .select("pool_id,event_id,user_id,question_id,answer_json")
        .maybeSingle();

      if (upErr) {
        dbg(reqId, DBG, "upsert error", {
          questionId: r.question_id,
          err: upErr.message,
        });
        return jsonError(upErr.message, 500, { step: "upsert", r });
      }

      results.push({ question_id: r.question_id, action: "upserted", row: up });
    }

    dbg(reqId, DBG, "done", { savedCount: results.length });

    return NextResponse.json(
      { ok: true, results },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    console.log(
      `[WEEKEND_ANSWERS][${reqId}] ERROR 500`,
      e?.message ?? e,
      e?.stack ?? ""
    );
    return jsonError(e?.message ?? "Unknown error", 500);
  }
}
