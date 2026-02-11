"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

type PoolRow = {
  id: string;
  name: string;
};

export default function PoolsPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pools, setPools] = useState<PoolRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace("/login");
        return;
      }

      setEmail(data.user.email ?? "");

      // simpel: toon pools waar user member is (als je die al hebt)
      // fallback: toon alle pools als pool_members nog niet gebruikt wordt
      const { data: memberRows, error: mErr } = await supabase
        .from("pool_members")
        .select("pool_id")
        .eq("user_id", data.user.id);

      if (!mErr && memberRows && memberRows.length > 0) {
        const poolIds = memberRows.map((r: any) => r.pool_id);

        const { data: poolRows, error: pErr } = await supabase
          .from("pools")
          .select("id,name")
          .in("id", poolIds)
          .order("created_at", { ascending: false });

        if (pErr) setMsg(pErr.message);
        setPools((poolRows ?? []) as PoolRow[]);
      } else {
        const { data: poolRows, error: pErr } = await supabase
          .from("pools")
          .select("id,name")
          .order("created_at", { ascending: false });

        if (pErr) setMsg(pErr.message);
        setPools((poolRows ?? []) as PoolRow[]);
      }

      setLoading(false);
    })();
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <main style={{ padding: 16 }}>
      <h1>Mijn pools</h1>
      <p>Ingelogd als: {email || "-"}</p>

      <button onClick={logout}>Logout</button>

      {msg && <p style={{ color: "crimson" }}>{msg}</p>}

      <h2 style={{ marginTop: 24 }}>Pools</h2>

      {loading ? (
        <p>Loading…</p>
      ) : pools.length === 0 ? (
        <p>Nog geen pools.</p>
      ) : (
        <ul style={{ paddingLeft: 18 }}>
          {pools.map((p) => (
            <li key={p.id}>
              {/* ✅ belangrijk: altijd p.id */}
              <Link href={`/pools/${p.id}`}>{p.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
