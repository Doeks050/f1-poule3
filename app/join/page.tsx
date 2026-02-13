"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function JoinPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const inviteFromUrl = useMemo(() => (sp.get("code") ?? "").trim().toUpperCase(), [sp]);

  const [inviteCode, setInviteCode] = useState(inviteFromUrl);
  const [displayName, setDisplayName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setInviteCode(inviteFromUrl);
  }, [inviteFromUrl]);

  async function join() {
    setMsg(null);

    const code = inviteCode.trim().toUpperCase();
    const name = displayName.trim();

    if (!code) return setMsg("Vul een invite code in.");
    if (!name || name.length < 2) return setMsg("Kies een username (min 2 tekens).");

    setLoading(true);

    // auth
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setLoading(false);
      router.replace("/login");
      return;
    }

    const session = await supabase.auth.getSession();
    const accessToken = session.data.session?.access_token;
    if (!accessToken) {
      setLoading(false);
      setMsg("Geen access token. Log opnieuw in.");
      return;
    }

    const res = await fetch("/api/join", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ inviteCode: code, displayName: name }),
    });

    const json = await res.json().catch(() => null);

    setLoading(false);

    if (!res.ok) {
      setMsg(json?.error ?? "Join mislukt.");
      return;
    }

    router.replace(`/pools/${json.poolId}`);
  }

  return (
    <main style={{ padding: 16, maxWidth: 520 }}>
      <h1>Join pool</h1>

      {msg && <p style={{ color: "crimson" }}>{msg}</p>}

      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Invite code</div>
          <input
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            placeholder="BV. A1B2C3D4E5"
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #ccc", borderRadius: 10 }}
          />
        </label>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Username</div>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Jouw naam op het leaderboard"
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #ccc", borderRadius: 10 }}
          />
        </label>

        <button onClick={join} disabled={loading} style={{ padding: "10px 12px", borderRadius: 10 }}>
          {loading ? "Joinen…" : "Join"}
        </button>

        <p style={{ opacity: 0.7, fontSize: 13 }}>
          Tip: invite link ziet er zo uit: <code>/join?code=JOUWCODE</code>
        </p>
      </div>
    </main>
  );
}
