"""The puzzle data format (version 1) and the helpers that read it.

A puzzle is plain JSON-shaped data: dicts, lists, strings and ints. No classes in saved state. Ren'Py saves and rolls back plain data
kept in `default` variables, and the same data goes to and from the engine as JSON. Items are abstract ids (`s1`, `w2`, `p3`); names and
sentences are a separate layer (`names`, `text`), so a model can rename without touching the logic.
"""

import itertools

FORMAT = 1

#: The rules of the deduction solver, cheapest first, with their weight in the difficulty score.
RULES = ("clue", "elim", "last", "either", "order", "trans")
WEIGHTS = {"clue": 1, "elim": 1, "last": 2, "either": 2, "order": 2, "trans": 3}
BANDS = ("easy", "medium", "hard")
#: The rules each band's puzzles are meant to be solved with (easy uses no either or trans step).
EASY_RULES = ("clue", "elim", "last")


class PuzzleError(ValueError):
    """The puzzle data is wrong, or no puzzle could be made."""


def categories(p):
    """The category keys in order. The first is the person category."""
    return [c["key"] for c in p["categories"]]


def items_of(p, key):
    for c in p["categories"]:
        if c["key"] == key:
            return list(c["items"])
    raise PuzzleError("no category %r" % (key,))


def category_index(p):
    """item -> index of its category."""
    out = {}
    for i, c in enumerate(p["categories"]):
        for it in c["items"]:
            out[it] = i
    return out


def category_key_of(p, item):
    return p["categories"][category_index(p)[item]]["key"]


def cell_key(p, a, b):
    """The key of the cell of two items from different categories: `a|b` with the earlier category first."""
    idx = category_index(p)
    if idx[a] == idx[b]:
        raise PuzzleError("%s and %s are in the same category" % (a, b))
    return "%s|%s" % (a, b) if idx[a] < idx[b] else "%s|%s" % (b, a)


def cell_items(key):
    a, b = key.split("|")
    return a, b


def all_cells(p):
    """Every cell key of the grid, block by block."""
    cats = p["categories"]
    out = []
    for i in range(len(cats)):
        for j in range(i + 1, len(cats)):
            for a in cats[i]["items"]:
                for b in cats[j]["items"]:
                    out.append("%s|%s" % (a, b))
    return out


def owners_of(p):
    """item -> the person (an item of the first category) it belongs to in the solution."""
    people = p["categories"][0]["items"]
    out = {s: s for s in people}
    for s in people:
        for c in p["categories"][1:]:
            out[p["solution"][s][c["key"]]] = s
    return out


def ordinal_items(p):
    """The items of the ordinal category (ages, months ...) in order, or None when the puzzle has none."""
    ordinal = p.get("ordinal")
    if not ordinal:
        return None
    for c in p["categories"]:
        if c["key"] == ordinal["category"]:
            return list(c["items"])
    raise PuzzleError("no ordinal category %r" % (ordinal["category"],))


def _pos(owner, ordinal, item):
    person = owner[item]
    for i, o in enumerate(ordinal):
        if owner[o] == person:
            return i
    raise PuzzleError("%s has no place in the ordinal category" % item)


def clue_true(clue, owner, ordinal=None):
    """Is the clue true when `owner` maps every item to its person? `ordinal`: the items of the ordinal category, for order clues."""
    t = clue["type"]
    if t == "is":
        return owner[clue["a"]] == owner[clue["b"]]
    if t == "not":
        return owner[clue["a"]] != owner[clue["b"]]
    if t == "either":
        return any(owner[clue["a"]] == owner[b] for b in clue["b"])
    if t == "neither":
        return all(owner[clue["a"]] != owner[b] for b in clue["b"])
    if t == "oneof":
        a1, a2 = clue["a"]
        b1, b2 = clue["b"]
        return (owner[a1] == owner[b1] and owner[a2] == owner[b2]) or (owner[a1] == owner[b2] and owner[a2] == owner[b1])
    if t in ("before", "after", "apart"):
        if not ordinal:
            raise PuzzleError("an order clue needs an ordinal category")
        pa, pb = _pos(owner, ordinal, clue["a"]), _pos(owner, ordinal, clue["b"])
        if t == "before":
            return pa < pb
        if t == "after":
            return pa > pb
        return abs(pa - pb) == clue["n"]
    raise PuzzleError("unknown clue type %r" % (t,))


def clue_items(clue):
    """Every item a clue names (a and b may each be one item or a list)."""
    out = []
    for key in ("a", "b"):
        v = clue[key]
        out.extend(v if isinstance(v, (list, tuple)) else [v])
    return out


def answer_of(p):
    """The culprit: the person who was at the murder place, with their weapon and the place."""
    place = p["murder"]["place"]
    for s in p["categories"][0]["items"]:
        if p["solution"][s]["place"] == place:
            row = {"suspect": s, "weapon": p["solution"][s]["weapon"], "place": place}
            if "motive" in p["solution"][s]:
                row["motive"] = p["solution"][s]["motive"]
            return row
    raise PuzzleError("nobody was at the murder place")


def all_owner_maps(p):
    """Every way to give each item of the other categories to a person: (n!) ** (categories - 1) maps, as item -> person dicts."""
    cats = p["categories"]
    people = list(cats[0]["items"])
    perms = [list(itertools.permutations(people)) for _ in cats[1:]]
    out = []
    for combo in itertools.product(*perms):
        owner = {s: s for s in people}
        for c, perm in zip(cats[1:], combo):
            for item, person in zip(c["items"], perm):
                owner[item] = person
        out.append(owner)
    return out


def validate(p):
    """Raises PuzzleError when the data is not a well-formed puzzle (shape, solution, clue items)."""
    if p.get("format") != FORMAT:
        raise PuzzleError("unknown puzzle format %r" % (p.get("format"),))
    cats = p.get("categories") or []
    if len(cats) < 3:
        raise PuzzleError("a puzzle has at least 3 categories")
    n = len(cats[0]["items"])
    seen = set()
    for c in cats:
        if len(c["items"]) != n:
            raise PuzzleError("every category needs %d items" % n)
        for it in c["items"]:
            if it in seen:
                raise PuzzleError("item %s is listed twice" % it)
            seen.add(it)
    for s in cats[0]["items"]:
        row = p["solution"].get(s)
        if row is None:
            raise PuzzleError("no solution for %s" % s)
        for c in cats[1:]:
            if row.get(c["key"]) not in c["items"]:
                raise PuzzleError("the solution of %s has no valid %s" % (s, c["key"]))
    for c in cats[1:]:
        used = [p["solution"][s][c["key"]] for s in cats[0]["items"]]
        if len(set(used)) != n:
            raise PuzzleError("each %s must be used once" % c["key"])
    for clue in p["clues"]:
        for it in clue_items(clue):
            if it not in seen:
                raise PuzzleError("clue %s names the unknown item %s" % (clue.get("id"), it))
