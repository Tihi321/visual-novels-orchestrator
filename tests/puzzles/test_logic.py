"""Tests of the logic-grid kind (Puzzle Baron): plain functions with assert, like test_knights.py."""

import copy
import json
import os
import random
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
PACKAGES = os.path.normpath(os.path.join(HERE, "..", "..", "templates", "puzzles", "game", "python-packages"))
sys.path.insert(0, PACKAGES)

from vno_puzzles import check_text, generate, hint, solve  # noqa: E402
from vno_puzzles import play  # noqa: E402
from vno_puzzles.generator import verify  # noqa: E402
from vno_puzzles.model import PuzzleError, clue_true, ordinal_items, owners_of  # noqa: E402
from vno_puzzles.solver import allowed_for, count_solutions, count_solutions_brute, deduce, deduce_fast  # noqa: E402

BANDS = ("easy", "medium", "hard")
SEEDS = {3: 100, 4: 100, 5: 25}


def check_sound(p, band):
    verify(p)
    r = solve(p)
    assert r["unique"] and r["deducible"] and r["band"] == band, (p["seed"], band, r["band"])
    owner, ordinal = owners_of(p), ordinal_items(p)
    assert all(clue_true(c, owner, ordinal) for c in p["clues"])


def test_every_size_and_band_is_sound():
    for size, n in SEEDS.items():
        for band in BANDS:
            for seed in range(n):
                check_sound(generate("logic", size, seed, band), band)


def test_clues_are_minimal_for_the_band():
    from vno_puzzles.logic import _allowed

    for band in BANDS:
        for seed in range(15):
            p = generate("logic", 4, seed, band)
            allowed = _allowed(band)
            for i in range(len(p["clues"])):
                rest = p["clues"][:i] + p["clues"][i + 1:]
                assert not deduce_fast(p, clues=rest, allowed=allowed), "clue %s is not needed (seed %s %s)" % (p["clues"][i]["id"], seed, band)


def test_the_bands_use_their_clue_types():
    for seed in range(20):
        easy = generate("logic", 4, seed, "easy")
        assert not any(c["type"] in ("either", "oneof") for c in easy["clues"])
        assert solve(easy)["rules"].get("trans", 0) == 0
        medium = generate("logic", 4, seed, "medium")
        assert any(c["type"] in ("either", "oneof") for c in medium["clues"])
        assert solve(medium)["rules"].get("trans", 0) == 0
        hard = generate("logic", 4, seed, "hard")
        assert not any(c["type"] == "is" for c in hard["clues"])
        assert solve(hard)["rules"]["trans"] >= hard["hardTrans"]


def test_order_clues_appear_and_use_the_ordinal_category():
    seen = set()
    for seed in range(40):
        for band in BANDS:
            p = generate("logic", 4, seed, band)
            assert p["ordinal"]["category"] == p["categories"][0]["key"]
            seen |= {c["type"] for c in p["clues"]}
    assert {"before", "apart", "neither", "oneof", "either", "not", "is"} <= seen, seen


def test_search_agrees_with_brute_force_on_size_3():
    for seed in range(15):
        p = generate("logic", 3, seed, "medium")
        assert count_solutions(p, 2) == count_solutions_brute(p, 2) == 1
        rng = random.Random(seed)
        some = [c for c in p["clues"] if rng.random() < 0.6]
        assert count_solutions(p, 5, clues=some) == count_solutions_brute(p, 5, clues=some)


def test_an_order_clue_is_not_a_guess():
    # swapping a before into an after makes a different puzzle: uniqueness (or truth) breaks
    p = generate("logic", 4, 5, "easy")
    c = next(c for c in p["clues"] if c["type"] == "before")
    bad = copy.deepcopy(p)
    for x in bad["clues"]:
        if x["id"] == c["id"]:
            x["type"] = "after"
    owner, ordinal = owners_of(bad), ordinal_items(bad)
    assert not clue_true(next(x for x in bad["clues"] if x["id"] == c["id"]), owner, ordinal)
    try:
        verify(bad)
        raise AssertionError("a false clue must be refused")
    except PuzzleError:
        pass


