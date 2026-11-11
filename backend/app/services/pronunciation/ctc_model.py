"""Local acoustic model: wav2vec2-base-960h (character-level CTC), int8 ONNX, run with onnxruntime.

Used for:
  * word-level pronunciation confidence via CTC forced alignment (see assessor.py)
  * an offline, lower-accuracy fallback transcription (greedy CTC decoding) when Groq
    is not configured.

The model outputs a probability per 20 ms frame over 32 symbols (A-Z, apostrophe,
word separator '|', blank/pad). It has no phoneme inventory, so we never report
phoneme-level results.
"""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

SAMPLES_PER_FRAME = 320  # wav2vec2 conv stack stride at 16 kHz -> 20 ms
CHUNK_S = 15
PAD_S = 1


class CTCModel:
    MODEL_NAME = "wav2vec2-base-960h (int8 ONNX)"

    def __init__(self, model_dir: str) -> None:
        self.model_dir = Path(model_dir)
        self._session = None
        self._lock = threading.Lock()
        self._error: str | None = None
        self.vocab: dict[str, int] = {}
        self.id_to_char: dict[int, str] = {}
        self.blank_id = 0
        self.sep_id = 4

    def _model_file(self) -> Path | None:
        for name in ("model_quantized.onnx", "model_int8.onnx", "model.onnx"):
            p = self.model_dir / name
            if p.exists():
                return p
        return None

    def load(self) -> bool:
        if self._session is not None:
            return True
        with self._lock:
            if self._session is not None:
                return True
            mf = self._model_file()
            vf = self.model_dir / "vocab.json"
            if mf is None or not vf.exists():
                self._error = f"Pronunciation model files not found in {self.model_dir}. Run scripts/setup.ps1."
                return False
            try:
                import onnxruntime as ort

                opts = ort.SessionOptions()
                opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
                self._session = ort.InferenceSession(str(mf), opts, providers=["CPUExecutionProvider"])
                self.vocab = json.loads(vf.read_text(encoding="utf-8"))
                self.id_to_char = {v: k for k, v in self.vocab.items()}
                self.blank_id = self.vocab.get("<pad>", 0)
                self.sep_id = self.vocab.get("|", 4)
                self._error = None
                log.info("Loaded pronunciation model %s", mf)
                return True
            except Exception as exc:  # pragma: no cover - depends on local files
                self._error = f"Failed to load pronunciation model: {exc}"
                log.exception("CTC model load failed")
                return False

    @property
    def available(self) -> bool:
        return self.load()

    @property
    def error(self) -> str | None:
        return self._error

    def log_probs(self, audio: np.ndarray) -> np.ndarray:
        """Return (T, V) log-probabilities for 16 kHz mono float audio.

        Long audio is processed in 15 s windows with 1 s context on each side to keep
        self-attention memory bounded; padded frames are trimmed before concatenation.
        """
        if not self.load():
            raise RuntimeError(self._error or "model unavailable")
        sr = 16000
        chunk = CHUNK_S * sr
        pad = PAD_S * sr
        pad_frames = pad // SAMPLES_PER_FRAME
        outs: list[np.ndarray] = []
        n = len(audio)
        for start in range(0, max(n, 1), chunk):
            end = min(n, start + chunk)
            a0, a1 = max(0, start - pad), min(n, end + pad)
            seg = audio[a0:a1].astype(np.float32)
            seg = (seg - seg.mean()) / np.sqrt(seg.var() + 1e-7)
            with self._lock:
                logits = self._session.run(None, {"input_values": seg[None, :]})[0][0]
            lead = (start - a0) // SAMPLES_PER_FRAME
            want = int(np.ceil((end - start) / SAMPLES_PER_FRAME))
            lead = min(lead, pad_frames)
            outs.append(logits[lead : lead + want])
        logits = np.concatenate(outs, axis=0).astype(np.float64)
        m = logits.max(axis=1, keepdims=True)
        return logits - m - np.log(np.exp(logits - m).sum(axis=1, keepdims=True))

    def greedy_decode(self, lp: np.ndarray) -> str:
        ids = lp.argmax(axis=1)
        out: list[str] = []
        prev = -1
        for i in ids:
            if i != prev and i != self.blank_id:
                ch = self.id_to_char.get(int(i), "")
                if ch == "|":
                    out.append(" ")
                elif len(ch) == 1:
                    out.append(ch)
            prev = i
        return " ".join("".join(out).split()).lower()

    def encode_word(self, word: str) -> list[int]:
        return [self.vocab[c] for c in word.upper() if c in self.vocab and len(c) == 1 and c != "|"]
