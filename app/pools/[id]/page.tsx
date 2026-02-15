"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import LeaderboardPanel from "./LeaderboardPanel";

type PoolRow = {
  id: string;
  name: string;
  invite_code?: string;
  created_at?: string;
};

type EventRow = {
  id: string;
  name: string;
  starts_at: string | null;
  format: "standard" | "sprint" | string | null;
};

type NextSessionRow = {
  id: string;
  event_id: string;
  session_key: string;
  name: string;
  starts_at: string;
  lock_at: string;
  events?: {
    id: string;
    name: string;
    format: "standard" | "sprint" | string | null;
    starts_at: string | null;
  } | null;
};

function msToParts(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return { days, hours, mins, secs };
}

function fmtCountdown(ms: number) {
  const { days, hours, mins, secs } = msToParts(ms);
  const hh = String(hours).padStart(2, "0");
  const mm = String(mins).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

function fmtLocal(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("nl-NL", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLabel(format: string | null) {
  if (format === "sprint") return "Sprint weekend";
  if (format === "standard") return "Standaard weekend";
  return "Weekend";
}

export default function PoolDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const poolId = (params?.id ?? "") as string;

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [pool, setPool] = useState<PoolRow | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [nextSession, setNextSession] = useState<NextSessionRow | null>(null);

  // owner / role
  const [myRole, setMyRole] = useState<string | null>(null);
  const isOwner = myRole === "owner";

  // reset invite loading
  const [resettingInvite, setResettingInvite] = useState(false);

  // rename state
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState("");

  // delete state
  const [deleting, setDeleting] = useState(false);

  // live clock for countdown
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const isUuid = useMemo(() => {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      poolId,
    );
  }, [poolId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      // auth check
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace("/login");
        return;
      }

      const user = userData.user;

      if (!poolId || !isUuid) {
        setMsg(`Pool id ontbreekt of is ongeldig: "${poolId || "leeg"}"`);
        setLoading(false);
        return;
      }

      // 🔒 Controleer membership + pak ook role
      const { data: membership, error: memErr } = await supabase
        .from("pool_members")
        .select("pool_id,user_id,role")
        .eq("pool_id", poolId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (memErr) {
        setMsg(memErr.message);
        setLoading(false);
        return;
      }

      if (!membership) {
        router.replace("/pools");
        return;
      }

      setMyRole((membership as any)?.role ?? "member");

      // ✅ Pool ophalen
      const { data: poolRow, error: poolErr } = await supabase
        .from("pools")
        .select("id,name,invite_code,created_at")
        .eq("id", poolId)
        .maybeSingle();

      if (poolErr) {
        setMsg(poolErr.message);
        setLoading(false);
        return;
      }

      if (!poolRow) {
        setMsg("Pool niet gevonden.");
        setLoading(false);
        return;
      }

      setPool(poolRow as PoolRow);
      setNameInput(String((poolRow as any)?.name ?? ""));

      // ✅ Events ophalen (globaal)
      const { data: evRows, error: evErr } = await supabase
        .from("events")
        .select("id,name,starts_at,format")
        .order("starts_at", { ascending: true });

      if (evErr) {
        setMsg(evErr.message);
        setEvents([]);
        setLoading(false);
        return;
      }

      setEvents((evRows ?? []) as EventRow[]);

      // ✅ Hero: eerstvolgende open sessie (lock_at in de toekomst)
      const { data: ns, error: nsErr } = await supabase
        .from("event_sessions")
        .select(
          "id,event_id,session_key,name,starts_at,lock_at,events(id,name,format,starts_at)",
        )
        .gt("lock_at", new Date().toISOString())
        .order("lock_at", { ascending: true })
        .limit(1);

      if (nsErr) {
        setNextSession(null);
      } else {
        const row = (ns && ns.length > 0 ? (ns[0] as any) : null) as NextSessionRow | null;
        setNextSession(row);
      }

      setLoading(false);
    })();
  }, [router, poolId, isUuid]);

  // highlight event: event van de nextSession (bron van waarheid)
  const nextEventId = useMemo(() => {
    if (nextSession?.event_id) return nextSession.event_id;
    const t = Date.now();
    const upcoming = events.find(
      (e) => (e.starts_at ? new Date(e.starts_at).getTime() : 0) > t,
    );
    return upcoming?.id ?? null;
  }, [nextSession?.event_id, events]);

  const hero = useMemo(() => {
    if (!nextSession) return null;

    const lockMs = new Date(nextSession.lock_at).getTime();
    const lockInMs = lockMs - now;

    const eventName = nextSession.events?.name ?? "Volgend event";
    const format = nextSession.events?.format ?? null;

    const href = `/pools/${poolId}/sessions/${nextSession.id}?eventId=${nextSession.event_id}`;

    return {
      eventName,
      formatLabel: formatLabel(format),
      sessionTitle: `${nextSession.name} (${nextSession.session_key})`,
      lockAtLocal: fmtLocal(nextSession.lock_at),
      lockIn: fmtCountdown(lockInMs),
      href,
    };
  }, [nextSession, now, poolId]);

  const inviteLink = useMemo(() => {
    if (!pool?.invite_code) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/join?code=${pool.invite_code}`;
  }, [pool?.invite_code]);

  async function copyInvite() {
    try {
      if (!inviteLink) return;
      await navigator.clipboard.writeText(inviteLink);
      setMsg("✅ Invite link gekopieerd.");
      setTimeout(() => setMsg(null), 1500);
    } catch {
      setMsg("Kon niet kopiëren. Kopieer handmatig.");
    }
  }

  async function resetInviteCode() {
    setMsg(null);

    if (!poolId || !isUuid) {
      setMsg("Ongeldige pool id.");
      return;
    }
    if (!isOwner) {
      setMsg("Alleen de owner kan de invite code resetten.");
      return;
    }

    setResettingInvite(true);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setResettingInvite(false);
      router.replace("/login");
      return;
    }

    const res = await fetch(`/api/pools/${poolId}/reset-invite`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
    });

    const raw = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(raw);
    } catch {}

    if (!res.ok) {
      setResettingInvite(false);
      setMsg(`Reset mislukt (status ${res.status}). ${json?.error ?? raw}`.trim());
      return;
    }

    const newCode = String(json?.inviteCode ?? "").trim();
    if (!newCode) {
      setResettingInvite(false);
      setMsg("Reset gelukt maar geen inviteCode teruggekregen.");
      return;
    }

    setPool((prev) => (prev ? { ...prev, invite_code: newCode } : prev));
    setMsg("✅ Invite code gereset.");
    setTimeout(() => setMsg(null), 1500);

    setResettingInvite(false);
  }

  async function renamePool() {
    setMsg(null);

    if (!poolId || !isUuid) {
      setMsg("Ongeldige pool id.");
      return;
    }
    if (!isOwner) {
      setMsg("Alleen de owner kan de pool hernoemen.");
      return;
    }

    const newName = String(nameInput ?? "").trim();
    if (newName.length < 2) {
      setMsg("Pool naam moet minimaal 2 tekens zijn.");
      return;
    }

    setRenaming(true);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setRenaming(false);
      router.replace("/login");
      return;
    }

    const res = await fetch(`/api/pools/${poolId}/rename`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: newName }),
    });

    const raw = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(raw);
    } catch {}

    if (!res.ok) {
      setRenaming(false);
      setMsg(`Hernoemen mislukt (status ${res.status}). ${json?.error ?? raw}`.trim());
      return;
    }

    setPool((prev) => (prev ? { ...prev, name: newName } : prev));
    setMsg("✅ Pool hernoemd.");
    setTimeout(() => setMsg(null), 1500);

    setRenaming(false);
  }

  async function deletePool() {
    setMsg(null);

    if (!poolId || !isUuid) {
      setMsg("Ongeldige pool id.");
      return;
    }
    if (!isOwner) {
      setMsg("Alleen de owner kan de pool verwijderen.");
      return;
    }

    setDeleting(true);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setDeleting(false);
      router.replace("/login");
      return;
    }

    const res = await fetch(`/api/pools/${poolId}/delete`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const raw = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(raw);
    } catch {}

    if (!res.ok) {
      setDeleting(false);
      setMsg(`Verwijderen mislukt (status ${res.status}). ${json?.error ?? raw}`.trim());
      return;
    }

    router.replace("/pools");
  }

  if (loading) {
    return (
      <main style={{ padding: 16 }}>
        <Link href="/pools">← Terug</Link>
        <h1>Pool</h1>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 16, maxWidth: 900 }}>
      <Link href="/pools">← Terug</Link>

      <h1 style={{ marginBottom: 8 }}>{pool?.name ?? "Pool"}</h1>

      <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
        <Link href={`/pools/${poolId}/members`}>Members</Link>
        <span style={{ fontSize: 12, opacity: 0.65 }}>
          Jouw rol: <strong>{myRole ?? "-"}</strong>
        </span>
      </div>

      {msg && <p style={{ color: "crimson" }}>{msg}</p>}

      {/* ✅ HERO KAART */}
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 14,
          padding: 16,
          marginTop: 12,
          background: "white",
          boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>Next up</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
              {hero ? hero.eventName : "Geen open sessies"}
            </div>
            <div style={{ marginTop: 6, opacity: 0.85 }}>
              {hero ? (
                <>
                  <div style={{ fontWeight: 700 }}>{hero.sessionTitle}</div>
                  <div style={{ marginTop: 4 }}>
                    🔓 Lock in <strong>{hero.lockIn}</strong> (om {hero.lockAtLocal})
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>
                    {hero.formatLabel}
                  </div>
                </>
              ) : (
                <div style={{ marginTop: 6, opacity: 0.85 }}>
                  Geen open sessies gevonden. (Alles gelockt of seizoen klaar.)
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <LeaderboardPanel poolId={poolId} />
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "flex-end",
            }}
          >
            {hero ? (
              <>
                <Link href={hero.href} style={{ textDecoration: "underline" }}>
                  Open session →
                </Link>
                <button
                  onClick={() => router.push(hero.href)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #111",
                    background: "#111",
                    color: "white",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  🔥 Voorspel nu
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* INVITE */}
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 14,
          marginTop: 14,
          background: "white",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Invite</div>

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 13, opacity: 0.8 }}>
            Invite code: <strong>{pool?.invite_code ?? "-"}</strong>
          </div>

          <div style={{ fontSize: 13, opacity: 0.8 }}>
            Invite link:
            <div style={{ marginTop: 4 }}>
              <code
                style={{
                  display: "inline-block",
                  padding: "6px 8px",
                  border: "1px solid #eee",
                  borderRadius: 8,
                }}
              >
                {inviteLink || "(geen link)"}
              </code>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>
            <button onClick={copyInvite}>Copy invite link</button>

            {isOwner ? (
              <button onClick={resetInviteCode} disabled={resettingInvite}>
                {resettingInvite ? "Resetting…" : "Reset invite code"}
              </button>
            ) : null}
          </div>

          <div style={{ fontSize: 12, opacity: 0.65 }}>
            Joinen kan alleen via invite link/code. Bij join is username verplicht (leaderboard naam).
          </div>
        </div>
      </div>

      {/* OWNER TOOLS */}
      {isOwner ? (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 14,
            marginTop: 14,
            background: "white",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 10 }}>Owner tools</div>

          {/* Rename */}
          <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
            <div style={{ fontSize: 13, opacity: 0.8 }}>Pool hernoemen</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Nieuwe pool naam"
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #ccc",
                }}
              />
              <button onClick={renamePool} disabled={renaming} style={{ padding: "10px 12px", borderRadius: 10 }}>
                {renaming ? "Opslaan…" : "Opslaan"}
              </button>
            </div>
          </div>

          <hr style={{ margin: "14px 0" }} />

          {/* Delete */}
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 13, opacity: 0.8 }}>Pool verwijderen</div>
            <button
              onClick={deletePool}
              disabled={deleting}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid crimson",
                color: "crimson",
                fontWeight: 700,
                width: "fit-content",
              }}
            >
              {deleting ? "Verwijderen…" : "Verwijder pool"}
            </button>
            <div style={{ fontSize: 12, opacity: 0.65 }}>
              Let op: dit verwijdert ook pool_members en predictions van deze pool.
            </div>
          </div>
        </div>
      ) : null}

      <h2 style={{ marginTop: 24 }}>Events</h2>

      {events.length === 0 ? (
        <p>
          Nog geen events. Run import via <code>/admin/import-calendar</code>.
        </p>
      ) : (
        <ul style={{ paddingLeft: 18 }}>
          {events.map((e) => {
            const isNext = e.id === nextEventId;
            const when = e.starts_at ? new Date(e.starts_at).toLocaleString() : "geen datum";
            const label = e.format === "sprint" ? "Sprint weekend" : "Standaard weekend";

            return (
              <li key={e.id} style={{ marginBottom: 10 }}>
                <Link
                  href={`/pools/${poolId}/event/${e.id}`}
                  style={{ fontWeight: isNext ? "bold" : "normal" }}
                >
                  {isNext ? "➡️ " : ""}
                  {e.name}
                </Link>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {when} • {label}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