def test_same_seed_same_json_and_speed():
    assert json.dumps(generate("logic", 4, 9, "medium"), sort_keys=True) == json.dumps(generate("logic", 4, 9, "medium"), sort_keys=True)
    t0 = time.time()
    for s in range(20):
        generate("logic", 4, s, "medium")
    assert time.time() - t0 < 10


def test_sizes_and_unknown_bands_are_refused():
    for bad in ((2, "easy"), (6, "easy"), (4, "impossible")):
        try:
            generate("logic", bad[0], 1, bad[1])
            raise AssertionError("must be refused: %r" % (bad,))
        except PuzzleError:
            pass


def test_text_is_complete_and_without_markup():
    for seed in range(20):
        p = generate("logic", 4, seed, "medium")
        assert set(p["text"]) == {c["id"] for c in p["clues"]} | {"intro"}
        assert len(set(p["names"].values())) == len(p["names"])
        for t in list(p["text"].values()) + list(p["names"].values()):
            assert "[" not in t and "{" not in t and "%" not in t, t


def named(p, v):
    return [p["names"][x] for x in v] if isinstance(v, list) else p["names"][v]


def read_back(p):
    out = []
    for c in p["clues"]:
        r = {"id": c["id"], "type": c["type"], "a": named(p, c["a"]), "b": named(p, c["b"])}
        if "n" in c:
            r["n"] = c["n"]
        out.append(r)
    return out


def test_flavour_check_accepts_the_truth_and_catches_order_slips():
    p = generate("logic", 4, 3, "medium")
    assert check_text(p, read_back(p), p["text"])["ok"]
    for kind_from, kind_to in (("before", "after"),):
        c = next((c for c in p["clues"] if c["type"] == kind_from), None)
        if c:
            rb = read_back(p)
            next(r for r in rb if r["id"] == c["id"])["type"] = kind_to
            res = check_text(p, rb, p["text"])
            assert not res["ok"] and c["id"] in res["differing"]
    q = generate("logic", 4, 4, "easy")
    c = next(c for c in q["clues"] if c["type"] == "apart")
    rb = read_back(q)
    next(r for r in rb if r["id"] == c["id"])["n"] = c["n"] + 1
    res = check_text(q, rb, q["text"])
    assert not res["ok"] and c["id"] in res["differing"]


def test_a_paraphrase_that_means_the_same_is_accepted():
    # "a came before b" read back as "b came after a"
    for seed in range(30):
        p = generate("logic", 4, seed, "easy")
        c = next((c for c in p["clues"] if c["type"] == "before"), None)
        if c:
            rb = read_back(p)
            r = next(r for r in rb if r["id"] == c["id"])
            r["type"], r["a"], r["b"] = "after", r["b"], r["a"]
            assert check_text(p, rb, p["text"])["ok"]
            return
    raise AssertionError("no before clue found")


def test_check_solution_and_hints():
    p = generate("logic", 4, 2, "medium")
    truth = play.truth(p)
    assert play.check_solution(p, dict(truth))["correct"]
    marks = {}
    first = hint(p, marks)
    assert first["kind"] == "step" and first["text"]
    wrong = dict(truth)
    cell = next(c for c, v in truth.items() if v == "no")
    wrong[cell] = "yes"
    res = play.check_solution(p, wrong)
    assert not res["correct"] and cell in res["wrong"]
    assert hint(p, wrong)["kind"] == "wrong"


def test_deduction_steps_use_order_rule_for_easy():
    seen = False
    for seed in range(30):
        p = generate("logic", 4, seed, "easy")
        if solve(p)["rules"].get("order", 0):
            seen = True
            step = next(s for s in solve(p)["steps"] if s["rule"] == "order")
            assert "in order" in __import__("vno_puzzles.text", fromlist=["x"]).step_text(p, step)
            break
    assert seen


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
