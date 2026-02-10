"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  async function signUp() {
    setMsg(null);
    const { error } = await supabase.auth.signUp({ email, password: pw });
    setMsg(error ? error.message : "Account aangemaakt. Log nu in.");
  }

  async function signIn() {
    setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    if (error) return setMsg(error.message);
    router.push("/pools");
  }

  return (
    <main>
      <h1>Login</h1>
      <div style={{ display: "grid", gap: 8, maxWidth: 380 }}>
        <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={signIn}>Login</button>
          <button onClick={signUp}>Sign up</button>
        </div>
        {msg && <p>{msg}</p>}
      </div>
    </main>
  );
}
