"""Assessment report export: JSON, TXT and PDF (reportlab)."""
from __future__ import annotations

import io
import json
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.services.scoring.attempts import DISCLAIMER

TYPE_LABEL = {
    "reading": "Reading aloud",
    "tongue_twister": "Tongue twister",
    "pronunciation": "Pronunciation practice",
    "speaking": "IELTS-style speaking practice",
    "typing": "Typing practice",
}


def build_report(user_name: str, a: dict, recommendations: list[dict]) -> dict:
    return {
        "report_type": "practice_assessment",
        "disclaimer": DISCLAIMER,
        "user_name": user_name,
        "exercise_type": TYPE_LABEL.get(a["exercise_type"], a["exercise_type"]),
        "date": a["created_at"],
        "duration_seconds": round(a["duration_ms"] / 1000, 1),
        "difficulty": a.get("difficulty"),
        "reference_text": a.get("reference_text"),
        "recognized_transcript": (a.get("transcript") or {}).get("text"),
        "transcription_model": (a.get("transcript") or {}).get("model"),
        "word_matching": a.get("alignment") and {k: v for k, v in a["alignment"].items() if k != "ops"},
        "word_accuracy_percent": a.get("word_accuracy"),
        "word_by_word": [
            {"type": o["type"], "reference": o.get("ref"), "spoken": o.get("hyp"), "repeated": o.get("repeated", False)}
            for o in ((a.get("alignment") or {}).get("ops") or [])
        ],
        "pronunciation": a.get("pronunciation"),
        "typing": a.get("typing"),
        "speaking": a.get("speaking"),
        "metrics": a.get("metrics"),
        "ai_feedback": a.get("feedback"),
        "recommendations": [{"title": r["title"], "reason": r["reason"]} for r in recommendations],
    }


def to_json(report: dict) -> bytes:
    return json.dumps(report, indent=2, ensure_ascii=False, default=str).encode("utf-8")


def _feedback_text(fb: dict | None) -> str:
    if not fb:
        return "No feedback available."
    if fb.get("text"):
        return fb["text"]
    parts = []
    lang = fb.get("language") or {}
    for k in ("grammar", "vocabulary", "coherence"):
        if lang.get(k):
            parts.append(f"{k.title()}: {lang[k].get('summary', '')}")
    if lang.get("improved_answer"):
        parts.append("Improved answer: " + lang["improved_answer"])
    if fb.get("tips"):
        parts += [f"- {t}" for t in fb["tips"]]
    return "\n".join(parts) or fb.get("status", "")


def _lines(report: dict) -> list[tuple[str, str]]:
    out = [
        ("Learner", report["user_name"]),
        ("Exercise", report["exercise_type"]),
        ("Date", str(report["date"])),
        ("Duration", f"{report['duration_seconds']} s"),
    ]
    if report.get("difficulty"):
        out.append(("Difficulty", report["difficulty"]))
    if report.get("word_accuracy_percent") is not None:
        out.append(("Word-matching accuracy", f"{report['word_accuracy_percent']}%"))
    wm = report.get("word_matching")
    if wm:
        out.append(("Words", f"{wm['correct']} correct, {wm['substitutions']} substituted, {wm['deletions']} missing, "
                              f"{wm['insertions']} extra ({wm['repetitions']} repeated) of {wm['reference_word_count']}"))
    p = report.get("pronunciation")
    if p:
        out.append(("Pronunciation", f"{p['overall_score']} / 100 ({p['method']})" if p["available"]
                    else f"Unavailable: {p.get('unavailable_reason')}"))
    t = report.get("typing")
    if t:
        out.append(("Typing", f"Gross {t['gross_wpm']} WPM, net {t['net_wpm']} WPM, accuracy {t['accuracy']}%, "
                              f"{t['uncorrected_errors']} uncorrected / {t['corrected_errors']} corrected errors ({t['mode']} mode)"))
    s = report.get("speaking")
    if s:
        est = ", ".join(f"{k}: {v}" for k, v in (s.get("estimates") or {}).items() if v is not None)
        out.append(("Speaking estimates (0-9, practice only)", est or "n/a"))
        f = s.get("fluency") or {}
        out.append(("Fluency measurements", f"{f.get('speech_rate_wpm')} wpm, {f.get('pause_count')} pauses, {f.get('long_pause_count')} long pauses"))
    return out


