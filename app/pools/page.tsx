"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function PoolsPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace("/login");
        return;
      }
      setEmail(data.user.email ?? "");
    })();
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <main style={{ padding: 16 }}>
      <h1>Mijn pools</h1>
      <p>Ingelogd als: {email || "(onbekend)"}</p>

      <p>Volgende stap: pool aanmaken + joinen.</p>

      <button onClick={logout}>Logout</button>
    </main>
  );
}

