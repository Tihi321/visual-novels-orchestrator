"""The flavour check: does the prose still mean the same constraints?

A model writes names and one prose sentence per clue. A second, separate model reads only the prose and the names (never the structured
clue) and writes each clue back as structured data. `check_text` compares that read-back with the original clue: over every assignment the
two must be true in exactly the same ones. Then the read-back set must still give one solution, solvable by deduction.

This module checks the grid kinds (Murdle, logic grids); Knights and Knaves and testimony have their own (`knights.py`, `testimony.py`).
"""

from .model import clue_items, clue_true, ordinal_items, validate
from .solver import count_solutions, deduce

_ORDER = ("before", "after", "apart")


def _norm(s):
    return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in str(s)).split())


def _name_to_item(p):
    out = {}
    for item, name in p["names"].items():
        out[_norm(name)] = item
        out[_norm(item)] = item
    for item, phrase in (p.get("descr") or {}).items():
        out.setdefault(_norm(phrase), item)
    return out


def _item(table, name):
    return table.get(_norm(name))


def _equivalent(p, c1, c2):
    """True when two clues are true in exactly the same assignments. Only the items they name matter (and the ordinal category for an
    order clue), so the assignments of those are enumerated, each category using each person once at most."""
    ordinal = ordinal_items(p)
    items = []
    for it in clue_items(c1) + clue_items(c2) + (ordinal if (ordinal and (c1["type"] in _ORDER or c2["type"] in _ORDER)) else []):
        if it not in items:
            items.append(it)
    cat = {}
    for ci, c in enumerate(p["categories"]):
        for it in c["items"]:
            cat[it] = ci
    people = list(p["categories"][0]["items"])
    free = [it for it in items if cat[it] != 0]
    owner = {s: s for s in people}
    used = {}

    def rec(i):
        if i == len(free):
            return clue_true(c1, owner, ordinal) == clue_true(c2, owner, ordinal)
        it = free[i]
        taken = used.setdefault(cat[it], set())
        for person in people:
            if person in taken:
                continue
            taken.add(person)
            owner[it] = person
            ok = rec(i + 1)
            taken.discard(person)
            if not ok:
                return False
        owner.pop(it, None)
        return True

    return rec(0)


def _shape(clue):
    """(a is a list, b is a list) for a clue type."""
    t = clue["type"]
    if t in ("either", "neither"):
        return (False, True)
    if t == "oneof":
        return (True, True)
    return (False, False)


def check_grid_text(p, read_back, text=None):
    """{ok, problems, differing}: `read_back` is a list of {id, type, a, b[, n]} written by a reader of the prose (names, or ids).

    `text` (clue id -> prose) turns on the cheap check first: every name the reader used must appear in that clue's prose.
    """
    validate(p)
    table = _name_to_item(p)
    by_id = {r.get("id"): r for r in read_back}
    problems = []
    differing = []
    rebuilt = []

    def bad(clue, problem):
        problems.append({"clue": clue["id"], "problem": problem})
        differing.append(clue["id"])

    for clue in p["clues"]:
        r = by_id.get(clue["id"])
        if r is None:
            bad(clue, "the reader gave no clue for this one")
            continue
        if r.get("type") not in ("is", "not", "either", "neither", "oneof", "before", "after", "apart"):
            bad(clue, "unknown clue type %r" % (r.get("type"),))
            continue
        if r["type"] in _ORDER and not ordinal_items(p):
            bad(clue, "this puzzle has no order: %r is not a clue type here" % (r["type"],))
            continue
        a_list, b_list = _shape(r)
        ra, rb = r.get("a"), r.get("b")
        if isinstance(ra, (list, tuple)) != a_list or isinstance(rb, (list, tuple)) != b_list or (a_list and len(ra) != 2) or (b_list and len(rb) != 2):
            bad(clue, "a %s clue needs %s and %s" % (r["type"], "two items for a" if a_list else "one item for a", "two items for b" if b_list else "one item for b"))
            continue
        if r["type"] == "apart" and not isinstance(r.get("n"), int):
            bad(clue, "an apart clue needs the number n")
            continue
        names = list(ra) if a_list else [ra]
        names += list(rb) if b_list else [rb]
        ids = [_item(table, n) for n in names]
        unknown = [n for n, i in zip(names, ids) if i is None]
        if unknown:
            bad(clue, "the reader used %s, which is not a name of this puzzle" % ", ".join(repr(n) for n in unknown))
            continue
        if text is not None and clue["id"] in text:
            prose = _norm(text[clue["id"]])
            def appears(n):
                it = _item(table, n)
                forms = [n, p["names"].get(it, ""), (p.get("descr") or {}).get(it, "")]
                return any(_norm(f) and _norm(f) in prose for f in forms)

            missing = [n for n in names if not appears(n)]
            if missing:
                bad(clue, "the reader named %s, which the prose does not contain" % ", ".join(repr(n) for n in missing))
                continue
        k = 2 if a_list else 1
        back = {"id": clue["id"], "type": r["type"], "a": ids[:2] if a_list else ids[0], "b": ids[k:k + 2] if b_list else ids[k]}
        if r["type"] == "apart":
            back["n"] = r["n"]
        if (b_list and len(set(ids[k:k + 2])) != 2) or (a_list and len(set(ids[:2])) != 2):
            bad(clue, "the two options of this clue must differ")
            continue
        try:
            same = _equivalent(p, clue, back)
        except (KeyError, TypeError):
            same = False
        if not same:
            bad(clue, "the prose means something else than the clue (%s read back as %s)" % (clue["type"], r["type"]) if clue["type"] != r["type"] else "the prose means something else than the clue (other items)")
            continue
        rebuilt.append(back)
    if not problems:
        q = dict(p, clues=rebuilt)
        if count_solutions(q, 2) != 1:
            problems.append({"clue": "", "problem": "the read-back clues do not give exactly one solution"})
        elif not deduce(q)["solved"]:
            problems.append({"clue": "", "problem": "the read-back clues cannot be solved by deduction alone"})
    return {"ok": not problems, "problems": problems, "differing": differing}


def check_text(p, read_back, text=None):
    """The flavour check of any puzzle kind (see the module docstring)."""
    kind = p.get("kind", "murdle")
    if kind == "knights":
        from .knights import check_knights_text

        return check_knights_text(p, read_back, text)
    if kind == "testimony":
        from .testimony import check_testimony_text

        return check_testimony_text(p, read_back, text)
    return check_grid_text(p, read_back, text)
