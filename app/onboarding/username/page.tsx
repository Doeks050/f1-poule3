"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

function cleanName(v: string) {
  return v.replace(/\s+/g, " ").trim();
}

export default function UsernameOnboardingPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const next = useMemo(() => {
    const n = sp.get("next");
    // basic safety: only allow internal paths
    if (!n || !n.startsWith("/")) return "/pools";
    return n;
  }, [sp]);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      const { data, error } = await supabase.auth.getUser();
      if (error) {
        setMsg(error.message);
        setLoading(false);
        return;
      }
      if (!data.user) {
        router.replace("/login");
        return;
      }
      setUserId(data.user.id);

      // Bestaat er al een profile/display_name? Dan direct door naar next.
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("id, display_name")
        .eq("id", data.user.id)
        .maybeSingle();

      if (!profErr && prof?.display_name && String(prof.display_name).trim().length > 0) {
        router.replace(next);
        return;
      }

      setLoading(false);
    })();
  }, [router, next]);

  async function save() {
    setMsg(null);

    if (!userId) {
      setMsg("Geen user. Log opnieuw in.");
      return;
    }

    const dn = cleanName(name);
    if (dn.length < 2) {
      setMsg("Username moet minimaal 2 tekens zijn.");
      return;
    }
    if (dn.length > 24) {
      setMsg("Username mag maximaal 24 tekens zijn.");
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from("profiles")
      .upsert({ id: userId, display_name: dn }, { onConflict: "id" });

    setSaving(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    router.replace(next);
  }

  if (loading) {
    return (
      <main style={{ padding: 16 }}>
        <h1>Username</h1>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 16, maxWidth: 520 }}>
      <h1 style={{ marginTop: 0 }}>Create username</h1>
      <p style={{ opacity: 0.8 }}>
        Dit is je naam op het leaderboard en in de members list.
      </p>

      {msg ? <p style={{ color: "crimson" }}>{msg}</p> : null}

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Username</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Bijv. Nix"
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ccc",
          }}
        />
      </div>

      <button
        onClick={save}
        disabled={saving}
        style={{
          marginTop: 12,
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #111",
          fontWeight: 800,
        }}
      >
        {saving ? "Opslaan…" : "Doorgaan →"}
      </button>
    </main>
  );
}
