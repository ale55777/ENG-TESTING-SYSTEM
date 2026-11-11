"""Audio upload validation and decoding.

The browser records with an AudioWorklet and uploads 16 kHz mono 16-bit PCM WAV,
so no ffmpeg dependency is needed. Other sample rates are resampled.
"""
from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
import soundfile as sf

TARGET_SR = 16000
ALLOWED_FORMATS = {"WAV", "FLAC", "OGG"}


class AudioValidationError(ValueError):
    pass


@dataclass
class DecodedAudio:
    samples: np.ndarray  # float32 mono at TARGET_SR, range [-1, 1]
    sample_rate: int
    duration_s: float
    wav_bytes: bytes  # canonical 16 kHz PCM16 WAV for upstream services


def resample_linear(x: np.ndarray, src: int, dst: int) -> np.ndarray:
    if src == dst or len(x) == 0:
        return x.astype(np.float32)
    n = int(round(len(x) * dst / src))
    t_src = np.arange(len(x)) / src
    t_dst = np.arange(n) / dst
    return np.interp(t_dst, t_src, x).astype(np.float32)


def encode_wav(samples: np.ndarray, sr: int = TARGET_SR) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.clip(samples, -1.0, 1.0), sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def decode_audio(data: bytes, max_bytes: int, max_seconds: float, min_seconds: float = 0.3) -> DecodedAudio:
    if not data:
        raise AudioValidationError("Empty audio upload")
    if len(data) > max_bytes:
        raise AudioValidationError(f"Audio file too large (max {max_bytes // (1024 * 1024)} MB)")
    try:
        info = sf.info(io.BytesIO(data))
    except Exception as exc:  # soundfile raises RuntimeError/LibsndfileError
        raise AudioValidationError("Unsupported or corrupted audio file. Upload WAV, FLAC or OGG.") from exc
    if info.format not in ALLOWED_FORMATS:
        raise AudioValidationError(f"Unsupported audio format: {info.format}")
    if info.samplerate < 8000 or info.samplerate > 96000:
        raise AudioValidationError("Unsupported sample rate")
    if info.frames / info.samplerate > max_seconds:
        raise AudioValidationError(f"Recording too long (max {int(max_seconds)} seconds)")
    samples, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    mono = samples.mean(axis=1)
    mono = resample_linear(mono, sr, TARGET_SR)
    duration = len(mono) / TARGET_SR
    if duration < min_seconds:
        raise AudioValidationError("Recording too short")
    wav = data if (info.format == "WAV" and sr == TARGET_SR and samples.shape[1] == 1 and info.subtype == "PCM_16") else encode_wav(mono)
    return DecodedAudio(samples=mono, sample_rate=TARGET_SR, duration_s=duration, wav_bytes=wav)


def is_mostly_silent(samples: np.ndarray) -> bool:
    if samples.size == 0:
        return True
    rms = float(np.sqrt(np.mean(samples.astype(np.float64) ** 2)))
    peak = float(np.max(np.abs(samples)))
    return peak < 0.02 or rms < 0.002
