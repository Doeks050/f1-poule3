import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const inviteCode = String(body?.inviteCode ?? "").trim().toUpperCase();

    if (!inviteCode) {
      return NextResponse.json({ error: "Missing inviteCode" }, { status: 400 });
    }

    const accessToken =
      getBearerToken(req) || new URL(req.url).searchParams.get("accessToken");

    if (!accessToken) {
      return NextResponse.json({ error: "Missing accessToken" }, { status: 401 });
    }

    const user = await getUserFromToken(accessToken);
    if (!user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const admin = supabaseAdmin();

    // 1) Pool vinden op invite code
    const { data: pool, error: poolErr } = await admin
      .from("pools")
      .select("id,name,invite_code")
      .eq("invite_code", inviteCode)
      .maybeSingle();

    if (poolErr) return NextResponse.json({ error: poolErr.message }, { status: 500 });
    if (!pool) return NextResponse.json({ error: "Invalid invite code" }, { status: 404 });

    // 2) display_name ophalen uit profiles (leidend)
    const { data: prof, error: profErr } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });

    const displayName = String(prof?.display_name ?? "").trim();
    if (!displayName || displayName.length < 2) {
      return NextResponse.json(
        { error: "Je hebt nog geen username. Ga eerst naar onboarding/username." },
        { status: 400 }
      );
    }

    // 3) Upsert membership (invite-only join) + cache display_name in pool_members
    const { error: upErr } = await admin
      .from("pool_members")
      .upsert(
        {
          pool_id: pool.id,
          user_id: user.id,
          display_name: displayName,
        },
        { onConflict: "pool_id,user_id" }
      );

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      poolId: pool.id,
      poolName: pool.name,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
