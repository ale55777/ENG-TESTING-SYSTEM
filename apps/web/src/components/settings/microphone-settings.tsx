"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, RefreshCw, Square } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { audioConstraints, setMicPreference, useMicDevices, useMicPreference } from "@/lib/audio/mic-preference";
import { micErrorMessage } from "@/lib/audio/recorder";
import { cn } from "@/lib/utils";

const DEFAULT = "__default__"; // Radix Select does not allow an empty-string value

/** Microphone picker used by every speaking module, with a live level test. */
export function MicrophoneSettings() {
  const { devices, hasPermission, supported, refresh, requestPermission } = useMicDevices();
  const pref = useMicPreference();
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [testLabel, setTestLabel] = useState("");
  const cleanupRef = useRef<(() => void) | null>(null);

  const selectedMissing = !!pref && hasPermission && !devices.some((d) => d.deviceId === pref.deviceId);
  const value = pref && !selectedMissing ? pref.deviceId : DEFAULT;

  function stopTest() {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setTesting(false);
    setLevel(0);
  }

  async function startTest(deviceId?: string) {
    stopTest();
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(deviceId) });
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let raf = 0;
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 12)); // same scale as the recorder meter
        raf = requestAnimationFrame(tick);
      };
      tick();
      cleanupRef.current = () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
      };
      setTestLabel(stream.getAudioTracks()[0]?.label ?? "");
      setTesting(true);
      void refresh(); // labels become visible after the first permission grant
    } catch (e) {
      setError(micErrorMessage(e));
    }
  }

  useEffect(() => () => cleanupRef.current?.(), []);

  function choose(v: string) {
    const dev = devices.find((d) => d.deviceId === v);
    setMicPreference(v === DEFAULT || !dev ? null : { deviceId: dev.deviceId, label: dev.label });
    if (testing) void startTest(v === DEFAULT ? undefined : v); // keep testing on the new device
  }

  return (
    <Card id="microphone" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="size-5" aria-hidden /> Microphone
        </CardTitle>
        <CardDescription>
          Used for reading aloud, tongue twisters, pronunciation and speaking practice. Saved in this browser on this device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!supported ? (
          <Alert variant="destructive">
            <AlertDescription>This browser cannot list microphones. Use a recent Chrome, Edge, Firefox or Safari.</AlertDescription>
          </Alert>
        ) : !hasPermission ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Allow microphone access so your devices can be listed by name.</p>
            <Button
              variant="secondary"
              onClick={async () => {
                setError(null);
                try {
                  await requestPermission();
                } catch (e) {
                  setError(micErrorMessage(e));
                }
              }}
            >
              <Mic /> Allow microphone access
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label>Input device</Label>
              <Select value={value} onValueChange={choose}>
                <SelectTrigger className="w-full" aria-label="Input device">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT}>System default</SelectItem>
                  {devices.map((d, i) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone ${i + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              {testing ? (
                <Button variant="outline" onClick={stopTest}>
                  <Square /> Stop test
                </Button>
              ) : (
                <Button variant="outline" onClick={() => void startTest(value === DEFAULT ? undefined : value)}>
                  <Mic /> Test microphone
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => void refresh()} aria-label="Refresh device list" title="Refresh device list">
                <RefreshCw />
              </Button>
            </div>
          </div>
        )}

        {selectedMissing && (
          <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
            <MicOff className="size-4" aria-hidden />
            “{pref?.label || "Your chosen microphone"}” is not connected. The system default will be used until it is plugged back in.
          </p>
        )}

        {testing && (
          <div className="space-y-1.5">
            <div
              className="h-3 w-full overflow-hidden rounded-full bg-muted"
              role="meter"
              aria-label="Microphone test level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(level * 100)}
            >
              <div
                className={cn("h-full rounded-full transition-[width] duration-75", level > 0.15 ? "bg-green-500" : "bg-muted-foreground/40")}
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Speak normally. The bar should turn green{testLabel ? <> — listening on <span className="font-medium text-foreground">{testLabel}</span></> : null}.
            </p>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
