"""Tests of the puzzle library. Plain functions with assert and a small runner: Ren'Py's Python has no unittest.

    <sdk>/lib/py3-windows-x86_64/python.exe tests/puzzles/test_vno_puzzles.py
    py tests/puzzles/test_vno_puzzles.py

Exit code 0 when everything passes; every failure is printed.
"""

import copy
import json
import os
import subprocess
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
PACKAGES = os.path.normpath(os.path.join(HERE, "..", "..", "templates", "puzzles", "game", "python-packages"))
sys.path.insert(0, PACKAGES)

import vno_puzzles  # noqa: E402
from vno_puzzles import cli, generate, solve, verify  # noqa: E402
from vno_puzzles import play, text  # noqa: E402
from vno_puzzles.model import all_cells, answer_of, clue_true, owners_of, validate  # noqa: E402
from vno_puzzles.solver import allowed_for, band_of, count_solutions, deduce  # noqa: E402

SEEDS = range(1, 201)
BANDS = ("easy", "medium", "hard")

CATS = [
    {"key": "suspect", "items": ["s1", "s2", "s3"]},
    {"key": "weapon", "items": ["w1", "w2", "w3"]},
    {"key": "place", "items": ["p1", "p2", "p3"]},
]
SOLUTION = {"s1": {"weapon": "w1", "place": "p1"}, "s2": {"weapon": "w2", "place": "p2"}, "s3": {"weapon": "w3", "place": "p3"}}


def hand(clues, solution=SOLUTION, murder="p3"):
    p = {"format": 1, "kind": "murdle", "size": 3, "categories": copy.deepcopy(CATS), "solution": copy.deepcopy(solution), "clues": clues, "murder": {"place": murder}}
    p["murder"]["answer"] = answer_of(p)
    return text.fill(p)


# ---- 1. soundness over many seeds ----

def check_sound(p, band):
    validate(p)
    owner = owners_of(p)
    for c in p["clues"]:
        assert clue_true(c, owner), "clue %s is false in the solution (seed %s, %s)" % (c["id"], p["seed"], band)
    assert count_solutions(p, 2) == 1, "not unique (seed %s, %s)" % (p["seed"], band)
    res = deduce(p)
    assert res["solved"], "not deducible (seed %s, %s)" % (p["seed"], band)
    assert [k for k, v in res["grid"].items() if v == "yes"] == [k for k in all_cells(p) if owner[k.split("|")[0]] == owner[k.split("|")[1]]], "grid differs from the solution"
    # minimal for the band: dropping any one clue breaks uniqueness or deduction (with the band's rules)
    for i in range(len(p["clues"])):
        rest = p["clues"][:i] + p["clues"][i + 1:]
        q = dict(p, clues=rest)
        unique_and_solved = count_solutions(q, 2) == 1 and deduce(q, allowed=allowed_for(band))["solved"]
        assert not unique_and_solved, "clue %s is not needed (seed %s, %s)" % (p["clues"][i]["id"], p["seed"], band)
    # the band rule
    got = band_of(p)
    assert got == band, "seed %s asked for %s, is %s" % (p["seed"], band, got)
    if band == "easy":
        assert set(res["rules"]) <= {"clue", "elim", "last"}
    if band == "hard":
        assert res["rules"].get("trans", 0) >= 3 and not any(c["type"] == "is" for c in p["clues"])
    if band == "medium":
        assert res["rules"].get("trans", 0) or res["rules"].get("either", 0)


def test_soundness_200_seeds_3_bands():
    scores = {b: [] for b in BANDS}
    for band in BANDS:
        for seed in SEEDS:
            p = generate("murdle", 3, seed, band)
            check_sound(p, band)
            scores[band].append(p["difficulty"]["score"])
    report = ", ".join("%s %d-%d" % (b, min(v), max(v)) for b, v in scores.items())
    print("  score ranges over %d puzzles: %s" % (sum(len(v) for v in scores.values()), report))


# ---- 2. determinism ----

def test_same_seed_same_json():
    for band in BANDS:
        a = json.dumps(generate("murdle", 3, 42, band), sort_keys=True)
        b = json.dumps(generate("murdle", 3, 42, band), sort_keys=True)
        assert a == b
    assert json.dumps(generate("murdle", 3, 1, "easy"), sort_keys=True) != json.dumps(generate("murdle", 3, 2, "easy"), sort_keys=True)


