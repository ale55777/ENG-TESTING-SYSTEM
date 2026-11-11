import { ShieldCheck } from "lucide-react";

export function PrivacyNote() {
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        Your recording is sent securely to this app&apos;s server and, when configured, to GroqCloud (an external service) for speech-to-text. Audio is
        processed in memory and is not stored; only the transcript and scores are saved to your history, which you can delete at any time.
      </span>
    </p>
  );
}
