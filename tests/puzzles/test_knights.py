"""Tests of Knights and Knaves (plain functions with assert, like test_vno_puzzles.py)."""

import copy
import json
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
PACKAGES = os.path.normpath(os.path.join(HERE, "..", "..", "templates", "puzzles", "game", "python-packages"))
sys.path.insert(0, PACKAGES)

from vno_puzzles import check_text, generate, hint, solve, text  # noqa: E402
from vno_puzzles import knights as K  # noqa: E402
from vno_puzzles import play  # noqa: E402
from vno_puzzles.model import PuzzleError  # noqa: E402

BANDS = ("easy", "medium", "hard")


def hand(statements, solution, n=3):
    sp = ["k%d" % (i + 1) for i in range(n)]
    p = {"format": 1, "kind": "knights", "size": n, "speakers": sp, "solution": solution, "statements": [dict(s, id="t%d" % (i + 1)) for i, s in enumerate(statements)]}
    return text.fill(p)


HAND = [
    {"speaker": "k1", "claim": {"type": "knave", "who": "k2"}},
    {"speaker": "k2", "claim": {"type": "knight", "who": "k3"}},
    {"speaker": "k3", "claim": {"type": "diff", "a": "k1", "b": "k2"}},
]
HAND_SOLUTION = {"k1": "knave", "k2": "knight", "k3": "knight"}


def check_sound(p, band):
    K.verify_knights(p)
    for i in range(len(p["statements"])):
        rest = p["statements"][:i] + p["statements"][i + 1:]
        only_one = sum(1 for t in p["statements"] if t["speaker"] == p["statements"][i]["speaker"]) == 1  # a speaker's only statement stays (VNO-26)
        assert only_one or not rest or K.count_solutions(p, 2, statements=rest) != 1, "statement %s is not needed (seed %s %s)" % (p["statements"][i]["id"], p["seed"], band)
    res = K.deduce(p)
    assert res["solved"] and K.band_of(res) == band, (p["seed"], band, res["rules"])
    splits = res["splits"]
    assert (splits == 0) if band == "easy" else (splits == 1) if band == "medium" else (splits >= 2)
    for t in text.all_sentences(p):
        assert text.safe_text(t), t
    assert set(p["text"]) == {s["id"] for s in p["statements"]} | {"intro"}


def test_soundness_200_seeds_per_band_and_size():
    count = 0
    for size in (3, 4, 5):
        for band in BANDS:
            for seed in range(1, 201):
                p = generate("knights", size, seed, band)
                check_sound(p, band)
                count += 1
    print("  %d Knights and Knaves puzzles, all unique, found without guessing, minimal and in their band" % count)


def test_every_speaker_has_a_statement():
    """VNO-26: a silent speaker is not a clue the text can explain, so every speaker says something (seed 517353379 left one silent)."""
    count = 0
    for size in (2, 3, 4, 5):
        for band in BANDS:
            if size == 2 and band == "hard":
                continue
            for seed in [517353379] + list(range(1, 61)):
                p = generate("knights", size, seed, band)
                assert {s["speaker"] for s in p["statements"]} == set(p["speakers"]), (size, band, seed)
                count += 1
    print("  %d puzzles, every speaker has a statement" % count)


def test_two_speakers_easy_and_medium_and_no_hard_one():
    for band in ("easy", "medium"):
        for seed in range(1, 60):
            check_sound(generate("knights", 2, seed, band), band)
    try:
        generate("knights", 2, 1, "hard")
    except PuzzleError as e:
        assert "no hard knights puzzle" in str(e)
    else:
        raise AssertionError("expected a PuzzleError")


def test_determinism_and_errors():
    for band in BANDS:
        assert json.dumps(generate("knights", 4, 9, band), sort_keys=True) == json.dumps(generate("knights", 4, 9, band), sort_keys=True)
    for bad in (lambda: generate("knights", 6, 1, "easy"), lambda: generate("knights", 1, 1, "easy"), lambda: generate("knights", 3, 1, "extreme")):
        try:
            bad()
        except PuzzleError:
            continue
        raise AssertionError("expected a PuzzleError")


def test_a_hand_made_puzzle_has_one_solution_found_with_one_split():
    p = hand(HAND, HAND_SOLUTION)
    assert K.count_solutions(p, 5) == 1
    r = K.deduce(p)
    assert r["solved"] and r["splits"] == 1 and K.band_of(r) == "medium"
    assert [(s["rule"], s["who"], s["value"]) for s in r["steps"]] == [("split", "k1", "knave"), ("direct", "k2", "knight"), ("direct", "k3", "knight")]
    assert r["steps"][0]["contradicts"] == "knight" and r["steps"][0]["statement"] == "t3"
    proof = solve(p)
    assert proof["unique"] and proof["deducible"] and proof["band"] == "medium"


