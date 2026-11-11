from app.services.reading.alignment import align_texts, normalize_token

REF = "Learning English requires patience and regular practice."


def counts(r):
    return (r.correct, r.substitutions, r.deletions, r.insertions, r.repetitions)


def test_perfect_match_ignores_case_and_punctuation():
    r = align_texts(REF, "learning english requires patience and regular practice")
    assert counts(r) == (7, 0, 0, 0, 0)
    assert r.wer == 0 and r.accuracy == 100.0


def test_missing_words():
    r = align_texts(REF, "Learning English requires and practice")
    assert counts(r) == (5, 0, 2, 0, 0)
    assert [o.ref for o in r.ops if o.type == "deletion"] == ["patience", "regular"]
    assert r.accuracy == round((1 - 2 / 7) * 100, 2)


def test_extra_words():
    r = align_texts(REF, "Learning English really requires patience and regular practice")
    assert counts(r) == (7, 0, 0, 1, 0)
    assert [o.hyp for o in r.ops if o.type == "insertion"] == ["really"]


def test_substitution():
    r = align_texts(REF, "Learning French requires patience and regular practice")
    assert counts(r) == (6, 1, 0, 0, 0)
    sub = [o for o in r.ops if o.type == "substitution"][0]
    assert (sub.ref, sub.hyp) == ("english", "french")


def test_repeated_words_are_flagged_and_counted_as_insertions():
    r = align_texts(REF, "Learning English English requires patience and and regular practice")
    assert r.insertions == 2 and r.repetitions == 2
    assert r.correct == 7


def test_wer_can_exceed_one_and_accuracy_floors_at_zero():
    r = align_texts("hello world", "this is a completely different long sentence")
    assert r.wer > 1
    assert r.accuracy == 0.0


def test_empty_reference_has_undefined_accuracy():
    r = align_texts("", "anything")
    assert r.wer is None and r.accuracy is None


def test_empty_hypothesis_all_deleted():
    r = align_texts(REF, "")
    assert r.deletions == 7 and r.accuracy == 0.0


def test_contractions_are_not_normalized_away():
    r = align_texts("I do not know", "I don't know")
    assert r.accuracy < 100


def test_numbers_and_hyphens_normalize():
    assert normalize_token("3") == ["three"]
    assert normalize_token("well-known,") == ["well", "known"]
    assert normalize_token("‘Don’t’") == ["don't"]
    r = align_texts("He has three well-known cats.", "he has 3 well known cats")
    assert r.accuracy == 100.0


def test_timed_words_carry_timestamps():
    words = [{"word": "Learning", "start": 0.0, "end": 0.4}, {"word": "English", "start": 0.4, "end": 0.9}]
    r = align_texts("Learning English", hypothesis_words=words)
    assert r.ops[1].start == 0.4 and r.accuracy == 100.0


def test_alignment_is_deterministic():
    a = align_texts(REF, "learning english require patient and regular regular practise")
    b = align_texts(REF, "learning english require patient and regular regular practise")
    assert [o.__dict__ for o in a.ops] == [o.__dict__ for o in b.ops]
