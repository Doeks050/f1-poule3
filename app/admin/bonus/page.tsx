"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

/**
 * Admin Bonus Page (Weekend + Season)
 * - Admin vult officiële antwoorden in (maandag)
 * - Weekend: per event, 3 vragen (ja/nee)
 * - Season: 3 vragen bij join (ja/nee) — admin vult later ook official answers in
 *
 * NB: Jij wilde dat alles in de browser werkt. Dit is client-side supabase.
 */

type UUID = string;

type WeekendSetRow = {
  id: UUID;
  pool_id: UUID;
  event_id: UUID;
  set_id?: UUID | null;
  decided_by?: UUID | null;
  decided_at?: string | null;
};

type WeekendOfficialAnswerRow = {
  id: UUID;
  pool_id: UUID;
  event_id: UUID;
  set_id?: UUID | null;
  question_id: UUID;
  answer_json: boolean;
  decided_by?: UUID | null;
  decided_at?: string | null;
};

type BonusQuestionBankRow = {
  id: UUID;
  scope: "season" | "weekend";
  prompt: string;
  answer_kind: "boolean" | "text" | "number" | "driver" | "team";
  options?: any;
  is_active: boolean;
  question_key?: string | null;
};

type BonusQuestionsRow = {
  id: UUID;
  pool_id: UUID;
  scope: "season" | "weekend";
  question_id: UUID;
  order_index: number;
  created_at?: string;
};

type PoolSeasonBonusSetRow = {
  id: UUID;
  pool_id: UUID;
  set_id: UUID;
  decided_by?: UUID | null;
  decided_at?: string | null;
};

type PoolSeasonBonusSetQuestionRow = {
  id: UUID;
  pool_id: UUID;
  set_id: UUID;
  question_id: UUID;
  order_index: number;
};

type SeasonOfficialAnswerRow = {
  id: UUID;
  pool_id: UUID;
  set_id: UUID;
  question_id: UUID;
  answer_json: boolean;
  decided_by?: UUID | null;
  decided_at?: string | null;
};

type EventRow = {
  id: UUID;
  name: string;
  starts_at: string | null;
};

