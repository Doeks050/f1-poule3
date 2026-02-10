"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

export default function ImportCalendarPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      const { data } = await supabase.auth.getUser();
      if (!data.user) return router.replace("/login");

      const { data: adminRow, error } = await supabase
        .from("app_admins")
        .select("user_id")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (error) {
        setMsg(error.message);
        setIsAdmin(false);
      } else {
        setIsAdmin(!!adminRow);
      }
      setLoading(false);
    })();
  }, [router]);

  async function runImport() {
    setMsg(null);
    setBusy(true);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      setBusy(false);
      setMsg("Geen session token. Log opnieuw in.");
      return;
    }

    const res = await fetch("/api/admin/import-f1-calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token }),
    });

    const json = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setMsg(json?.error ?? "Import mislukt");
      return;
    }

    setMsg(`✅ Import klaar. Events nieuw: ${json.createdEvents}, sessies upsert: ${json.upsertedSessions}`);
  }

  if (loading) return <main style={{ padding: 16 }}><h1>Import kalender</h1><p>Loading…</p></main>;
  if (!isAdmin) return <main style={{ padding: 16 }}><h1>Import kalender</h1><p>Niet toegestaan (geen admin).</p></main>;

  return (
    <main style={{ padding: 16, maxWidth: 800 }}>
      <h1>Import F1 kalender (2026)</h1>
      <p>Dit haalt de officiële F1 ICS op en vult events + sessies. Lock = 5 min voor start.</p>

      <button onClick={runImport} disabled={busy}>
        {busy ? "Importeren…" : "Import nu"}
      </button>

      <button style={{ marginLeft: 8 }} onClick={() => router.push("/admin/results")}>
        Naar Admin Results
      </button>

      {msg && <p style={{ marginTop: 12, color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</p>}
    </main>
  );
}
