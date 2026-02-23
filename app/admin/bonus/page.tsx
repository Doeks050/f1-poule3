"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

type PoolRow = { id: string; name: string };
type EventRow = { id: string; name: string; starts_at: string | null; weekend_type?: string | null };

type BonusQuestion = {
  id: string;
  question: string;
  kind: "boolean" | "number" | "text" | "choice";
  choices?: string[] | null;
  points: number;
  active: boolean;
  scope: "season" | "weekend";
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

  const seasonYear = 2026;

  // selections
  const [selectedPoolId, setSelectedPoolId] = useState<string>("");
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  // answers state
  const [seasonAnswers, setSeasonAnswers] = useState<Record<string, any>>({});
  const [weekendAnswers, setWeekendAnswers] = useState<Record<string, any>>({});

  const selectedPool = useMemo(
    () => pools.find((p) => p.id === selectedPoolId) ?? null,
    [pools, selectedPoolId]
  );
  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  // NOTE: hooks must run before any conditional return (fix React error #310)
  const weekendSetInfo = useMemo(() => {
    if (!selectedPoolId || !selectedEventId) return null;
    return { poolId: selectedPoolId, eventId: selectedEventId };
  }, [selectedPoolId, selectedEventId]);

  // ---- data loaders ----

  async function requireAdmin() {
    const { data } = await supabase.auth.getUser();

    if (!data.user) {
      router.replace("/login");
      return null;
    }

    setUserEmail(data.user.email ?? null);

    // ✅ Admin check via app_admins (niet via profiles)
    const { data: adminRow, error: adminErr } = await supabase
      .from("app_admins")
      .select("user_id")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (adminErr || !adminRow) {
      router.replace("/pools");
      return null;
    }

    return data.user;
  }

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
  const { data, error } = await supabase
    .from("bonus_question_bank")
    .select("*"); // haal alles op, we normalizen client-side

  if (error) throw error;

  // Normalize zodat we niet kapot gaan op null/andere kolomnamen
  const allRaw = (data ?? []) as any[];

  const all: BonusQuestion[] = allRaw.map((r) => {
    const active =
      typeof r.active === "boolean"
        ? r.active
        : typeof r.is_active === "boolean"
        ? r.is_active
        : true; // default true als kolom ontbreekt

    const scope =
      (r.scope as "season" | "weekend" | undefined) ??
      (r.question_scope as "season" | "weekend" | undefined) ??
      "weekend"; // default weekend als null/ontbreekt

    const kind =
      (r.kind as BonusQuestion["kind"] | undefined) ??
      (r.type as BonusQuestion["kind"] | undefined) ??
      "text";

    return {
      id: String(r.id),
      question: String(r.question ?? r.title ?? ""),
      kind,
      choices: (r.choices ?? r.options ?? null) as string[] | null,
      points: Number(r.points ?? 0),
      active,
      scope,
    };
  });

  const activeOnly = all.filter((q) => q.active);

  setSeasonQuestions(activeOnly.filter((q) => q.scope === "season"));
  setWeekendQuestions(activeOnly.filter((q) => q.scope !== "season")); // alles wat niet season is -> weekend
}

  async function loadSeasonOfficialAnswers() {
    const { data, error } = await supabase
      .from("season_official_answers")
      .select("question_id,answer_json")
      .eq("season", seasonYear);

    if (error) throw error;

    const map: Record<string, any> = {};
    for (const row of data ?? []) {
      map[row.question_id] = row.answer_json?.value ?? null;
    }
    setSeasonAnswers(map);
  }

  async function loadWeekendSetQuestionIds(poolId: string, eventId: string) {
    // Set id (one set per pool+event)
    const { data: setRow, error: setErr } = await supabase
      .from("pool_event_bonus_sets")
      .select("id")
      .eq("pool_id", poolId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (setErr) throw setErr;
    if (!setRow?.id) return { setId: null as string | null, questionIds: [] as string[] };

    const setId = setRow.id as string;

    // Which questions are in the set
    const { data: qRows, error: qErr } = await supabase
      .from("pool_event_bonus_set_questions")
      .select("question_id")
      .eq("set_id", setId);

    if (qErr) throw qErr;

    const questionIds = (qRows ?? []).map((r: any) => r.question_id as string);
    return { setId, questionIds };
  }

  async function loadWeekendOfficialAnswersBySet(setId: string) {
    const { data, error } = await supabase
      .from("weekend_bonus_official_answers")
      .select("question_id,answer_json")
      .eq("set_id", setId);

    if (error) throw error;

    const map: Record<string, any> = {};
    for (const row of data ?? []) {
      map[row.question_id] = row.answer_json?.value ?? null;
    }
    return map;
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

      const { setId, questionIds } = await loadWeekendSetQuestionIds(
        selectedPoolId,
        selectedEventId
      );

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
    if (q.kind === "boolean") {
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

    if (q.kind === "number") {
      return (
        <input
          type="number"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );
    }

    if (q.kind === "choice") {
      const choices = q.choices ?? [];
      return (
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        >
          <option value="">(unset)</option>
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      );
    }

    // text
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
            {selectedPool && (
              <span style={{ fontSize: 12, opacity: 0.7 }}>({selectedPool.id})</span>
            )}
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
            {selectedEvent && (
              <span style={{ fontSize: 12, opacity: 0.7 }}>({selectedEvent.id})</span>
            )}
          </div>
        </div>
      </div>

      {weekendSetInfo && (
        <div style={{ marginTop: 16, opacity: 0.8, fontSize: 13 }}>
          Selected: <b>{selectedEvent?.name ?? "-"}</b> • {selectedEvent?.weekend_type ?? "-"}
        </div>
      )}

      <div style={{ marginTop: 20, display: "grid", gap: 14 }}>
        {weekendQuestions
          .filter((q) => true)
          .map((q) => {
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
                <div style={{ fontSize: 18, fontWeight: 700 }}>{q.question}</div>
                <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>
                  kind: {q.kind} • id: {q.id}
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
              <div style={{ fontSize: 18, fontWeight: 700 }}>{q.question}</div>
              <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>
                kind: {q.kind} • id: {q.id}
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
