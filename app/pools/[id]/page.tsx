"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";

type PoolRow = { id: string; name: string; owner_id: string };
type EventRow = { id: string; name: string; starts_at: string | null; format: "standard" | "sprint" };

export default function PoolDetailPage() {
  const router = useRouter();
  const params = useParams<{ poolId: string }>();
  const poolId = params.poolId;

  const [pool, setPool] = useState<PoolRow | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setMsg(null);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.replace("/login");

      // check membership
      const { data: mem, error: memErr } = await supabase
        .from("pool_members")
        .select("pool_id")
        .eq("pool_id", poolId)
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (memErr) return setMsg(memErr.message);
      if (!mem) return setMsg("Je bent geen member van deze pool.");

      const { data: poolRow, error: poolErr } = await supabase
        .from("pools")
        .select("id,name,owner_id")
        .eq("id", poolId)
        .single();

      if (poolErr) return setMsg(poolErr.message);
      setPool(poolRow);

      const { data: eventRows, error: eventsErr } = await supabase
        .from("events")
        .select("id,name,starts_at,format")
        .order("starts_at", { ascending: true });

      if (eventsErr) return setMsg(eventsErr.message);
      setEvents((eventRows ?? []) as EventRow[]);
    })();
  }, [poolId, router]);

  return (
    <main style={{ padding: 16 }}>
      <button onClick={() => router.replace("/pools")}>← Terug</button>

      <h1 style={{ marginTop: 12 }}>{pool ? pool.name : "Pool"}</h1>
      {msg && <p style={{ color: "crimson" }}>{msg}</p>}

      <h2>Events</h2>
      {events.length === 0 ? (
        <p>Nog geen events. Maak events aan via /admin/results.</p>
      ) : (
        <ul>
          {events.map((e) => (
            <li key={e.id} style={{ marginBottom: 10 }}>
              <div>
                <strong>{e.name}</strong> — <small>{e.format}</small>
              </div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {e.starts_at ? new Date(e.starts_at).toLocaleString() : "—"}
              </div>
              <Link href={`/pools/${poolId}/event/${e.id}`}>Voorspel top10 per sessie →</Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
