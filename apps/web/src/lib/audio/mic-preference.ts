"use client";

/**
 * The learner's chosen microphone, shared by every recording module (reading, tongue twisters,
 * pronunciation, speaking) and the Settings page.
 *
 * Device ids are specific to this browser and origin, so the choice is stored locally
 * (localStorage), not in the server profile. The label is stored too: if the id stops matching
 * (browser data cleared, device re-plugged), the recorder looks the device up again by name and
 * otherwise falls back to the system default.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export interface MicPreference {
  deviceId: string;
  label: string;
}

const KEY = "lp.microphone";
const EVENT = "lp:microphone-change";

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): MicPreference | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<MicPreference>;
    return typeof v.deviceId === "string" && v.deviceId ? { deviceId: v.deviceId, label: typeof v.label === "string" ? v.label : "" } : null;
  } catch {
    return null;
  }
}

export function getMicPreference(): MicPreference | null {
  if (typeof window === "undefined") return null;
  return parse(read());
}

/** `null` = use the system default microphone. */
export function setMicPreference(pref: MicPreference | null): void {
  try {
    if (pref) window.localStorage.setItem(KEY, JSON.stringify(pref));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable (private mode): the choice lasts only for this page */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage); // other tabs
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Reactive current preference (raw JSON snapshot keeps useSyncExternalStore stable). */
export function useMicPreference(): MicPreference | null {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  return parse(raw);
}

export function audioConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

/**
 * Open the preferred microphone. If it is gone, retry by matching its label, then fall back to the
 * system default (and report that via `fellBack`). Permission errors are re-thrown unchanged.
 */
export async function openPreferredMic(): Promise<{ stream: MediaStream; fellBack: boolean }> {
  const pref = getMicPreference();
  if (!pref) return { stream: await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() }), fellBack: false };
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(pref.deviceId) }), fellBack: false };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name !== "OverconstrainedError" && name !== "NotFoundError" && name !== "NotReadableError") throw e;
  }
  if (pref.label) {
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
    const match = devices.find((d) => d.kind === "audioinput" && d.label === pref.label && d.deviceId);
    if (match) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(match.deviceId) });
        setMicPreference({ deviceId: match.deviceId, label: match.label }); // id changed; remember the new one
        return { stream, fellBack: false };
      } catch {
        /* fall through to default */
      }
    }
  }
  return { stream: await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() }), fellBack: true };
}

const noopSubscribe = () => () => {};

/** Lists audio inputs, refreshes on plug/unplug, and knows whether labels are visible (permission). */
export function useMicDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [hasPermission, setHasPermission] = useState(false);
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => !!navigator.mediaDevices?.enumerateDevices,
    () => true,
  );

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
    const inputs = all.filter((d) => d.kind === "audioinput");
    // Without permission browsers hide labels (and often ids); show the list only once granted.
    setHasPermission(inputs.some((d) => d.label));
    // "default"/"communications" are Chrome aliases of real devices; "System default" covers them.
    setDevices(inputs.filter((d) => d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications"));
  }, []);

  useEffect(() => {
    const md = navigator.mediaDevices;
    let alive = true;
    // Initial listing: state is only set after the async enumeration resolves.
    md?.enumerateDevices?.().then(() => { if (alive) void refresh(); }, () => {});
    md?.addEventListener?.("devicechange", refresh);
    return () => {
      alive = false;
      md?.removeEventListener?.("devicechange", refresh);
    };
  }, [refresh]);

  /** Ask for microphone permission once so device names can be shown. */
  const requestPermission = useCallback(async () => {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    await refresh();
  }, [refresh]);

  return { devices, hasPermission, supported, refresh, requestPermission };
}
