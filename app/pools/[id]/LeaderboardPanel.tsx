"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

type LeaderboardRow = {
  user_id: string;
  total_points: number;
};

export default function LeaderboardPanel({ poolId }: { poolId: string }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);

  async function load() {
    setLoading(true);
    setMsg(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      setLoading(false);
      setMsg("Geen session token. Log opnieuw in.");
      return;
    }

    try {
      const res = await fetch(
        `/api/pools/${poolId}/leaderboard?accessToken=${encodeURIComponent(token)}`
      );
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setRows([]);
        setMsg(json?.error ?? "Leaderboard ophalen mislukt");
        setLoading(false);
        return;
      }

      setRows((json?.leaderboard ?? []) as LeaderboardRow[]);
      setLoading(false);
    } catch (e: any) {
      setRows([]);
      setMsg(e?.message ?? "Onbekende fout");
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!poolId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId]);

  return (
    <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Leaderboard</h2>
        <button onClick={load} disabled={loading} style={{ padding: "6px 10px" }}>
          {loading ? "Laden…" : "Ververs"}
        </button>
      </div>

      {msg ? <p style={{ color: "crimson", marginTop: 10 }}>{msg}</p> : null}

      {loading && rows.length === 0 ? (
        <p style={{ marginTop: 10 }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ marginTop: 10, opacity: 0.8 }}>
          Nog geen scores (of nog geen results/predictions).
        </p>
      ) : (
        <ol style={{ paddingLeft: 18, marginTop: 10 }}>
          {rows.slice(0, 15).map((r) => (
            <li key={r.user_id} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontFamily: "monospace" }}>{r.user_id.slice(0, 8)}…</span>
                <strong>{r.total_points}</strong>
              </div>
            </li>
          ))}
        </ol>
      )}

      <p style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
        (Later vervangen we user_id door naam/email via profiles of pool_members display_name.)
      </p>
    </section>
  );
}