def to_txt(report: dict) -> bytes:
    lines = ["ENGLISH PRACTICE ASSESSMENT REPORT", "=" * 36, ""]
    lines += [f"{k}: {v}" for k, v in _lines(report)]
    if report.get("reference_text"):
        lines += ["", "Reference text:", report["reference_text"]]
    if report.get("recognized_transcript") is not None:
        lines += ["", f"Recognized transcript ({report.get('transcription_model')}):", report["recognized_transcript"] or "(empty)"]
    mism = [w for w in report.get("word_by_word", []) if w["type"] != "correct"]
    if mism:
        lines += ["", "Word differences:"]
        for w in mism:
            lines.append(f"  - {w['type']}: expected '{w['reference'] or ''}' heard '{w['spoken'] or ''}'" + (" (repeated)" if w["repeated"] else ""))
    lines += ["", "AI feedback:", _feedback_text(report.get("ai_feedback"))]
    if report.get("recommendations"):
        lines += ["", "Recommendations:"] + [f"  - {r['title']}: {r['reason']}" for r in report["recommendations"]]
    lines += ["", report["disclaimer"], ""]
    return "\n".join(lines).encode("utf-8")


_OP_COLOR = {"correct": "#15803d", "substitution": "#b91c1c", "deletion": "#c2410c", "insertion": "#1d4ed8"}


def to_pdf(report: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                            title="Practice assessment report")
    ss = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=ss["BodyText"], fontSize=10, leading=14)
    small = ParagraphStyle("small", parent=body, fontSize=8, textColor=colors.HexColor("#555555"))
    story = [Paragraph("English Practice Assessment Report", ss["Title"]), Paragraph(escape(report["disclaimer"]), small), Spacer(1, 6)]
    rows = [[Paragraph(f"<b>{escape(k)}</b>", body), Paragraph(escape(str(v)), body)] for k, v in _lines(report)]
    tbl = Table(rows, colWidths=[55 * mm, 115 * mm])
    tbl.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d4d4d8")),
                             ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f4f4f5")),
                             ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story += [tbl, Spacer(1, 10)]
    if report.get("reference_text"):
        story += [Paragraph("Reference text", ss["Heading3"]), Paragraph(escape(report["reference_text"]), body)]
    if report.get("word_by_word"):
        parts = []
        for w in report["word_by_word"]:
            word = w["spoken"] if w["type"] == "insertion" else w["reference"]
            label = {"correct": "", "substitution": f" [said: {w['spoken']}]", "deletion": " [missing]",
                     "insertion": " [extra" + (", repeated]" if w["repeated"] else "]")}[w["type"]]
            parts.append(f'<font color="{_OP_COLOR[w["type"]]}">{escape(word or "")}{escape(label)}</font>')
        story += [Paragraph("Word-by-word result", ss["Heading3"]),
                  Paragraph("Green = matched, red = substituted, orange = missing, blue = extra.", small),
                  Paragraph(" ".join(parts), body)]
    if report.get("recognized_transcript") is not None:
        story += [Paragraph("Recognized transcript", ss["Heading3"]), Paragraph(escape(report["recognized_transcript"] or "(empty)"), body)]
    p = report.get("pronunciation")
    if p and p.get("available") and p.get("words"):
        low = [w for w in p["words"] if w.get("score") is not None and w["score"] < 75]
        if low:
            story += [Paragraph("Low-confidence words (acoustic model)", ss["Heading3"]),
                      Paragraph(escape(", ".join(f"{w['word']} ({w['score']})" for w in low)), body)]
    story += [Paragraph("AI feedback", ss["Heading3"]),
              Paragraph(escape(_feedback_text(report.get("ai_feedback"))).replace("\n", "<br/>"), body)]
    if report.get("recommendations"):
        story += [Paragraph("Recommendations", ss["Heading3"])]
        story += [Paragraph(f"&bull; <b>{escape(r['title'])}</b>: {escape(r['reason'])}", body) for r in report["recommendations"]]
    doc.build(story)
    return buf.getvalue()