export default function AdminBonusPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClientComponentClient(), []);

  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Pools/events
  const [pools, setPools] = useState<{ id: UUID; name: string }[]>([]);
  const [selectedPoolId, setSelectedPoolId] = useState<UUID | "">("");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<UUID | "">("");

  // Weekend set (3 vragen)
  const [weekendQuestions, setWeekendQuestions] = useState<BonusQuestionBankRow[]>([]);
  const [weekendSet, setWeekendSet] = useState<WeekendSetRow | null>(null);
  const [weekendOfficialAnswers, setWeekendOfficialAnswers] = useState<Record<UUID, boolean | null>>({});
  const [weekendLoading, setWeekendLoading] = useState(false);
  const [weekendError, setWeekendError] = useState<string | null>(null);

  // Season set (3 vragen)
  const [seasonQuestions, setSeasonQuestions] = useState<BonusQuestionBankRow[]>([]);
  const [seasonSet, setSeasonSet] = useState<PoolSeasonBonusSetRow | null>(null);
  const [seasonOfficialAnswers, setSeasonOfficialAnswers] = useState<Record<UUID, boolean | null>>({});
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonError, setSeasonError] = useState<string | null>(null);

  async function requireAdmin() {
    const { data } = await supabase.auth.getUser();

    if (!data.user) {
      console.log("[ADMIN_BONUS] requireAdmin: no user -> /login");
      router.replace("/login");
      return null;
    }

    setUserEmail(data.user.email ?? null);

    // Primary (source of truth): app_admins table
    const adminRes = await supabase
      .from("app_admins")
      .select("user_id")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (adminRes.error) {
      console.log("[ADMIN_BONUS] requireAdmin: app_admins check error", {
        message: adminRes.error.message,
        details: (adminRes.error as any).details,
        hint: (adminRes.error as any).hint,
        code: (adminRes.error as any).code,
      });
    } else {
      console.log("[ADMIN_BONUS] requireAdmin: app_admins check ok", {
        isAdmin: !!adminRes.data,
        user_id: data.user.id,
      });
    }

    // Fallback: older setups used profiles.is_app_admin (keep compatibility)
    let isAdmin = !!adminRes.data;

    if (!isAdmin && adminRes.error) {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("is_app_admin")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (error) {
        console.log("[ADMIN_BONUS] requireAdmin: profiles fallback error", {
          message: error.message,
          details: (error as any).details,
          hint: (error as any).hint,
          code: (error as any).code,
        });
      } else {
        console.log("[ADMIN_BONUS] requireAdmin: profiles fallback ok", {
          is_app_admin: (profile as any)?.is_app_admin,
          user_id: data.user.id,
        });
      }

      isAdmin = !!(profile as any)?.is_app_admin;
    }

    if (!isAdmin) {
      console.log("[ADMIN_BONUS] requireAdmin: not admin -> /pools", {
        user_id: data.user.id,
      });
      router.replace("/pools");
      return null;
    }

    return data.user;
  }

  useEffect(() => {
    (async () => {
      const user = await requireAdmin();
      if (!user) return;

      console.log("[ADMIN_BONUS] init: loading pools");

      const { data: poolRows, error: poolErr } = await supabase
        .from("pools")
        .select("id,name")
        .order("created_at", { ascending: false });

      if (poolErr) {
        console.log("[ADMIN_BONUS] pools error", poolErr);
      }

      setPools(poolRows ?? []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      if (!selectedPoolId) return;

      console.log("[ADMIN_BONUS] pool selected", { pool_id: selectedPoolId });

      // Load events for pool
      const { data: eventRows, error: eventErr } = await supabase
        .from("events")
        .select("id,name,starts_at")
        .eq("pool_id", selectedPoolId as string)
        .order("starts_at", { ascending: true });

      if (eventErr) {
        console.log("[ADMIN_BONUS] events error", eventErr);
      }

      setEvents((eventRows as any) ?? []);
      setSelectedEventId("");
      setWeekendSet(null);
      setWeekendQuestions([]);
      setWeekendOfficialAnswers({});
      setSeasonSet(null);
      setSeasonQuestions([]);
      setSeasonOfficialAnswers({});
    })();
  }, [selectedPoolId, supabase]);

  // -------------------------
  // WEEKEND: load set + questions + existing official answers
  // -------------------------
  useEffect(() => {
    (async () => {
      if (!selectedPoolId || !selectedEventId) return;

      setWeekendLoading(true);
      setWeekendError(null);

      console.log("[ADMIN_BONUS] load weekend admin", {
        pool_id: selectedPoolId,
        event_id: selectedEventId,
      });

      // 1) Find weekend set for this pool+event
      const { data: setRow, error: setErr } = await supabase
        .from("bonus_weekend_sets")
        .select("id,pool_id,event_id,set_id,decided_by,decided_at")
        .eq("pool_id", selectedPoolId as string)
        .eq("event_id", selectedEventId as string)
        .maybeSingle();

      if (setErr) {
        console.log("[ADMIN_BONUS] weekend set error", setErr);
        setWeekendError(setErr.message);
        setWeekendLoading(false);
        return;
      }

      setWeekendSet((setRow as any) ?? null);

      // 2) Load questions for weekend set
      // Your schema has v2 tables: weekend_bonus_questions_v2 (question bank) and linkage via bonus_questions perhaps.
      // This file uses bonus_question_bank + bonus_questions.
      // We keep your existing logic as-is.
      const { data: linkRows, error: linkErr } = await supabase
        .from("bonus_questions")
        .select("id,pool_id,scope,question_id,order_index")
        .eq("pool_id", selectedPoolId as string)
        .eq("scope", "weekend")
        .order("order_index", { ascending: true });

      if (linkErr) {
        console.log("[ADMIN_BONUS] weekend link error", linkErr);
        setWeekendError(linkErr.message);
        setWeekendLoading(false);
        return;
      }

      const questionIds = (linkRows ?? []).map((r: any) => r.question_id).filter(Boolean);

      if (!questionIds.length) {
        console.log("[ADMIN_BONUS] weekend: no questions linked");
        setWeekendQuestions([]);
      } else {
        const { data: qRows, error: qErr } = await supabase
          .from("bonus_question_bank")
          .select("id,scope,prompt,answer_kind,options,is_active,question_key")
          .in("id", questionIds)
          .eq("scope", "weekend")
          .order("created_at", { ascending: true });

        if (qErr) {
          console.log("[ADMIN_BONUS] weekend questions error", qErr);
          setWeekendError(qErr.message);
          setWeekendLoading(false);
          return;
        }

        // Preserve link order
        const byId = new Map<string, any>((qRows ?? []).map((q: any) => [q.id, q]));
        const ordered = questionIds.map((id: string) => byId.get(id)).filter(Boolean);

        setWeekendQuestions(ordered);
      }

      // 3) Load existing official answers (admin)
      const { data: aRows, error: aErr } = await supabase
        .from("weekend_bonus_official_answers")
        .select("id,pool_id,event_id,question_id,answer_json,decided_by,decided_at,set_id")
        .eq("pool_id", selectedPoolId as string)
        .eq("event_id", selectedEventId as string);

      if (aErr) {
        console.log("[ADMIN_BONUS] weekend official answers error", aErr);
        setWeekendError(aErr.message);
        setWeekendLoading(false);
        return;
      }

      const map: Record<string, boolean | null> = {};
      for (const row of aRows ?? []) {
        map[(row as any).question_id] = (row as any).answer_json ?? null;
      }
      setWeekendOfficialAnswers(map);

      setWeekendLoading(false);
    })();
  }, [selectedPoolId, selectedEventId, supabase]);

  // -------------------------
  // SEASON: load set + questions + existing official answers
  // -------------------------
  useEffect(() => {
    (async () => {
      if (!selectedPoolId) return;

      setSeasonLoading(true);
      setSeasonError(null);

      console.log("[ADMIN_BONUS] load season admin", {
        pool_id: selectedPoolId,
      });

      // 1) Find season set for this pool
      const { data: sSet, error: sSetErr } = await supabase
        .from("pool_season_bonus_sets")
        .select("id,pool_id,set_id,decided_by,decided_at")
        .eq("pool_id", selectedPoolId as string)
        .maybeSingle();

      if (sSetErr) {
        console.log("[ADMIN_BONUS] season set error", sSetErr);
        setSeasonError(sSetErr.message);
        setSeasonLoading(false);
        return;
      }

      setSeasonSet((sSet as any) ?? null);

      // 2) Load season questions
      const { data: sLink, error: sLinkErr } = await supabase
        .from("pool_season_bonus_set_questions")
        .select("id,pool_id,set_id,question_id,order_index")
        .eq("pool_id", selectedPoolId as string)
        .order("order_index", { ascending: true });

      if (sLinkErr) {
        console.log("[ADMIN_BONUS] season link error", sLinkErr);
        setSeasonError(sLinkErr.message);
        setSeasonLoading(false);
        return;
      }

      const sQuestionIds = (sLink ?? []).map((r: any) => r.question_id).filter(Boolean);

      if (!sQuestionIds.length) {
        console.log("[ADMIN_BONUS] season: no questions linked");
        setSeasonQuestions([]);
      } else {
        const { data: sQRows, error: sQErr } = await supabase
          .from("bonus_question_bank")
          .select("id,scope,prompt,answer_kind,options,is_active,question_key")
          .in("id", sQuestionIds)
          .eq("scope", "season")
          .order("created_at", { ascending: true });

        if (sQErr) {
          console.log("[ADMIN_BONUS] season questions error", sQErr);
          setSeasonError(sQErr.message);
          setSeasonLoading(false);
          return;
        }

        const byId = new Map<string, any>((sQRows ?? []).map((q: any) => [q.id, q]));
        const ordered = sQuestionIds.map((id: string) => byId.get(id)).filter(Boolean);

        setSeasonQuestions(ordered);
      }

      // 3) Load existing season official answers
      const { data: sAns, error: sAnsErr } = await supabase
        .from("season_bonus_answers")
        .select("id,pool_id,set_id,question_id,answer_json,decided_by,decided_at")
        .eq("pool_id", selectedPoolId as string);

      if (sAnsErr) {
        console.log("[ADMIN_BONUS] season official answers error", sAnsErr);
        setSeasonError(sAnsErr.message);
        setSeasonLoading(false);
        return;
      }

      const map: Record<string, boolean | null> = {};
      for (const row of sAns ?? []) {
        map[(row as any).question_id] = (row as any).answer_json ?? null;
      }
      setSeasonOfficialAnswers(map);

      setSeasonLoading(false);
    })();
  }, [selectedPoolId, supabase]);

  async function saveWeekendOfficialAnswer(questionId: UUID, answer: boolean) {
    if (!selectedPoolId || !selectedEventId) return;

    setWeekendError(null);

    console.log("[ADMIN_BONUS] save weekend official answer", {
      pool_id: selectedPoolId,
      event_id: selectedEventId,
      question_id: questionId,
      answer,
    });

    const { data: userData } = await supabase.auth.getUser();
    const decidedBy = userData.user?.id ?? null;

    const payload = {
      pool_id: selectedPoolId as string,
      event_id: selectedEventId as string,
      question_id: questionId,
      answer_json: answer,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
      set_id: weekendSet?.set_id ?? null,
    };

    const { error } = await supabase
      .from("weekend_bonus_official_answers")
      .upsert(payload, {
        onConflict: "pool_id,event_id,question_id",
      });

    if (error) {
      console.log("[ADMIN_BONUS] save weekend official answer error", error);
      setWeekendError(error.message);
      return;
    }

    setWeekendOfficialAnswers((prev) => ({ ...prev, [questionId]: answer }));
  }

  async function saveSeasonOfficialAnswer(questionId: UUID, answer: boolean) {
    if (!selectedPoolId) return;

    setSeasonError(null);

    console.log("[ADMIN_BONUS] save season official answer", {
      pool_id: selectedPoolId,
      question_id: questionId,
      answer,
    });

    const { data: userData } = await supabase.auth.getUser();
    const decidedBy = userData.user?.id ?? null;

    const payload = {
      pool_id: selectedPoolId as string,
      set_id: seasonSet?.set_id ?? null,
      question_id: questionId,
      answer_json: answer,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("season_bonus_answers").upsert(payload, {
      onConflict: "pool_id,question_id",
    });

    if (error) {
      console.log("[ADMIN_BONUS] save season official answer error", error);
      setSeasonError(error.message);
      return;
    }

    setSeasonOfficialAnswers((prev) => ({ ...prev, [questionId]: answer }));
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <h1>Admin Bonus</h1>
      <div style={{ opacity: 0.7, marginBottom: 12 }}>Ingelogd als: {userEmail ?? "-"}</div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <button onClick={() => router.push("/admin/results")}>Terug naar Admin Results</button>
        <button onClick={() => router.push("/pools")}>Terug naar Pools</button>
        <button onClick={logout}>Logout</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <h2>Pool</h2>
          <select
            value={selectedPoolId}
            onChange={(e) => setSelectedPoolId(e.target.value as any)}
            style={{ width: "100%", padding: 8 }}
          >
            <option value="">— Kies pool —</option>
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <h2 style={{ marginTop: 16 }}>Event (weekend)</h2>
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value as any)}
            style={{ width: "100%", padding: 8 }}
            disabled={!selectedPoolId}
          >
            <option value="">— Kies event —</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} {ev.starts_at ? `(${new Date(ev.starts_at).toLocaleString()})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <h2>Weekend bonus (official answers)</h2>
          {weekendLoading && <div>Loading weekend…</div>}
          {weekendError && <div style={{ color: "crimson" }}>{weekendError}</div>}

          {!weekendLoading && !weekendError && selectedPoolId && selectedEventId && (
            <>
              {weekendQuestions.length === 0 && <div>Geen weekend vragen gevonden.</div>}
              {weekendQuestions.map((q, idx) => (
                <div
                  key={q.id}
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 10,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {idx + 1}. {q.prompt}
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="radio"
                        name={`wq-${q.id}`}
                        checked={weekendOfficialAnswers[q.id] === true}
                        onChange={() => saveWeekendOfficialAnswer(q.id, true)}
                      />
                      Ja
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="radio"
                        name={`wq-${q.id}`}
                        checked={weekendOfficialAnswers[q.id] === false}
                        onChange={() => saveWeekendOfficialAnswer(q.id, false)}
                      />
                      Nee
                    </label>
                    <span style={{ opacity: 0.6 }}>
                      status: {weekendOfficialAnswers[q.id] === null || weekendOfficialAnswers[q.id] === undefined ? "open" : "ingevuld"}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}

          <h2 style={{ marginTop: 24 }}>Season bonus (official answers)</h2>
          {seasonLoading && <div>Loading season…</div>}
          {seasonError && <div style={{ color: "crimson" }}>{seasonError}</div>}

          {!seasonLoading && !seasonError && selectedPoolId && (
            <>
              {seasonQuestions.length === 0 && <div>Geen season vragen gevonden.</div>}
              {seasonQuestions.map((q, idx) => (
                <div
                  key={q.id}
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 10,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {idx + 1}. {q.prompt}
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="radio"
                        name={`sq-${q.id}`}
                        checked={seasonOfficialAnswers[q.id] === true}
                        onChange={() => saveSeasonOfficialAnswer(q.id, true)}
                      />
                      Ja
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="radio"
                        name={`sq-${q.id}`}
                        checked={seasonOfficialAnswers[q.id] === false}
                        onChange={() => saveSeasonOfficialAnswer(q.id, false)}
                      />
                      Nee
                    </label>
                    <span style={{ opacity: 0.6 }}>
                      status: {seasonOfficialAnswers[q.id] === null || seasonOfficialAnswers[q.id] === undefined ? "open" : "ingevuld"}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
