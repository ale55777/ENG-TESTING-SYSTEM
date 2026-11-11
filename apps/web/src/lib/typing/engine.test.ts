// Run with: npm test   (Node's built-in test runner with TypeScript type stripping)
import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptInput, allowedInputType, liveStats } from "./engine.ts";

const REF = "The quick brown fox.";

test("challenge: plain forward typing is accepted", () => {
  const r = acceptInput("The", "The ", REF, "challenge");
  assert.equal(r.text, "The ");
  assert.equal(r.inserted, 1);
  assert.equal(r.rejected, false);
});

test("challenge: wrong characters are kept (no correction) and typing continues", () => {
  const r = acceptInput("The", "The_", REF, "challenge");
  assert.equal(r.text, "The_");
});

test("challenge: backspace / deletion is rejected", () => {
  const r = acceptInput("The q", "The ", REF, "challenge");
  assert.equal(r.text, "The q");
  assert.equal(r.rejected, true);
});

test("challenge: selection-overwrite of earlier characters is rejected", () => {
  // user selected "The" and typed "X" -> DOM value "X q"
  const r = acceptInput("The q", "X q", REF, "challenge");
  assert.equal(r.text, "The q");
  assert.equal(r.rejected, true);
});

test("challenge: editing in the middle (caret moved back) is rejected", () => {
  const r = acceptInput("The q", "Thxe q", REF, "challenge");
  assert.equal(r.text, "The q");
  assert.equal(r.rejected, true);
});

test("challenge: undo that removes text is rejected", () => {
  const r = acceptInput("The quick", "The", REF, "challenge");
  assert.equal(r.text, "The quick");
});

test("challenge: cannot exceed the reference length", () => {
  const r = acceptInput(REF, REF + "extra", REF, "challenge");
  assert.equal(r.text, REF);
  assert.equal(r.rejected, true);
});

test("challenge: IME/autocomplete burst that only appends is accepted", () => {
  const r = acceptInput("The ", "The quick", REF, "challenge");
  assert.equal(r.text, "The quick");
  assert.equal(r.inserted, 5);
});

test("practice: backspace allowed and corrected errors counted", () => {
  const r1 = acceptInput("The qx", "The q", REF, "practice"); // removed wrong 'x' (expected 'u')
  assert.equal(r1.text, "The q");
  assert.equal(r1.deleted, 1);
  assert.equal(r1.correctedErrors, 1);
  const r2 = acceptInput("The qu", "The q", REF, "practice"); // removed a correct char
  assert.equal(r2.correctedErrors, 0);
});

test("input types: paste, drop, undo, replacement and forward-delete are blocked", () => {
  for (const t of ["insertFromPaste", "insertFromDrop", "historyUndo", "historyRedo", "insertReplacementText", "deleteContentForward", "deleteByCut"]) {
    assert.equal(allowedInputType(t, "challenge"), false, t);
    assert.equal(allowedInputType(t, "practice"), false, t);
  }
  assert.equal(allowedInputType("deleteContentBackward", "challenge"), false);
  assert.equal(allowedInputType("deleteContentBackward", "practice"), true);
  assert.equal(allowedInputType("insertText", "challenge"), true);
});

test("live stats use the documented WPM formula", () => {
  const s = liveStats("The quack", REF, 6000); // 9 chars, 1 error, 0.1 min
  assert.equal(Math.round(s.grossWpm), 18); // (9/5)/0.1
  assert.equal(Math.round(s.netWpm), 8); // 18 - 1/0.1
  assert.equal(s.errors, 1);
});