def test_an_ambiguous_puzzle_has_two_solutions():
    p = hand([{"speaker": "k1", "claim": {"type": "same", "a": "k1", "b": "k2"}}], {"k1": "knight", "k2": "knight"}, n=2)
    assert K.count_solutions(p, 5) == 2
    assert not solve(p)["unique"]
    assert not K.deduce(p)["solved"]


def test_an_inconsistent_puzzle_is_refused():
    p = hand([{"speaker": "k1", "claim": {"type": "knave", "who": "k1"}}], {"k1": "knight", "k2": "knight"}, n=2)
    assert K.count_solutions(p, 5) == 0
    assert not solve(p)["unique"]
    for bad in (dict(p, speakers=["k1"]), dict(p, statements=[dict(p["statements"][0], speaker="k9")]), dict(p, solution={"k1": "wizard", "k2": "knight"})):
        try:
            K.validate_knights(bad)
        except PuzzleError:
            continue
        raise AssertionError("expected a PuzzleError")


def test_every_claim_type_has_a_sentence_without_markup():
    p = hand(HAND, HAND_SOLUTION)
    nm = p["names"]
    claims = [
        {"type": "knight", "who": "k1"},
        {"type": "knave", "who": "k2"},
        {"type": "same", "a": "k1", "b": "k2"},
        {"type": "diff", "a": "k1", "b": "k3"},
        {"type": "some_knave", "of": ["k1", "k2", "k3"]},
        {"type": "some_knave", "of": ["k1", "k2"]},
        {"type": "all_knight", "of": ["k2", "k3"]},
        {"type": "exactly", "k": 1, "of": ["k1", "k2", "k3"]},
        {"type": "exactly", "k": 2, "of": ["k1", "k2"]},
        {"type": "not", "c": {"type": "knight", "who": "k1"}},
        {"type": "and", "a": {"type": "knight", "who": "k1"}, "b": {"type": "same", "a": "k2", "b": "k3"}},
        {"type": "or", "a": {"type": "knave", "who": "k1"}, "b": {"type": "knave", "who": "k2"}},
    ]
    sentences = [K.claim_text(p, c, nm) for c in claims]
    assert all(text.safe_text(s) and s for s in sentences), sentences
    assert sentences[4] == "At least one of us is a knave"
    assert sentences[5] == "At least one of Aldo and Brin is a knave"
    assert sentences[7] == "Exactly 1 of us is a knight"
    assert sentences[8] == "Exactly 2 of Aldo and Brin are knights"
    assert K.statement_text(p, {"speaker": "k1", "claim": claims[2]}, nm) == 'Aldo says: "Aldo and Brin are the same kind."'
    # the truth of every claim type
    a = {"k1": True, "k2": False, "k3": True}
    truth = [K.claim_true(c, a) for c in claims]
    assert truth == [True, True, False, False, True, True, False, False, False, False, False, True], truth


def test_play_helpers_and_hints():
    p = generate("knights", 4, 3, "medium")
    sol = dict(p["solution"])
    assert play.check_solution(p, sol) == {"correct": True, "wrong": []}
    wrong = dict(sol)
    k = p["speakers"][0]
    wrong[k] = "knave" if sol[k] == "knight" else "knight"
    r = play.check_solution(p, wrong)
    assert not r["correct"] and r["wrong"] == [k]
    assert play.check_solution(p, {})["wrong"] == p["speakers"]
    assert play.check_marks(p, wrong) == [k]
    assert play.is_complete(p, sol) and not play.is_complete(p, wrong)
    h = hint(p, {})
    assert h["kind"] == "step" and h["cell"] == p["steps"][0]["who"] and text.safe_text(h["text"])
    assert hint(p, wrong)["kind"] == "wrong" and hint(p, wrong)["text"] == "Look again at %s." % p["names"][k]
    assert hint(p, sol)["kind"] == "accuse"
    marks = {}
    for _ in range(len(p["steps"]) + 1):
        h = hint(p, marks)
        if h["kind"] == "accuse":
            break
        marks[h["cell"]] = next(s["value"] for s in p["steps"] if s["who"] == h["cell"])
        assert play.check_marks(p, marks) == []
    assert hint(p, marks)["kind"] == "accuse"
    # marks are cycled with the generic helper and never changed in place
    m = {}
    assert play.set_mark(m, "k1", "knight") == {"k1": "knight"} and m == {}


def read_back(p, names=None):
    nm = names or p["names"]

    def conv(c):
        t = c["type"]
        if t in ("knight", "knave"):
            return {"type": t, "who": nm[c["who"]]}
        if t in ("same", "diff"):
            return {"type": t, "a": nm[c["a"]], "b": nm[c["b"]]}
        if t in ("some_knave", "all_knight"):
            return {"type": t, "of": [nm[x] for x in c["of"]]}
        if t == "exactly":
            return {"type": t, "k": c["k"], "of": [nm[x] for x in c["of"]]}
        if t == "not":
            return {"type": t, "c": conv(c["c"])}
        return {"type": t, "a": conv(c["a"]), "b": conv(c["b"])}

    return [{"id": s["id"], "speaker": nm[s["speaker"]], "claim": conv(s["claim"])} for s in p["statements"]]


