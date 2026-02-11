"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

type PoolRow = {
  id: string;
  name: string;
  created_at?: string;
};

type EventRow = {
  id: string;
  name: string;
  starts_at: string | null;
  format: "standard" | "sprint" | string | null;
};

export default function PoolDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  // ✅ BELANGRIJK: map heet [id], dus param is params.id
  const poolId = (params?.id ?? "") as string;

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [pool, setPool] = useState<PoolRow | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);

  const isUuid = useMemo(() => {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(poolId);
  }, [poolId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      // auth check
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace("/login");
        return;
      }

      if (!poolId || !isUuid) {
        setMsg(`Pool id ontbreekt of is ongeldig: "${poolId || "leeg"}"`);
        setLoading(false);
        return;
      }

      // ✅ Pool ophalen
      const { data: poolRow, error: poolErr } = await supabase
        .from("pools")
        .select("id,name,created_at")
        .eq("id", poolId)
        .maybeSingle();

      if (poolErr) {
        setMsg(poolErr.message);
        setLoading(false);
        return;
      }

      if (!poolRow) {
        setMsg("Pool niet gevonden.");
        setLoading(false);
        return;
      }

      setPool(poolRow as PoolRow);

      // ✅ Events ophalen (globaal, uit jouw import)
      const { data: evRows, error: evErr } = await supabase
        .from("events")
        .select("id,name,starts_at,format")
        .order("starts_at", { ascending: true });

      if (evErr) {
        setMsg(evErr.message);
        setEvents([]);
        setLoading(false);
        return;
      }

      setEvents((evRows ?? []) as EventRow[]);
      setLoading(false);
    })();
  }, [router, poolId, isUuid]);

  // highlight: eerstvolgende event
  const nextEventId = useMemo(() => {
    const now = Date.now();
    const upcoming = events.find((e) => (e.starts_at ? new Date(e.starts_at).getTime() : 0) > now);
    return upcoming?.id ?? null;
  }, [events]);

  if (loading) {
    return (
      <main style={{ padding: 16 }}>
        <Link href="/pools">← Terug</Link>
        <h1>Pool</h1>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 16 }}>
      <Link href="/pools">← Terug</Link>

      <h1>{pool?.name ?? "Pool"}</h1>

      {msg && <p style={{ color: "crimson" }}>{msg}</p>}

      <h2 style={{ marginTop: 24 }}>Events</h2>

      {events.length === 0 ? (
        <p>Nog geen events. Run import via <code>/admin/import-calendar</code>.</p>
      ) : (
        <ul style={{ paddingLeft: 18 }}>
          {events.map((e) => {
            const isNext = e.id === nextEventId;
            const when = e.starts_at ? new Date(e.starts_at).toLocaleString() : "geen datum";
            const label = e.format === "sprint" ? "Sprint weekend" : "Standaard weekend";

            return (
              <li key={e.id} style={{ marginBottom: 8 }}>
                <Link
                  href={`/pools/${poolId}/event/${e.id}`}
                  style={{ fontWeight: isNext ? "bold" : "normal" }}
                >
                  {isNext ? "➡️ " : ""}
                  {e.name}
                </Link>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {when} • {label}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
