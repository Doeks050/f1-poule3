"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

type PoolRow = { id: string; name: string };
type EventRow = { id: string; name: string; starts_at: string | null; weekend_type?: string | null };

type BonusQuestion = {
  id: string;
  scope: "season" | "weekend";
  prompt: string;
  answer_kind: string; // "boolean" | "number" | "text" | "choice" | "driver" | "team" | ...
  options: any | null; // jsonb (voor choice/driver/team lists etc.)
  is_active: boolean;
};

export default function AdminBonusPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [pools, setPools] = useState<PoolRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);

  const [seasonQuestions, setSeasonQuestions] = useState<BonusQuestion[]>([]);
  const [weekendQuestions, setWeekendQuestions] = useState<BonusQuestion[]>([]);

  const [selectedPoolId, setSelectedPoolId] = useState<string>("");
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  // season answers state (key: question_id => value)
  const [seasonAnswers, setSeasonAnswers] = useState<Record<string, any>>({});
  // weekend answers state (key: question_id => value)
  const [weekendAnswers, setWeekendAnswers] = useState<Record<string, any>>({});

  // optional cached info about weekend set
  const [weekendSetInfo, setWeekendSetInfo] = useState<{
    setId: string | null;
    questionIds: string[];
  } | null>(null);

  const seasonYear = 2026;

  const selectedPool = useMemo(
    () => pools.find((p) => p.id === selectedPoolId) ?? null,
    [pools, selectedPoolId]
  );

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  // ---- auth/admin guard ----

  async function requireAdmin() {
    const { data } = await supabase.auth.getUser();

    if (!data.user) {
      router.replace("/login");
      return null;
    }

    setUserEmail(data.user.email ?? null);

    // BELANGRIJK: jouw console gaf 400 bij `profiles?...&id=eq...`
    // Dat wijst er meestal op dat `profiles.id` niet bestaat, maar `profiles.user_id` wel.
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("is_app_admin")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (error || !profile?.is_app_admin) {
      router.replace("/pools");
      return null;
    }

    return data.user;
  }

  // ---- data loaders ----

  async function loadPools() {
    const { data, error } = await supabase.from("pools").select("id,name").order("name");
    if (error) throw error;
    setPools((data ?? []) as PoolRow[]);
  }

  async function loadEvents() {
    const { data, error } = await supabase
      .from("events")
      .select("id,name,starts_at,weekend_type")
      .order("starts_at", { ascending: true });

    if (error) throw error;
    setEvents((data ?? []) as EventRow[]);
  }

  async function loadQuestions() {
    // bonus_question_bank schema (volgens jouw screenshots):
    // id, scope(text: 'season'|'weekend'), prompt, answer_kind(text), options(jsonb), is_active(bool)
    const { data, error } = await supabase
      .from("bonus_question_bank")
      .select("id,scope,prompt,answer_kind,options,is_active")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const all = (data ?? []) as any[];

    const normalized: BonusQuestion[] = all.map((r) => ({
      id: String(r.id),
      scope: (r.scope === "season" ? "season" : "weekend") as "season" | "weekend",
      prompt: String(r.prompt ?? ""),
      answer_kind: String(r.answer_kind ?? "text"),
      options: (r.options ?? null) as any,
      is_active: Boolean(r.is_active),
    }));

    setSeasonQuestions(normalized.filter((q) => q.scope === "season"));
    setWeekendQuestions(normalized.filter((q) => q.scope === "weekend"));
  }

  async function loadSeasonOfficialAnswers() {
    // season_official_answers: season, question_id, answer_json
    const { data, error } = await supabase
      .from("season_official_answers")
      .select("question_id,answer_json")
      .eq("season", seasonYear);

    if (error) throw error;

    const next: Record<string, any> = {};
    for (const row of data ?? []) {
      // support either {value: X} or raw
      const aj: any = (row as any).answer_json;
      next[(row as any).question_id] = aj?.value ?? aj ?? null;
    }
    setSeasonAnswers(next);
  }

  async function loadWeekendSetQuestionIds(poolId: string, eventId: string) {
    // bonus_weekend_sets: pool_id, event_id, question_ids (uuid[])
    const { data, error } = await supabase
      .from("bonus_weekend_sets")
      .select("id,question_ids")
      .eq("pool_id", poolId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (error) throw error;

    const setId = data?.id ?? null;
    const questionIds = (data?.question_ids ?? []) as string[];

    setWeekendSetInfo({ setId, questionIds });

    return { setId, questionIds };
  }

  async function loadWeekendOfficialAnswersBySet(setId: string) {
    // weekend_bonus_official_answers: pool_id, event_id, set_id, question_id, answer_json
    const { data, error } = await supabase
      .from("weekend_bonus_official_answers")
      .select("question_id,answer_json")
      .eq("set_id", setId);

    if (error) throw error;

    const next: Record<string, any> = {};
    for (const row of data ?? []) {
      const aj: any = (row as any).answer_json;
      next[(row as any).question_id] = aj?.value ?? aj ?? null;
    }
    return next;
  }

  // ---- initial load ----

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      try {
        const u = await requireAdmin();
        if (!u) return;

        await Promise.all([loadPools(), loadEvents(), loadQuestions()]);
        await loadSeasonOfficialAnswers();
      } catch (e: any) {
        setMsg(e?.message ?? "Load error");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load weekend answers when pool+event changes
  useEffect(() => {
    (async () => {
      setMsg(null);
      if (!selectedPoolId || !selectedEventId) {
        setWeekendAnswers({});
        return;
      }

      try {
        const { setId } = await loadWeekendSetQuestionIds(selectedPoolId, selectedEventId);
        if (!setId) {
          setWeekendAnswers({});
          return;
        }

        const wa = await loadWeekendOfficialAnswersBySet(setId);
        setWeekendAnswers(wa);
      } catch (e: any) {
        setMsg(e?.message ?? "Load weekend answers error");
      }
    })();
  }, [selectedPoolId, selectedEventId]);

  // ---- save handlers ----

  async function saveSeasonAll() {
    setMsg(null);

    try {
      const rows = seasonQuestions.map((q) => ({
        season: seasonYear,
        question_id: q.id,
        // Store { value: ... } so the client can compare consistently
        answer_json: { value: seasonAnswers[q.id] ?? null },
      }));

      const { error } = await supabase
        .from("season_official_answers")
        .upsert(rows, { onConflict: "season,question_id" });

      if (error) throw error;

      setMsg("✅ Season bonus official answers saved.");
    } catch (e: any) {
      setMsg(e?.message ?? "Save season error");
    }
  }

  async function saveWeekendAll() {
    setMsg(null);

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) {
      setMsg("Not logged in.");
      return;
    }

    try {
      if (!selectedPoolId || !selectedEventId) {
        setMsg("Select pool and event first.");
        return;
      }

      const { setId, questionIds } = await loadWeekendSetQuestionIds(selectedPoolId, selectedEventId);

      if (!setId) {
        setMsg("No set_id for this pool/event. Generate a set first.");
        return;
      }
      if (!questionIds.length) {
        setMsg("No questions in this set.");
        return;
      }

      // Save ONLY for the 3 questions in the set
      const rows = questionIds.map((qid) => ({
        pool_id: selectedPoolId,
        event_id: selectedEventId,
        set_id: setId,
        question_id: qid,
        answer_json: { value: weekendAnswers[qid] ?? null },
        decided_by: user.id,
      }));

      // IMPORTANT: onConflict must match an existing UNIQUE constraint.
      // In your DB you have UNIQUE(pool_id, event_id, question_id).
      const { error } = await supabase
        .from("weekend_bonus_official_answers")
        .upsert(rows, { onConflict: "pool_id,event_id,question_id" });

      if (error) throw error;

      setMsg("✅ Weekend bonus official answers saved.");
    } catch (e: any) {
      setMsg(e?.message ?? "Save weekend error");
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  // ---- render helpers ----

  function renderInput(q: BonusQuestion, value: any, onChange: (v: any) => void) {
    const kind = (q.answer_kind ?? "text").toLowerCase();

    if (kind === "boolean") {
      return (
        <select
          value={value === true ? "true" : value === false ? "false" : ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "true" ? true : v === "false" ? false : null);
          }}
        >
          <option value="">(unset)</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    }

    if (kind === "number") {
      return (
        <input
          type="number"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );
    }

    // choices can be stored as:
    // - options: ["A","B"]
    // - options: { choices: [...] }
    // - options: { items: [...] } (drivers/teams later)
    const raw = q.options as any;
    const choices: string[] = Array.isArray(raw)
      ? raw.map(String)
      : Array.isArray(raw?.choices)
      ? raw.choices.map(String)
      : Array.isArray(raw?.items)
      ? raw.items.map(String)
      : [];

    if (kind === "choice" || (choices.length > 0 && kind !== "text" && kind !== "driver" && kind !== "team")) {
      return (
        <select value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}>
          <option value="">(unset)</option>
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      );
    }

    // For now: driver/team/text => free text input.
    return (
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      />
    );
  }

  // ---- UI ----

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Logged in as: {userEmail ?? "-"}</div>

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={() => router.push("/admin/results")}>Back to Results</button>
            <button onClick={logout}>Logout</button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={saveSeasonAll} style={{ padding: "8px 12px" }}>
            Save season answers
          </button>
          <button
            onClick={saveWeekendAll}
            style={{ padding: "8px 12px" }}
            disabled={!selectedPoolId || !selectedEventId}
          >
            Save weekend answers
          </button>
        </div>
      </div>

      <h1 style={{ marginTop: 18 }}>Weekend bonus official answers</h1>

      {msg && (
        <div style={{ margin: "12px 0", color: msg.startsWith("✅") ? "green" : "crimson" }}>
          {msg}
        </div>
      )}

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
          <div>Pool:</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value={selectedPoolId}
              onChange={(e) => setSelectedPoolId(e.target.value)}
              style={{ width: "100%", padding: 8 }}
            >
              <option value="">Select pool</option>
              {pools.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {selectedPool && <span style={{ fontSize: 12, opacity: 0.7 }}>({selectedPool.id})</span>}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
          <div>Event:</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              style={{ width: "100%", padding: 8 }}
            >
              <option value="">Select event</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} {ev.starts_at ? `(${ev.starts_at})` : ""}
                </option>
              ))}
            </select>
            {selectedEvent && <span style={{ fontSize: 12, opacity: 0.7 }}>({selectedEvent.id})</span>}
          </div>
        </div>
      </div>

      {weekendSetInfo && (
        <div style={{ marginTop: 16, opacity: 0.8, fontSize: 13 }}>
          Selected: <b>{selectedEvent?.name ?? "-"}</b> • {selectedEvent?.weekend_type ?? "-"}
        </div>
      )}

      <div style={{ marginTop: 20, display: "grid", gap: 14 }}>
        {weekendQuestions.map((q) => {
          const v = weekendAnswers[q.id] ?? null;

          return (
            <div
              key={q.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700 }}>{q.prompt}</div>
              <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>
                kind: {q.answer_kind} • id: {q.id}
              </div>

              <div style={{ marginTop: 10 }}>
                {renderInput(q, v, (nv) => setWeekendAnswers((prev) => ({ ...prev, [q.id]: nv })))}
              </div>
            </div>
          );
        })}
      </div>

      <hr style={{ margin: "28px 0" }} />

      <h2>Season bonus official answers</h2>

      <div style={{ marginTop: 20, display: "grid", gap: 14 }}>
        {seasonQuestions.map((q) => {
          const v = seasonAnswers[q.id] ?? null;

          return (
            <div
              key={q.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700 }}>{q.prompt}</div>
              <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>
                kind: {q.answer_kind} • id: {q.id}
              </div>

              <div style={{ marginTop: 10 }}>
                {renderInput(q, v, (nv) => setSeasonAnswers((prev) => ({ ...prev, [q.id]: nv })))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
