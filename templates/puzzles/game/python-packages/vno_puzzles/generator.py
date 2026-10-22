"""The generator: `generate(kind, size, seed, band)` makes a puzzle and proves it.

Every puzzle it returns has exactly one solution (brute force), can be solved by deduction alone (no guessing), is minimal for its band
(dropping any one clue breaks uniqueness or deduction), and is in the band asked for. Deterministic: `random.Random(seed)` only.
"""

import random

from .model import BANDS, FORMAT, PuzzleError, answer_of, category_index, clue_true, owners_of, validate
from .solver import allowed_for, band_of, count_solutions, deduce, difficulty
from .text import fill

KEYS = ["suspect", "weapon", "place"]
PREFIX = {"suspect": "s", "weapon": "w", "place": "p"}


def _skeleton(rng, size):
    cats = [{"key": k, "items": ["%s%d" % (PREFIX[k], i + 1) for i in range(size)]} for k in KEYS]
    solution = {}
    weapons = list(cats[1]["items"])
    places = list(cats[2]["items"])
    rng.shuffle(weapons)
    rng.shuffle(places)
    for i, s in enumerate(cats[0]["items"]):
        solution[s] = {"weapon": weapons[i], "place": places[i]}
    return cats, solution


def _pool(rng, cats, owner, band):
    """Every true clue of the solution, shuffled. `is` clues: all for easy, at most one is added later for medium, none for hard."""
    pool = []
    items = [(ci, it) for ci, c in enumerate(cats) for it in c["items"]]
    for x in range(len(items)):
        for y in range(x + 1, len(items)):
            (ci, a), (cj, b) = items[x], items[y]
            if ci == cj:
                continue
            if owner[a] == owner[b]:
                if band != "hard":
                    pool.append({"type": "is", "a": a, "b": b})
            else:
                pool.append({"type": "not", "a": a, "b": b})
    for ci, a in items:
        for cj, c in enumerate(cats):
            if cj == ci:
                continue
            true = [b for b in c["items"] if owner[b] == owner[a]]
            false = [b for b in c["items"] if owner[b] != owner[a]]
            for f in false:
                pair = [true[0], f]
                rng.shuffle(pair)
                pool.append({"type": "either", "a": a, "b": pair})
    rng.shuffle(pool)
    return pool


def _numbered(clues):
    return [dict(c, id="c%d" % (i + 1)) for i, c in enumerate(clues)]


def _with_ids(p, clues):
    q = dict(p)
    q["clues"] = _numbered(clues)
    return q


def _minimal(p, clues, allowed, rng):
    """Drops every clue that is not needed, in random order: unique and (for the band's rules) still deducible without it."""
    keep = list(clues)
    order = list(range(len(keep)))
    rng.shuffle(order)
    gone = set()
    for i in order:
        trial = [c for j, c in enumerate(keep) if j != i and j not in gone]
        q = _with_ids(p, trial)
        if count_solutions(q, 2) == 1 and deduce(q, allowed=allowed)["solved"]:
            gone.add(i)
    return [c for j, c in enumerate(keep) if j not in gone]


def generate(kind="murdle", size=3, seed=0, band="medium", max_tries=200):
    """A 3x3 Murdle puzzle (suspect, weapon, place). Raises PuzzleError naming the seed and band when none is found in `max_tries`."""
    if kind != "murdle":
        raise PuzzleError("unknown puzzle kind %r (phase 1 has murdle)" % (kind,))
    if size != 3:
        raise PuzzleError("phase 1 makes 3x3 puzzles, not %r" % (size,))
    if band not in BANDS:
        raise PuzzleError("unknown band %r (easy, medium or hard)" % (band,))
    rng = random.Random("vno-puzzles:%s:%s:%s" % (kind, seed, band))
    allowed = allowed_for(band)
    for _ in range(max_tries):
        cats, solution = _skeleton(rng, size)
        base = {"format": FORMAT, "kind": kind, "size": size, "seed": seed, "band": band, "categories": cats, "solution": solution}
        owner = owners_of(dict(base, clues=[]))
        pool = _pool(rng, cats, owner, band)
        chosen = []
        got_is = 0
        for c in pool:
            if c["type"] == "is" and band == "medium":
                if got_is:
                    continue
                got_is += 1
            chosen.append(c)
            q = _with_ids(base, chosen)
            if count_solutions(q, 2) == 1 and deduce(q, allowed=allowed)["solved"]:
                break
        else:
            continue
        clues = _minimal(base, chosen, allowed, rng)
        p = _with_ids(base, clues)
        res = deduce(p)
        if not res["solved"] or band_of(p, res) != band:
            continue
        rng.shuffle(clues)
        p = _with_ids(base, clues)
        res = deduce(p)
        if not res["solved"] or band_of(p, res) != band:
            continue
        place = rng.choice(cats[2]["items"])
        p["murder"] = {"place": place}
        p["murder"]["answer"] = answer_of(p)
        p["difficulty"] = difficulty(p, res)
        p["steps"] = res["steps"]
        return fill(p)
    raise PuzzleError("no %s puzzle found for seed %s in %d tries" % (band, seed, max_tries))


def verify(p):
    """The soundness checks of the tests, for one puzzle: raises PuzzleError naming the first thing that fails."""
    validate(p)
    owner = owners_of(p)
    for c in p["clues"]:
        if not clue_true(c, owner):
            raise PuzzleError("clue %s is false in the solution" % c["id"])
    if count_solutions(p, 2) != 1:
        raise PuzzleError("the puzzle does not have exactly one solution")
    res = deduce(p)
    if not res["solved"]:
        raise PuzzleError("the puzzle cannot be solved by deduction alone")
    return res


__all__ = ["generate", "verify", "category_index"]
