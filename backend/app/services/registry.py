"""Process-wide singletons for local models."""
from app.core.config import get_settings
from app.services.pronunciation.ctc_model import CTCModel
from app.services.tts.supertonic_service import SupertonicService

_s = get_settings()

ctc_model = CTCModel(_s.pronunciation_model_path)
tts_service = SupertonicService(_s.supertonic_model_path, _s.tts_cache_dir, _s.supertonic_auto_download)
