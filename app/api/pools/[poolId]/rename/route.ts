import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

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

async function assertOwner(admin: ReturnType<typeof supabaseAdmin>, poolId: string, userId: string) {
  const { data, error } = await admin
    .from("pool_members")
    .select("role")
    .eq("pool_id", poolId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  if (!data || data.role !== "owner") return { ok: false as const, error: "Forbidden (owner only)" };
  return { ok: true as const };
}

export async function DELETE(
  req: Request,
  { params }: { params: { poolId: string } }
) {
  try {
    const poolId = String(params.poolId ?? "").trim();
    if (!poolId) return NextResponse.json({ error: "Missing poolId" }, { status: 400 });

    const accessToken =
      getBearerToken(req) || new URL(req.url).searchParams.get("accessToken");

    if (!accessToken) {
      return NextResponse.json({ error: "Missing accessToken" }, { status: 401 });
    }

    const user = await getUserFromToken(accessToken);
    if (!user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    const admin = supabaseAdmin();

    const ownerCheck = await assertOwner(admin, poolId, user.id);
    if (!ownerCheck.ok) return NextResponse.json({ error: ownerCheck.error }, { status: 403 });

    // 🔥 Verwijder in veilige volgorde (afhankelijk van jouw schema)
    // Als sommige tabellen niet bestaan: laat het weten, dan passen we dit aan.
    await admin.from("event_session_predictions").delete().eq("pool_id", poolId);
    await admin.from("predictions").delete().eq("pool_id", poolId);
    await admin.from("pool_members").delete().eq("pool_id", poolId);

    const { error: delPoolErr } = await admin.from("pools").delete().eq("id", poolId);
    if (delPoolErr) return NextResponse.json({ error: delPoolErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
