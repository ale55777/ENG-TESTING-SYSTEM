/**
 * Pure typing-input validation. Every DOM input change is checked here against the last
 * ACCEPTED text, so strict mode is enforced even when key blocking is bypassed (IME, mobile
 * keyboards, autocorrect, accessibility tools, browser quirks).
 */
export type TypingMode = "practice" | "challenge";

export interface AcceptResult {
  text: string; // the new accepted text
  rejected: boolean; // the proposed change was (partly) refused
  inserted: number; // characters added
  deleted: number; // characters removed
  correctedErrors: number; // removed characters that had been wrong
}

export function acceptInput(prev: string, proposed: string, reference: string, mode: TypingMode): AcceptResult {
  const next = proposed.replace(/\r\n?/g, "\n");
  if (mode === "challenge") {
    // Forward-only: the accepted text must be an unchanged prefix of the proposal.
    if (!next.startsWith(prev)) return { text: prev, rejected: true, inserted: 0, deleted: 0, correctedErrors: 0 };
    const room = reference.length - prev.length;
    const added = next.slice(prev.length, prev.length + room);
    return { text: prev + added, rejected: added.length < next.length - prev.length, inserted: added.length, deleted: 0, correctedErrors: 0 };
  }
  // Practice mode: corrections allowed. Find common prefix, count removed chars and how many were errors.
  let p = 0;
  while (p < prev.length && p < next.length && prev[p] === next[p]) p++;
  const removed = prev.slice(p);
  let corrected = 0;
  for (let i = 0; i < removed.length; i++) if (removed[i] !== reference[p + i]) corrected++;
  const capped = next.slice(0, reference.length);
  return {
    text: capped,
    rejected: capped.length < next.length,
    inserted: Math.max(0, capped.length - p),
    deleted: removed.length,
    correctedErrors: corrected,
  };
}

/** Input types allowed by `beforeinput` in each mode. Everything else is cancelled. */
export function allowedInputType(inputType: string, mode: TypingMode): boolean {
  if (inputType === "insertText" || inputType === "insertCompositionText") return true;
  if (inputType === "insertLineBreak" || inputType === "insertParagraph") return true; // validated against reference
  if (mode === "practice" && (inputType === "deleteContentBackward" || inputType === "deleteWordBackward")) return true;
  // Blocked: insertFromPaste, insertFromDrop, insertReplacementText (autocorrect), historyUndo/Redo,
  // deleteContentForward, deleteByCut, insertFromYank, formatting, etc.
  return false;
}

export interface LiveStats {
  grossWpm: number;
  netWpm: number;
  accuracy: number;
  errors: number;
}

export function liveStats(typed: string, reference: string, elapsedMs: number): LiveStats {
  let errors = 0;
  for (let i = 0; i < typed.length; i++) if (typed[i] !== reference[i]) errors++;
  const minutes = elapsedMs / 60000;
  if (minutes <= 0 || typed.length === 0) return { grossWpm: 0, netWpm: 0, accuracy: 100, errors };
  const gross = typed.length / 5 / minutes;
  return {
    grossWpm: gross,
    netWpm: Math.max(0, gross - errors / minutes),
    accuracy: ((typed.length - errors) / typed.length) * 100,
    errors,
  };
}
