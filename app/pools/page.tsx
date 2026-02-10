"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useRouter } from "next/navigation";

type PoolRow = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
};

export default function PoolsPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState<string>("");
  const [pools, setPools] = useState<PoolRow[]>([]);
  const [newPoolName, setNewPoolName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setMsg(null);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.replace("/login");
      return;
    }

    setEmail(userData.user.email ?? "");
    setUserId(userData.user.id);

    // Pools waar jij member van bent
    const { data: memberships, error: memErr } = await supabase
      .from("pool_members")
      .select("pool_id")
      .eq("user_id", userData.user.id);

    if (memErr) {
      setMsg(memErr.message);
      return;
    }

    const poolIds = (memberships ?? []).map((m) => m.pool_id);
    if (poolIds.length === 0) {
      setPools([]);
      return;
    }

    const { data: poolRows, error: poolsErr } = await supabase
      .from("pools")
      .select("*")
      .in("id", poolIds)
      .order("created_at", { ascending: false });

    if (poolsErr) {
      setMsg(poolsErr.message);
      return;
    }

    setPools(poolRows ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createPool() {
    setMsg(null);
    const name = newPoolName.trim();
    if (!name) {
      setMsg("Geef je pool een naam.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.replace("/login");
      return;
    }

    // 1) pool maken
    const { data: pool, error: poolErr } = await supabase
      .from("pools")
      .insert({ name, owner_id: userData.user.id })
      .select("*")
      .single();

    if (poolErr) {
      setMsg(poolErr.message);
      return;
    }

    // 2) owner automatisch member maken
    const { error: memErr } = await supabase.from("pool_members").insert({
      pool_id: pool.id,
      user_id: userData.user.id,
    });

    if (memErr) {
      setMsg(memErr.message);
      return;
    }

    setNewPoolName("");
    await load();
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <main style={{ padding: 16 }}>
      <h1>Mijn pools</h1>
      <p>Ingelogd als: {email || "(onbekend)"}</p>
      <p>User ID: {userId}</p>

      <div style={{ marginTop: 16, marginBottom: 16 }}>
        <input
          placeholder="Nieuwe pool naam"
          value={newPoolName}
          onChange={(e) => setNewPoolName(e.target.value)}
        />
        <button onClick={createPool} style={{ marginLeft: 8 }}>
          Pool aanmaken
        </button>
      </div>

      {msg && <p style={{ color: "crimson" }}>{msg}</p>}

      <h2>Jouw pools</h2>
      {pools.length === 0 ? (
        <p>Je zit nog in geen enkele pool.</p>
      ) : (
        <ul>
          {pools.map((p) => (
            <li key={p.id}>
              <strong>{p.name}</strong> <br />
              <small>{p.id}</small>
            </li>
          ))}
        </ul>
      )}

      <button onClick={logout}>Logout</button>
    </main>
  );
}
