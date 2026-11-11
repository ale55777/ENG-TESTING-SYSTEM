"use client";

/**
 * Ably realtime client.
 *
 * - Authenticates with short-lived JWTs from the backend (/realtime/token); the API key never reaches the browser.
 * - Subscribes to the learner's own channel only (token capability = subscribe/history on learner:{id}).
 * - De-duplicates by event_id and re-orders by seq within each session, so retries/reconnects never
 *   double-apply a delta. On reconnect, Ably resumes the channel; anything missed is recovered via the
 *   HTTP API (results pages poll until feedback is final), which is the source of truth.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type * as AblyTypes from "ably";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { RealtimeEvent } from "@/lib/types";

type Listener = (e: RealtimeEvent) => void;
export type RealtimeStatus = "disabled" | "connecting" | "connected" | "disconnected" | "failed";

interface RealtimeCtx {
  status: RealtimeStatus;
  subscribe: (fn: Listener) => () => void;
}

const Ctx = createContext<RealtimeCtx>({ status: "disabled", subscribe: () => () => {} });

class Sequencer {
  private seen = new Set<string>();
  private order: string[] = [];
  private next = new Map<string, number>();
  private pending = new Map<string, Map<number, RealtimeEvent>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private emit: (e: RealtimeEvent) => void) {}

  push(e: RealtimeEvent) {
    if (!e?.event_id || this.seen.has(e.event_id)) return;
    this.seen.add(e.event_id);
    this.order.push(e.event_id);
    if (this.order.length > 2000) this.seen.delete(this.order.shift()!);
    const sid = e.session_id;
    const expected = this.next.get(sid) ?? 1;
    if (e.seq < expected) return;
    const buf = this.pending.get(sid) ?? new Map();
    buf.set(e.seq, e);
    this.pending.set(sid, buf);
    this.drain(sid);
    if (buf.size && !this.timers.has(sid)) {
      // A gap: wait briefly for the missing event, then deliver what we have in order.
      this.timers.set(sid, setTimeout(() => this.flush(sid), 1200));
    }
  }

  private drain(sid: string) {
    const buf = this.pending.get(sid)!;
    let n = this.next.get(sid) ?? 1;
    // Late joiners: if we never saw seq 1, start from the lowest seq we have.
    if (!this.next.has(sid) && buf.size && !buf.has(n)) n = Math.min(...buf.keys());
    while (buf.has(n)) {
      this.emit(buf.get(n)!);
      buf.delete(n);
      n++;
    }
    this.next.set(sid, n);
  }

  private flush(sid: string) {
    this.timers.delete(sid);
    const buf = this.pending.get(sid);
    if (!buf?.size) return;
    const seqs = [...buf.keys()].sort((a, b) => a - b);
    for (const s of seqs) this.emit(buf.get(s)!);
    buf.clear();
    this.next.set(sid, seqs[seqs.length - 1] + 1);
  }
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<RealtimeStatus>("disabled");
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    if (!user) return;
    let client: AblyTypes.Realtime | null = null;
    let cancelled = false;
    const seq = new Sequencer((e) => listeners.current.forEach((fn) => fn(e)));
    (async () => {
      try {
        const st = await api<{ enabled: boolean }>("/realtime/status");
        if (!st.enabled || cancelled) return;
        const Ably = await import("ably");
        setStatus("connecting");
        client = new Ably.Realtime({
          authCallback: async (_params, cb) => {
            try {
              const t = await api<{ token: string }>("/realtime/token");
              cb(null, t.token);
            } catch (err) {
              cb(String(err), null);
            }
          },
          clientId: user.id,
          echoMessages: false,
        });
        client.connection.on((change) => {
          const map: Record<string, RealtimeStatus> = {
            connected: "connected",
            connecting: "connecting",
            disconnected: "disconnected",
            suspended: "disconnected",
            failed: "failed",
            closed: "disconnected",
          };
          if (map[change.current]) setStatus(map[change.current]);
        });
        const channel = client.channels.get(`learner:${user.id}`);
        await channel.subscribe((msg) => seq.push(msg.data as RealtimeEvent));
      } catch {
        if (!cancelled) setStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
      client?.close();
      setStatus("disabled");
    };
  }, [user]);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  return <Ctx.Provider value={{ status, subscribe }}>{children}</Ctx.Provider>;
}

export function useRealtime() {
  return useContext(Ctx);
}

/** Subscribe to events (optionally filtered) for the lifetime of the component. */
export function useRealtimeEvents(fn: Listener, deps: unknown[] = []) {
  const { subscribe } = useRealtime();
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
}