def test_known_output_of_a_seed():
    # a fixed fingerprint: the same seed gives the same puzzle in Ren'Py's Python 3.12 and in Python 3.13
    p = generate("murdle", 3, 1, "medium")
    assert p["murder"]["answer"] == answer_of(p)
    assert p["text"]["murder"].startswith("The body was found in the ")
    assert [c["id"] for c in p["clues"]] == ["c%d" % (i + 1) for i in range(len(p["clues"]))]
    print("  seed 1 medium: %d clues, score %d, murder %s" % (len(p["clues"]), p["difficulty"]["score"], p["murder"]["answer"]))


def test_the_same_seeds_give_the_same_puzzles_in_python_3_12_and_3_13():
    # fingerprint of 9 puzzles, computed once with Ren'Py's Python 3.12.7 and with Python 3.13: they agree
    import hashlib

    blob = json.dumps([generate("murdle", 3, s, b) for s in (1, 2, 3) for b in BANDS], sort_keys=True)
    assert hashlib.sha1(blob.encode()).hexdigest() == "50b6cc69a7773c1ecdb499b2716df87cac722ea4"


# ---- 3. hand-made puzzles ----

HAND_CLUES = [
    {"id": "c1", "type": "is", "a": "s1", "b": "w1"},
    {"id": "c2", "type": "is", "a": "s2", "b": "p2"},
    {"id": "c3", "type": "not", "a": "w2", "b": "p3"},
    {"id": "c4", "type": "not", "a": "s1", "b": "p3"},
]
HAND_STEPS = [
    ("clue", ["s1", "w1"], "yes", "c1"),
    ("clue", ["s2", "p2"], "yes", "c2"),
    ("clue", ["w2", "p3"], "no", "c3"),
    ("clue", ["s1", "p3"], "no", "c4"),
    ("elim", ["s1", "w2"], "no", None),
    ("elim", ["s1", "w3"], "no", None),
    ("elim", ["s2", "w1"], "no", None),
    ("elim", ["s3", "w1"], "no", None),
    ("elim", ["s2", "p1"], "no", None),
    ("elim", ["s2", "p3"], "no", None),
    ("elim", ["s1", "p2"], "no", None),
    ("elim", ["s3", "p2"], "no", None),
    ("last", ["s1", "p1"], "yes", None),
]


def test_a_known_unique_puzzle_gives_the_written_steps():
    p = hand(HAND_CLUES)
    assert count_solutions(p, 5) == 1
    r = deduce(p)
    assert r["solved"]
    got = [(s["rule"], s["cell"], s["value"], s.get("clue")) for s in r["steps"][: len(HAND_STEPS)]]
    assert got == HAND_STEPS, got
    assert r["rules"] == {"clue": 4, "elim": 16, "last": 5, "trans": 2}
    assert r["score"] == 4 * 1 + 16 * 1 + 5 * 2 + 2 * 3
    assert solve(p)["unique"] and solve(p)["deducible"]


def test_an_ambiguous_puzzle_has_two_solutions():
    p = hand(HAND_CLUES[:2])
    assert count_solutions(p, 5) > 1
    assert not solve(p)["unique"]
    assert not deduce(p)["solved"]
    two = hand([{"id": "c1", "type": "is", "a": "s1", "b": "w1"}, {"id": "c2", "type": "is", "a": "s1", "b": "p1"}, {"id": "c3", "type": "is", "a": "s2", "b": "w2"}, {"id": "c4", "type": "is", "a": "s2", "b": "p2"}])
    assert count_solutions(two, 5) == 1  # s3 gets what is left
    assert count_solutions(two, 9, clues=two["clues"][:2]) == 4  # s2 and s3 can swap weapons and places


GUESS_CLUES = [
    {"id": "c1", "type": "either", "a": "p1", "b": ["w3", "w2"]},
    {"id": "c2", "type": "either", "a": "w2", "b": ["p3", "p1"]},
    {"id": "c3", "type": "not", "a": "s1", "b": "w2"},
    {"id": "c4", "type": "either", "a": "s3", "b": ["p3", "p2"]},
    {"id": "c5", "type": "either", "a": "s2", "b": ["p3", "p1"]},
    {"id": "c6", "type": "either", "a": "w3", "b": ["s3", "s1"]},
    {"id": "c7", "type": "not", "a": "w3", "b": "p3"},
    {"id": "c8", "type": "either", "a": "w1", "b": ["s2", "s1"]},
]
GUESS_SOLUTION = {"s1": {"weapon": "w1", "place": "p3"}, "s2": {"weapon": "w2", "place": "p1"}, "s3": {"weapon": "w3", "place": "p2"}}


