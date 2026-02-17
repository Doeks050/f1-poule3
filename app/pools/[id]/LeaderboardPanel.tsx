"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../../../lib/supabaseClient";

type LeaderboardRow = {
  user_id: string;
  display_name?: string | null;
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
      setMsg("Geen sessie token. Log opnieuw in.");
      return;
    }

    try {
      const res = await fetch(
        `/api/pools/${poolId}/leaderboard?accessToken=${encodeURIComponent(
          token
        )}`,
        {
          cache: "no-store", // 🔥 belangrijk tegen caching
        }
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

    // 🔁 Automatische refresh elke 30 sec
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId]);

  return (
    <section
      style={{
        border: "1px solid #ddd",
        borderRadius: 12,
        padding: 16,
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h2 style={{ margin: 0 }}>Leaderboard</h2>

        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #ccc",
            cursor: "pointer",
          }}
        >
          {loading ? "Laden..." : "Ververs"}
        </button>
      </div>

      {msg && (
        <p style={{ color: "crimson", marginBottom: 10 }}>
          {msg}
        </p>
      )}

      {loading && rows.length === 0 && (
        <p style={{ opacity: 0.7 }}>Loading...</p>
      )}

      {!loading && rows.length === 0 && !msg && (
        <p style={{ opacity: 0.7 }}>
          Nog geen scores (of nog geen results/predictions).
        </p>
      )}

      {rows.length > 0 && (
        <ol style={{ paddingLeft: 20, margin: 0 }}>
          {rows.slice(0, 20).map((r, index) => {
            const name =
              (r.display_name ?? "").trim() ||
              `${r.user_id.slice(0, 8)}…`;

            const isTop3 = index < 3;

            return (
              <li
                key={r.user_id}
                style={{
                  marginBottom: 8,
                  padding: "6px 8px",
                  borderRadius: 6,
                  background:
                    index === 0
                      ? "#fff8dc"
                      : index === 1
                      ? "#f2f2f2"
                      : index === 2
                      ? "#ffe4e1"
                      : "transparent",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontWeight: isTop3 ? 600 : 400,
                  }}
                >
                  <span>
                    #{index + 1} — {name}
                  </span>

                  <strong>{r.total_points} pt</strong>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <p style={{ marginTop: 14, fontSize: 12, opacity: 0.6 }}>
        Naam komt uit <code>pool_members.display_name</code>
      </p>
    </section>
  );
}