def test_flavour_check_passes_a_faithful_read_back_and_catches_changes():
    p = generate("knights", 4, 5, "hard")
    rb = read_back(p)
    assert check_text(p, rb, p["text"]) == {"ok": True, "problems": [], "differing": []}
    assert check_text(p, read_back(p, {k: k for k in p["speakers"]}), p["text"])["ok"]  # ids are accepted too
    # a paraphrase keeps the names and the meaning
    assert check_text(p, rb, {k: "They said so: " + v for k, v in p["text"].items()})["ok"]
    # a flipped claim type, another person, another speaker, a missing statement, a name that is not there, a name the prose lacks
    flipped = copy.deepcopy(rb)
    c = flipped[0]["claim"]
    if c["type"] in ("knight", "knave"):
        c["type"] = "knave" if c["type"] == "knight" else "knight"
    elif c["type"] in ("same", "diff"):
        c["type"] = "same" if c["type"] == "diff" else "diff"
    else:
        flipped[0]["claim"] = {"type": "not", "c": c}
    bad = check_text(p, flipped, p["text"])
    assert not bad["ok"] and bad["differing"] == [p["statements"][0]["id"]], bad
    other = copy.deepcopy(rb)
    other[0]["speaker"] = next(n for n in p["names"].values() if n != other[0]["speaker"])
    assert not check_text(p, other, p["text"])["ok"]
    assert "gave no statement" in check_text(p, rb[1:], p["text"])["problems"][0]["problem"]
    unknown = copy.deepcopy(rb)
    unknown[0]["speaker"] = "Zorro"
    assert "not a speaker" in check_text(p, unknown, p["text"])["problems"][0]["problem"]
    thin = dict(p["text"])
    thin[p["statements"][0]["id"]] = "Somebody said something."
    assert "which the prose does not contain" in check_text(p, rb, thin)["problems"][0]["problem"]
    assert "unknown claim type" in check_text(p, [dict(rb[0], claim={"type": "wizard"})] + rb[1:], p["text"])["problems"][0]["problem"]


def test_flavour_check_a_claim_that_means_the_same_in_another_form_passes():
    p = hand(HAND, HAND_SOLUTION)
    rb = read_back(p)
    # "k1 and k2 are different" is the same claim read as "k2 and k1 are different" and as "not the same"
    rb[2]["claim"] = {"type": "diff", "a": p["names"]["k2"], "b": p["names"]["k1"]}
    assert check_text(p, rb)["ok"]
    rb[2]["claim"] = {"type": "not", "c": {"type": "same", "a": p["names"]["k1"], "b": p["names"]["k2"]}}
    assert check_text(p, rb)["ok"]


def test_render_text_for_new_names_and_the_cli():
    import subprocess

    p = generate("knights", 3, 4, "medium")
    from vno_puzzles import render_text

    core = {k: v for k, v in p.items() if k not in ("names", "text")}
    r = render_text(core, {"k1": "Anna", "k2": "Ben", "k3": "Cy"})
    assert r["names"]["k1"] == "Anna" and "Aldo" not in " ".join(r["text"].values())
    cli = os.path.join(PACKAGES, "vno_puzzles", "cli.py")
    out = subprocess.run([sys.executable, "-I", cli, "generate", "--kind", "knights", "--size", "4", "--seed", "3", "--band", "hard"], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    q = json.loads(out.stdout)
    assert q["kind"] == "knights" and q == generate("knights", 4, 3, "hard")
    solved = json.loads(subprocess.run([sys.executable, "-I", cli, "solve"], input=out.stdout, capture_output=True, text=True).stdout)
    assert solved["unique"] and solved["deducible"] and solved["band"] == "hard"
    checked = json.loads(subprocess.run([sys.executable, "-I", cli, "check"], input=json.dumps({"puzzle": q, "marks": q["solution"]}), capture_output=True, text=True).stdout)
    assert checked["solution"] == {"correct": True, "wrong": []}


def test_speed_100_puzzles_under_5_seconds():
    t0 = time.time()
    for i in range(100):
        generate("knights", 3 + i % 3, 5000 + i, BANDS[i % 3])
    took = time.time() - t0
    print("  100 knights puzzles: %.2f s" % took)
    assert took < 5


def main():
    names = sorted(n for n in globals() if n.startswith("test_") and callable(globals()[n]))
    failed = 0
    for n in names:
        t0 = time.time()
        try:
            globals()[n]()
            print("ok   %s (%.2f s)" % (n, time.time() - t0))
        except Exception:
            failed += 1
            print("FAIL %s" % n)
            traceback.print_exc()
    print("%d test(s), %d failed, Python %s" % (len(names), failed, sys.version.split()[0]))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
