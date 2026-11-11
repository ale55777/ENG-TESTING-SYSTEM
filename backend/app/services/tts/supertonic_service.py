"""Supertonic text-to-speech (local ONNX inference, no API key).

Model: Supertone "supertonic-3" via the `supertonic` Python package (code MIT,
weights OpenRAIL-M). Note: the upstream project was archived by Supertone in
Sep 2026; the pinned package + downloaded weights continue to work offline.

Generated audio is cached on disk keyed by (text, voice, speed, steps).
"""
from __future__ import annotations

import hashlib
import io
import logging
import threading
from pathlib import Path

import numpy as np
import soundfile as sf

log = logging.getLogger(__name__)

VOICES = ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"]
MAX_TTS_CHARS = 1200


class TTSUnavailable(RuntimeError):
    pass


class SupertonicService:
    MODEL = "supertonic-3"

    def __init__(self, model_dir: str, cache_dir: str, auto_download: bool = False) -> None:
        self.model_dir = Path(model_dir)
        self.cache_dir = Path(cache_dir)
        self.auto_download = auto_download
        self._tts = None
        self._styles: dict = {}
        self._lock = threading.Lock()
        self._error: str | None = None

    def _files_present(self) -> bool:
        return (self.model_dir / "onnx").is_dir() and (self.model_dir / "voice_styles").is_dir()

    def load(self) -> bool:
        if self._tts is not None:
            return True
        with self._lock:
            if self._tts is not None:
                return True
            if not self._files_present() and not self.auto_download:
                self._error = f"Supertonic model not found at {self.model_dir}. Run scripts/setup.ps1 to download it."
                return False
            try:
                from supertonic import TTS

                self._tts = TTS(model=self.MODEL, model_dir=str(self.model_dir), auto_download=self.auto_download)
                self._error = None
                log.info("Supertonic TTS loaded (sample_rate=%s)", self._tts.sample_rate)
                return True
            except Exception as exc:  # pragma: no cover
                self._error = f"Supertonic failed to initialise: {exc}"
                log.exception("Supertonic load failed")
                return False

    @property
    def available(self) -> bool:
        return self.load()

    @property
    def error(self) -> str | None:
        return self._error

    def status(self) -> dict:
        return {
            "available": self._tts is not None or self._files_present(),
            "loaded": self._tts is not None,
            "model": self.MODEL,
            "voices": VOICES,
            "error": self._error,
        }

    @staticmethod
    def cache_key(text: str, voice: str, speed: float, steps: int) -> str:
        raw = f"{SupertonicService.MODEL}|{voice}|{speed:.2f}|{steps}|{text}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def synthesize_wav(self, text: str, voice: str = "F1", speed: float = 1.0, steps: int = 8) -> tuple[bytes, bool]:
        """Return (wav_bytes, cache_hit). Blocking; call from a worker thread."""
        text = " ".join(text.split())
        if not text:
            raise ValueError("Text is empty")
        if len(text) > MAX_TTS_CHARS:
            raise ValueError(f"Text too long for TTS (max {MAX_TTS_CHARS} characters)")
        if voice not in VOICES:
            raise ValueError(f"Unknown voice '{voice}'")
        speed = float(min(1.6, max(0.7, speed)))
        steps = int(min(12, max(4, steps)))
        key = self.cache_key(text, voice, speed, steps)
        path = self.cache_dir / f"{key}.wav"
        if path.exists():
            return path.read_bytes(), True
        if not self.load():
            raise TTSUnavailable(self._error or "TTS unavailable")
        with self._lock:  # ONNX sessions are shared; serialize synthesis
            style = self._styles.get(voice)
            if style is None:
                style = self._tts.get_voice_style(voice_name=voice)
                self._styles[voice] = style
            wav, _dur = self._tts.synthesize(text, voice_style=style, lang="en", speed=speed, total_steps=steps)
            sr = self._tts.sample_rate
        audio = np.asarray(wav, dtype=np.float32).squeeze()
        buf = io.BytesIO()
        sf.write(buf, np.clip(audio, -1, 1), sr, format="WAV", subtype="PCM_16")
        data = buf.getvalue()
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)
        return data, False