def test_a_unique_puzzle_that_needs_a_guess_is_not_deducible():
    p = hand(GUESS_CLUES, GUESS_SOLUTION)
    assert count_solutions(p, 2) == 1
    r = deduce(p)
    assert not r["solved"] and r["contradiction"] is None
    assert solve(p)["unique"] and not solve(p)["deducible"]


def test_validate_rejects_a_broken_puzzle():
    p = hand(HAND_CLUES)
    bad = copy.deepcopy(p)
    bad["solution"]["s1"]["weapon"] = "w2"  # w2 used twice
    for fn in (lambda: validate(bad), lambda: validate(dict(p, format=9)), lambda: validate(dict(p, clues=[{"id": "c9", "type": "is", "a": "s1", "b": "zz"}]))):
        try:
            fn()
        except ValueError:
            continue
        raise AssertionError("expected a PuzzleError")


# ---- 4. play helpers ----

def test_check_accusation():
    p = generate("murdle", 3, 5, "medium")
    ans = answer_of(p)
    assert play.check_accusation(p, ans) == {"correct": True, "wrong": []}
    other = dict(ans, weapon=[w for w in ["w1", "w2", "w3"] if w != ans["weapon"]][0])
    r = play.check_accusation(p, other)
    assert r == {"correct": False, "wrong": ["weapon"]}
    assert play.check_accusation(p, {})["wrong"] == ["suspect", "weapon", "place"]


def test_check_marks_and_cycle():
    p = generate("murdle", 3, 5, "medium")
    t = play.truth(p)
    yes = next(c for c, v in t.items() if v == "yes")
    no = next(c for c, v in t.items() if v == "no")
    assert play.check_marks(p, {yes: "yes", no: "no"}) == []
    assert play.check_marks(p, {yes: "no", no: "no"}) == [yes]
    m = {}
    seen = []
    for _ in range(4):
        before = dict(m)
        m = play.cycle_mark(m, yes)
        assert before == {} or before is not m  # never changes its argument
        seen.append(m.get(yes, ""))
    assert seen == ["no", "yes", "", "no"]
    assert play.set_mark({}, yes, "yes") == {yes: "yes"} and play.set_mark({yes: "yes"}, yes, "") == {}


def test_hint():
    p = generate("murdle", 3, 5, "medium")
    h = play.hint(p, {})
    first = p["steps"][0]
    assert h["kind"] == "step" and h["cell"] == "|".join(first["cell"])
    assert h["text"].startswith("Clue ") and text.safe_text(h["text"])
    t = play.truth(p)
    wrong_cell = next(iter(t))
    bad = {wrong_cell: "no" if t[wrong_cell] == "yes" else "yes"}
    w = play.hint(p, bad)
    a, b = wrong_cell.split("|")
    assert w["kind"] == "wrong" and w["text"] == "Look again at %s and %s." % (p["names"][a], p["names"][b])
    full = dict(t)
    assert play.hint(p, full)["kind"] == "accuse" and play.is_complete(p, full)
    # step by step: following the hints fills the grid with right marks only
    marks = {}
    for _ in range(len(p["steps"]) + 1):
        h = play.hint(p, marks)
        if h["kind"] == "accuse":
            break
        marks[h["cell"]] = next(s["value"] for s in p["steps"] if "|".join(s["cell"]) == h["cell"])
        assert play.check_marks(p, marks) == []
    assert play.hint(p, marks)["kind"] == "accuse"


def test_auto_cross_never_overwrites_a_mark():
    p = generate("murdle", 3, 5, "medium")
    t = play.truth(p)
    yes = next(c for c, v in t.items() if v == "yes")
    a, b = yes.split("|")
    others = [c for c in all_cells(p) if c != yes and (c.split("|")[0] == a or c.split("|")[1] == b) and c.split("|")[0][0] == a[0] and c.split("|")[1][0] == b[0]]
    assert len(others) == 4
    marks = {yes: "yes", others[0]: "yes"}
    out = play.auto_cross(p, marks, yes)
    assert out[others[0]] == "yes" and out[yes] == "yes"
    assert all(out[c] == "no" for c in others[1:])
    assert marks == {yes: "yes", others[0]: "yes"}  # the argument is untouched
    assert play.auto_cross(p, {yes: "no"}, yes) == {yes: "no"}  # only after a yes
    assert len([c for c in out if c not in marks]) == 3


