"""Tests of the testimony kind (plain functions with assert, like test_knights.py)."""

import copy
import json
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
PACKAGES = os.path.normpath(os.path.join(HERE, "..", "..", "templates", "puzzles", "game", "python-packages"))
sys.path.insert(0, PACKAGES)

from vno_puzzles import check_text, generate, hint, solve  # noqa: E402
from vno_puzzles import testimony as T  # noqa: E402
from vno_puzzles.model import PuzzleError  # noqa: E402

BANDS = ("easy", "medium", "hard")


def test_every_band_is_sound():
    for band in BANDS:
        for seed in range(200):
            p = generate("testimony", None, seed, band)
            r = solve(p)
            assert r["unique"] and r["deducible"], (band, seed)
            assert r["band"] == band, (band, seed, r["band"])
            found = T.clashes(p)
            assert len(found) == 1 and found[0]["statement"] == p["solution"]["statement"] and found[0]["evidence"] == p["solution"]["evidence"]


def test_press_is_needed_from_medium():
    for seed in range(40):
        assert generate("testimony", None, seed, "easy")["solution"]["press"] is False
        assert generate("testimony", None, seed, "medium")["solution"]["press"] is True


def test_generation_is_deterministic_and_fast():
    t0 = time.time()
    a = generate("testimony", None, 7, "hard")
    assert json.dumps(a, sort_keys=True) == json.dumps(generate("testimony", None, 7, "hard"), sort_keys=True)
    for s in range(100):
        generate("testimony", None, s, "medium")
    assert time.time() - t0 < 3


def test_two_clashes_or_none_is_refused():
    p = generate("testimony", None, 3, "medium")
    # a second piece of evidence that also shows the liar's key with the true value: two clashes
    bad = copy.deepcopy(p)
    liar = next(e for e in bad["evidence"] if e["id"] == p["solution"]["evidence"])
    dup = copy.deepcopy(liar)
    dup["id"] = "e9"
    bad["evidence"].append(dup)
    assert solve(bad)["unique"] is False
    try:
        T.verify_testimony(bad)
        raise AssertionError("two clashes must be refused")
    except PuzzleError:
        pass
    none = copy.deepcopy(p)
    none["evidence"] = [e for e in none["evidence"] if e["id"] != p["solution"]["evidence"]]
    none["solution"]["evidence"] = none["evidence"][0]["id"]
    assert solve(none)["solutions"] == 0


def test_solution_must_name_the_clash():
    p = generate("testimony", None, 5, "medium")
    bad = copy.deepcopy(p)
    other = next(e["id"] for e in bad["evidence"] if e["id"] != p["solution"]["evidence"])
    bad["solution"]["evidence"] = other
    assert solve(bad)["deducible"] is False


def test_unknown_values_are_refused():
    p = generate("testimony", None, 5, "easy")
    bad = copy.deepcopy(p)
    bad["statements"][0]["claims"][0]["value"] = "not-a-value"
    try:
        solve(bad)
        raise AssertionError("an unknown value must be refused")
    except PuzzleError:
        pass


def test_present_and_press():
    p = generate("testimony", None, 4, "medium")
    sol = p["solution"]
    other = next(e["id"] for e in p["evidence"] if e["id"] != sol["evidence"])
    assert T.check_present(p, sol["statement"], other, [])["result"] == "wrong"
    assert T.check_present(p, sol["statement"], sol["evidence"], [])["result"] == "press_first"
    assert T.check_present(p, sol["statement"], sol["evidence"], [sol["statement"]])["result"] == "correct"
    wrong_statement = next(s["id"] for s in p["statements"] if s["id"] != sol["statement"])
    assert T.check_present(p, wrong_statement, sol["evidence"], [wrong_statement])["result"] == "wrong"
    easy = generate("testimony", None, 4, "easy")
    assert T.check_present(easy, easy["solution"]["statement"], easy["solution"]["evidence"], [])["result"] == "correct"


def test_hints_give_more_each_time():
    p = generate("testimony", None, 4, "medium")
    marks = {}
    texts = [hint(p, marks, n)["text"] for n in range(4)]
    assert len(set(texts)) >= 3, texts
    assert p["names"][p["solution"]["evidence"]] in texts[3]
    assert p["solution"]["statement"][1:] in texts[3]


def test_text_names_are_unique_and_prose_is_complete():
    for seed in range(60):
        p = generate("testimony", None, seed, "hard")
        assert len(set(p["names"].values())) == len(p["names"]), p["names"]
        for s in p["statements"]:
            assert s["id"] in p["text"]
            assert ((s["id"] + ".press") in p["text"]) == bool(s.get("press"))
        for e in p["evidence"]:
            assert e["id"] in p["text"]


def read_back(p):
    out = []
    for s in p["statements"]:
        out.append({"id": s["id"], "claims": s["claims"]})
        if s.get("press"):
            out.append({"id": s["id"] + ".press", "claims": s["press"]["claims"]})
    for e in p["evidence"]:
        out.append({"id": e["id"], "facts": e["facts"]})
    return out


def test_flavour_check_accepts_the_truth_and_catches_a_slip():
    p = generate("testimony", None, 9, "medium")
    r = check_text(p, read_back(p), p["text"])
    assert r["ok"], r
    rb = read_back(p)
    ev = next(x for x in rb if x["id"] == p["solution"]["evidence"])
    key = ev["facts"][0]["key"]
    vals = next(k["values"] for k in p["keys"] if k["key"] == key)
    ev["facts"] = [{"key": key, "value": next(v for v in vals if v != ev["facts"][0]["value"])}]
    bad = check_text(p, rb, p["text"])
    assert not bad["ok"] and p["solution"]["evidence"] in bad["differing"], bad
    # a reader who left a line out
    short = [x for x in read_back(p) if x["id"] != "t1"]
    assert not check_text(p, short, p["text"])["ok"]


def test_flavour_check_catches_a_new_clash():
    p = generate("testimony", None, 12, "easy")
    rb = read_back(p)
    # the reader turned a true claim of another statement into a second clash
    for s in p["statements"]:
        if s["id"] == p["solution"]["statement"]:
            continue
        c = s["claims"][0]
        for e in p["evidence"]:
            for f in e["facts"]:
                if f["key"] == c["key"] and f["value"] == c["value"]:
                    vals = next(k["values"] for k in p["keys"] if k["key"] == c["key"])
                    x = next(r for r in rb if r["id"] == s["id"])
                    x["claims"] = [{"key": c["key"], "value": next(v for v in vals if v != c["value"])}]
                    r = check_text(p, rb, p["text"])
                    assert not r["ok"], r
                    return
    raise AssertionError("no near miss to turn into a clash in this seed")


def test_fixture_is_current():
    path = os.path.join(HERE, "..", "fixtures", "puzzles", "testimony-medium-4.json")
    with open(path, encoding="utf-8") as f:
        fixed = json.load(f)
    fresh = generate("testimony", None, 4, "medium")
    assert json.loads(json.dumps(fresh)) == fixed


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
