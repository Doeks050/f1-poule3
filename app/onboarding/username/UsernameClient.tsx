"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

export default function UsernameClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const poolId = searchParams.get("poolId");

  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace("/login");
      }
    })();
  }, [router]);

  async function submit() {
    if (!username.trim()) {
      setMsg("Vul een username in.");
      return;
    }

    setLoading(true);
    setMsg(null);

    const { data } = await supabase.auth.getUser();
    if (!data.user) return;

    const { error } = await supabase
      .from("profiles")
      .upsert({
        id: data.user.id,
        display_name: username.trim(),
      });

    setLoading(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    router.replace(
      poolId
        ? `/pools/${poolId}/onboarding/season`
        : "/pools"
    );
  }

  return (
    <main style={{ padding: 20, maxWidth: 600 }}>
      <h1>Create username</h1>
      <p>Dit is je naam op het leaderboard.</p>

      {msg && <p style={{ color: "crimson" }}>{msg}</p>}

      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid #ccc",
          marginBottom: 12,
        }}
      />

      <button
        onClick={submit}
        disabled={loading}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid black",
          fontWeight: 700,
        }}
      >
        {loading ? "Opslaan..." : "Doorgaan →"}
      </button>
    </main>
  );
}
