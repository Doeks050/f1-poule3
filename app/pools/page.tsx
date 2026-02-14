"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

type PoolRow = {
  id: string;
  name: string;
  invite_code?: string | null;
  created_at?: string | null;
};

type MsgState = { type: "error" | "success"; text: string } | null;

export default function PoolsPage() {
  const router = useRouter();

  const [email, setEmail] = useState<string>("");
  const [msg, setMsg] = useState<MsgState>(null);
  const [loading, setLoading] = useState(true);

  const [pools, setPools] = useState<PoolRow[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);

  function normalizeInviteCode(v: string) {
    return (v ?? "").trim().toUpperCase();
  }

  async function loadPools() {
    setLoading(true);
    setMsg(null);

    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      router.replace("/login");
      return;
    }

    const user = data.user;
    setEmail(user.email ?? "");

    // 1) Username gate
    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();

    if (profErr) {
      setMsg({ type: "error", text: profErr.message });
      setPools([]);
      setLoading(false);
      return;
    }

    if (!prof?.display_name) {
      router.replace("/onboarding/username");
      return;
    }

    // 2) Alleen pools waar je member bent
    const { data: memberRows, error: mErr } = await supabase
      .from("pool_members")
      .select("pool_id")
      .eq("user_id", user.id);

    if (mErr) {
      setMsg({ type: "error", text: mErr.message });
      setPools([]);
      setLoading(false);
      return;
    }

    const poolIds = (memberRows ?? []).map((r: any) => r.pool_id).filter(Boolean);

    if (poolIds.length === 0) {
      setPools([]);
      setLoading(false);
      return;
    }

    const { data: poolRows, error: pErr } = await supabase
      .from("pools")
      .select("id,name,invite_code,created_at")
      .in("id", poolIds)
      .order("created_at", { ascending: false });

    if (pErr) {
      setMsg({ type: "error", text: pErr.message });
      setPools([]);
      setLoading(false);
      return;
    }

    setPools((poolRows ?? []) as PoolRow[]);
    setLoading(false);
  }

  useEffect(() => {
    loadPools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function joinPool() {
    setMsg(null);

    const code = normalizeInviteCode(joinCode);
    if (!code) {
      setMsg({ type: "error", text: "Vul een invite code in." });
      return;
    }

    setJoining(true);

    // token + user
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    const { data: u } = await supabase.auth.getUser();
    const user = u.user;

    if (!user || !token) {
      setJoining(false);
      router.replace("/login");
      return;
    }

    try {
      // ✅ Server join route (POST)
      const res = await fetch("/api/join", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ inviteCode: code }),
      });

      const raw = await res.text();
      let json: any = {};
      try {
        json = JSON.parse(raw);
      } catch {}

      if (!res.ok) {
        setJoining(false);
        setMsg({
          type: "error",
          text: `Join mislukt (status ${res.status}). ${json?.error ?? raw}`.trim(),
        });
        return;
      }

      const poolId = json?.poolId as string | undefined;
      const poolName = json?.poolName as string | undefined;

      if (!poolId) {
        setJoining(false);
        setMsg({ type: "error", text: "Join gelukt maar geen poolId teruggekregen." });
        return;
      }

      setMsg({ type: "success", text: `✅ Joined: ${poolName ?? "Pool"}` });
      setJoinCode("");

      // ✅ Betrouwbaar: refresh echte lijst uit DB
      await loadPools();

      setJoining(false);
      router.push(`/pools/${poolId}`);
    } catch (e: any) {
      setJoining(false);
      setMsg({ type: "error", text: e?.message ?? "Join mislukt door een onbekende fout." });
    }
  }

  return (
    <main style={{ padding: 16, maxWidth: 900 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Mijn pools</h1>
          <p style={{ marginTop: 6, opacity: 0.8 }}>Ingelogd als: {email || "-"}</p>
        </div>
        <button onClick={logout}>Logout</button>
      </div>

      {msg && (
        <p style={{ color: msg.type === "error" ? "crimson" : "green", marginTop: 10 }}>
          {msg.text}
        </p>
      )}

      <hr style={{ margin: "16px 0" }} />

      {/* Blikvanger: join */}
      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 14,
          padding: 16,
          background: "white",
          boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>Join een pool</h2>
        <p style={{ marginTop: 0, opacity: 0.8 }}>
          Vul een invite code in (je kunt alleen joinen met een geldige code).
        </p>

        <div style={{ display: "flex", gap: 10, alignItems: "center", maxWidth: 520 }}>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="Invite code (bv. 464BD22026)"
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ccc",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              letterSpacing: 0.5,
            }}
          />
          <button onClick={joinPool} disabled={joining} style={{ padding: "10px 12px", borderRadius: 10 }}>
            {joining ? "Joining…" : "Join"}
          </button>
        </div>
      </section>

      <h2 style={{ marginTop: 24 }}>Jouw pools</h2>

      {loading ? (
        <p>Loading…</p>
      ) : pools.length === 0 ? (
        <p style={{ opacity: 0.8 }}>
          Je zit nog in geen enkele pool. Gebruik hierboven een invite code om te joinen.
        </p>
      ) : (
        <ul style={{ paddingLeft: 18 }}>
          {pools.map((p) => (
            <li key={p.id} style={{ marginBottom: 6 }}>
              <Link href={`/pools/${p.id}`}>{p.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