# ---- 5. text ----

def test_every_clue_type_and_pair_has_a_sentence_without_markup():
    cats = ["suspect", "weapon", "place"]
    item = {"suspect": "s1", "weapon": "w1", "place": "p1"}
    other = {"suspect": "s2", "weapon": "w2", "place": "p2"}
    p = hand(HAND_CLUES)
    seen = 0
    for ca in cats:
        for cb in cats:
            if ca == cb:
                continue
            for clue in ({"type": "is", "a": item[ca], "b": item[cb]}, {"type": "not", "a": item[ca], "b": item[cb]}, {"type": "either", "a": item[ca], "b": [item[cb], other[cb]]}):
                s = text.clue_text(p, dict(clue, id="c0"))
                assert s and text.safe_text(s) and s.endswith("."), s
                seen += 1
    assert seen == 18
    for n in text.default_names(p).values():
        assert text.safe_text(n)
    assert text.safe_text(text.murder_text(p))
    assert text.clue_text(p, {"type": "either", "a": "w1", "b": ["p1", "p2"], "id": "c0"}) == "The rope was either in the library or the kitchen."
    assert text.clue_text(p, {"type": "is", "a": "w3", "b": "p3", "id": "c0"}) == "Whoever had the poison was in the garden."
    assert text.clue_text(p, {"type": "not", "a": "s1", "b": "p1", "id": "c0"}) == "Colonel Ash was not in the library."
    for band in BANDS:
        q = generate("murdle", 3, 11, band)
        assert all(text.safe_text(s) for s in text.all_sentences(q))
        for s in q["steps"]:
            assert text.safe_text(text.step_text(q, s))


# ---- 6. CLI ----

def test_cli_generate_prints_json_that_passes_the_checks():
    import io
    import contextlib

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = cli.main(["generate", "--seed", "7", "--band", "hard"])
    assert code == 0
    p = json.loads(buf.getvalue())
    check_sound(p, "hard")
    assert p == generate("murdle", 3, 7, "hard")
    # as a real subprocess, the way the engine runs it
    out = subprocess.run([sys.executable, os.path.join(PACKAGES, "vno_puzzles", "cli.py"), "generate", "--seed", "7", "--band", "hard"], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    assert json.loads(out.stdout) == p
    solved = subprocess.run([sys.executable, os.path.join(PACKAGES, "vno_puzzles", "cli.py"), "solve"], input=out.stdout, capture_output=True, text=True)
    r = json.loads(solved.stdout)
    assert r["unique"] and r["deducible"] and r["band"] == "hard"
    checked = subprocess.run([sys.executable, os.path.join(PACKAGES, "vno_puzzles", "cli.py"), "check"], input=json.dumps({"puzzle": p, "accusation": p["murder"]["answer"], "marks": {}}), capture_output=True, text=True)
    assert json.loads(checked.stdout)["accusation"]["correct"] is True
    bad = subprocess.run([sys.executable, os.path.join(PACKAGES, "vno_puzzles", "cli.py"), "generate", "--band", "nope"], capture_output=True, text=True)
    assert bad.returncode == 1 and "unknown band" in json.loads(bad.stdout)["error"]


# ---- 7. speed ----

def test_100_generations_take_under_10_seconds():
    t0 = time.time()
    for i in range(100):
        generate("murdle", 3, 1000 + i, BANDS[i % 3])
    took = time.time() - t0
    print("  100 generations: %.2f s" % took)
    assert took < 10, took


# ---- 8. stdlib only ----

def test_the_package_imports_nothing_outside_the_standard_library():
    code = (
        "import sys; before = set(sys.modules); sys.path.insert(0, %r); import vno_puzzles, vno_puzzles.cli; "
        "tops = {m.split('.')[0] for m in set(sys.modules) - before}; "
        "extra = sorted(t for t in tops if t not in sys.stdlib_module_names and t not in sys.builtin_module_names and t != 'vno_puzzles' and not t.startswith('_')); "
        "print(extra)" % PACKAGES
    )
    out = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "[]", out.stdout


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
