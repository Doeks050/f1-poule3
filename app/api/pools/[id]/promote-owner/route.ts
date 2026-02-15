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

export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const poolId = String(ctx?.params?.id ?? "").trim();
    if (!poolId) {
      return NextResponse.json({ error: "Missing pool id" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const targetUserId = String(body?.userId ?? "").trim();

    if (!targetUserId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
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

    // 1) check: caller is owner in this pool
    const { data: caller, error: callerErr } = await admin
      .from("pool_members")
      .select("role")
      .eq("pool_id", poolId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (callerErr) return NextResponse.json({ error: callerErr.message }, { status: 500 });
    if (!caller || (caller as any).role !== "owner") {
      return NextResponse.json({ error: "Only owner can promote." }, { status: 403 });
    }

    // 2) check: target is member
    const { data: target, error: targetErr } = await admin
      .from("pool_members")
      .select("user_id")
      .eq("pool_id", poolId)
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (targetErr) return NextResponse.json({ error: targetErr.message }, { status: 500 });
    if (!target) return NextResponse.json({ error: "Target is not a member of this pool." }, { status: 404 });

    // 3) enforce single owner: demote all owners -> member
    const { error: demoteErr } = await admin
      .from("pool_members")
      .update({ role: "member" })
      .eq("pool_id", poolId)
      .eq("role", "owner");

    if (demoteErr) return NextResponse.json({ error: demoteErr.message }, { status: 500 });

    // 4) promote target
    const { error: promoteErr } = await admin
      .from("pool_members")
      .update({ role: "owner" })
      .eq("pool_id", poolId)
      .eq("user_id", targetUserId);

    if (promoteErr) return NextResponse.json({ error: promoteErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
