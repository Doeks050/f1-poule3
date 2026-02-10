"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";

type EventRow = { id: string; name: string; format: "standard" | "sprint" };

type SessionKey = "fp1" | "fp2" | "fp3" | "sq" | "sprint" | "quali" | "race";

type PredictionDoc = {
  format: "standard" | "sprint";
  sessions: Partial<Record<SessionKey, { top10: string[] }>>;
};

function emptyTop10(): string[] {
  return Array.from({ length: 10 }, () => "");
}

export default function PredictionPage() {
  const router = useRouter();
  const params = useParams<{ poolId: string; eventId: string }>();
  const poolId = params.poolId;
  const eventId = params.eventId;

  const [msg, setMsg] = useState<string | null>(null);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [userId, setUserId] = useState<string>("");

  const [doc, setDoc] = useState<PredictionDoc | null>(null);
  const [activeSession, setActiveSession] = useState<SessionKey>("fp1");
  const [saving, setSaving] = useState(false);

  const sessionKeys = useMemo<SessionKey[]>(() => {
    if (!event) return ["fp1", "quali", "race"];
    return event.format === "sprint"
      ? ["fp1", "sq", "sprint", "quali", "race"]
      : ["fp1", "fp2", "fp3", "quali", "race"];
  }, [event]);

  useEffect(() => {
    (async () => {
      setMsg(null);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.replace("/login");
      setUserId(userData.user.id);

      // membership check
      const { data: mem, error: memErr } = await supabase
        .from("pool_members")
        .select("pool_id")
        .eq("pool_id", poolId)
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (memErr) return setMsg(memErr.message);
      if (!mem) return setMsg("Je bent geen member van deze pool.");

      // load event
      const { data: ev, error: evErr } = await supabase
        .from("events")
        .select("id,name,format")
        .eq("id", eventId)
        .single();

      if (evErr) return setMsg(evErr.message);
      setEvent(ev as EventRow);

      // load existing prediction
      const { data: pred, error: predErr } = await supabase
        .from("predictions")
        .select("prediction_json")
        .eq("pool_id", poolId)
        .eq("event_id", eventId)
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (predErr) return setMsg(predErr.message);

      const base: PredictionDoc = {
        format: (ev as EventRow).format,
        sessions: {},
      };

      const loaded = (pred?.prediction_json ?? null) as any;
      const merged: PredictionDoc = loaded && typeof loaded === "object"
        ? {
            format: loaded.format ?? base.format,
            sessions: loaded.sessions ?? {},
          }
        : base;

      // ensure all sessions exist with top10 array
      for (const k of (ev as EventRow).format === "sprint"
        ? (["fp1", "sq", "sprint", "quali", "race"] as SessionKey[])
        : (["fp1", "fp2", "fp3", "quali", "race"] as SessionKey[])) {
        const t = merged.sessions?.[k]?.top10;
        if (!Array.isArray(t) || t.length !== 10) {
          merged.sessions[k] = { top10: emptyTop10() };
        }
      }

      setDoc(merged);
      setActiveSession((ev as EventRow).format === "sprint" ? "fp1" : "fp1");
    })();
  }, [eventId, poolId, router]);

  const top10 = useMemo(() => {
    if (!doc) return emptyTop10();
    return doc.sessions[activeSession]?.top10 ?? emptyTop10();
  }, [doc, activeSession]);

  function setPos(i: number, value: string) {
    const v = value.trim().toLowerCase(); // jouw afspraak: lowercase codes
    setDoc((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      next.sessions[activeSession] = next.sessions[activeSession] ?? { top10: emptyTop10() };
      next.sessions[activeSession]!.top10[i] = v;
      return next;
    });
  }

  async function saveAll() {
    setMsg(null);
    if (!doc) return;

    // basic validation: top10 must be 10 and non-empty
    for (const key of sessionKeys) {
      const arr = doc.sessions[key]?.top10 ?? [];
      if (arr.length !== 10) return setMsg(`Sessies '${key}' heeft niet precies 10 entries.`);
      if (arr.some((x) => !x || typeof x !== "string")) return setMsg(`Sessies '${key}' heeft lege posities.`);
      const set = new Set(arr);
      if (set.size !== arr.length) return setMsg(`Sessies '${key}' heeft dubbele driver codes.`);
    }

    setSaving(true);

    const payload = {
      user_id: userId,
      pool_id: poolId,
      event_id: eventId,
      prediction_json: doc,
    };

    const { error } = await supabase
      .from("predictions")
      .upsert(payload, { onConflict: "user_id,pool_id,event_id" });

    setSaving(false);

    if (error) return setMsg(error.message);
    setMsg("✅ Prediction opgeslagen.");
  }

  return (
    <main style={{ padding: 16, maxWidth: 900 }}>
      <button onClick={() => router.replace(`/pools/${poolId}`)}>← Terug naar pool</button>

      <h1 style={{ marginTop: 12 }}>
        {event ? event.name : "Event"} — voorspelling
      </h1>

      {msg && <p style={{ color: msg.startsWith("✅") ? "green" : "crimson" }}>{msg}</p>}

      {!doc ? (
        <p>Loading…</p>
      ) : (
        <>
          <div style={{ marginTop: 12 }}>
            <label>Session: </label>
            <select value={activeSession} onChange={(e) => setActiveSession(e.target.value as SessionKey)}>
              {sessionKeys.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>

          <h2 style={{ marginTop: 16 }}>Top 10 (positie 1 → 10)</h2>

          <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
            {top10.map((val, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ width: 28 }}><strong>{i + 1}</strong></div>
                <input
                  placeholder="ver"
                  value={val}
                  onChange={(e) => setPos(i, e.target.value)}
                  style={{ flex: 1 }}
                />
              </div>
            ))}
          </div>

          <button onClick={saveAll} disabled={saving} style={{ marginTop: 16 }}>
            {saving ? "Opslaan…" : "Opslaan (alle sessies)"}
          </button>

          <p style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
            Regels: 10 entries, geen lege velden, geen duplicates, lowercase codes (ver/ham/alo…).
          </p>
        </>
      )}
    </main>
  );
}
