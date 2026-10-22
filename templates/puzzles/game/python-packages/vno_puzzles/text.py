"""Canonical English sentences for each clue type, the names of the proof of concept, and the sentences of the hints.

Ren'Py reads `[` as interpolation and `{` as a text tag, so no sentence made here may contain either (names are checked by `safe_text`).
In phase 2 a model writes the names and the prose; these sentences stay as the canonical reading the checker compares against.
"""

from .model import category_key_of, category_index

#: The names of the proof of concept (no Clue or Murdle names).
POC_NAMES = {
    "suspect": ["Colonel Ash", "Doctor Birch", "Miss Cole"],
    "weapon": ["rope", "candlestick", "poison"],
    "place": ["library", "kitchen", "garden"],
}

LABELS = {"suspect": "Suspects", "weapon": "Weapons", "place": "Places"}


def safe_text(s):
    """True when the text has nothing Ren'Py would read as interpolation or a text tag."""
    return "[" not in s and "{" not in s and "%" not in s


def default_names(p):
    """item id -> name for the PoC: the first names of `POC_NAMES` per category, in item order."""
    names = {}
    for c in p["categories"]:
        pool = POC_NAMES.get(c["key"], [])
        for i, it in enumerate(c["items"]):
            names[it] = pool[i] if i < len(pool) else it
    return names


def _cap(s):
    return s[:1].upper() + s[1:]


def _the(cat, name):
    """`the rope`, `Colonel Ash`: weapons and places take an article, people do not."""
    return name if cat == "suspect" else "the " + name


def clue_text(p, clue, names=None):
    """The canonical sentence of a clue. Names come from `names`, else the puzzle's own `names`, else the PoC names."""
    nm = names or p.get("names") or default_names(p)
    t = clue["type"]
    a = clue["a"]
    ca = category_key_of(p, a)
    bs = clue["b"] if isinstance(clue["b"], list) else [clue["b"]]
    cb = category_key_of(p, bs[0])
    A, B = nm[a], [nm[b] for b in bs]
    pair = (ca, cb)
    if t == "either":
        if pair == ("suspect", "place"):
            return "%s was either in the %s or the %s." % (A, B[0], B[1])
        if pair == ("suspect", "weapon"):
            return "%s had either the %s or the %s." % (A, B[0], B[1])
        if pair == ("weapon", "place"):
            return "The %s was either in the %s or the %s." % (A, B[0], B[1])
        if pair == ("weapon", "suspect"):
            return "Either %s or %s had the %s." % (B[0], B[1], A)
        if pair == ("place", "suspect"):
            return "Either %s or %s was in the %s." % (B[0], B[1], A)
        if pair == ("place", "weapon"):
            return "Either the %s or the %s was in the %s." % (B[0], B[1], A)
    else:
        b = B[0]
        neg = "not " if t == "not" else ""
        if pair in (("suspect", "place"), ("place", "suspect")):
            s, pl = (A, b) if ca == "suspect" else (b, A)
            return "%s was %sin the %s." % (s, neg, pl)
        if pair in (("suspect", "weapon"), ("weapon", "suspect")):
            s, w = (A, b) if ca == "suspect" else (b, A)
            return "%s did not have the %s." % (s, w) if t == "not" else "%s had the %s." % (s, w)
        if pair in (("weapon", "place"), ("place", "weapon")):
            w, pl = (A, b) if ca == "weapon" else (b, A)
            return "Whoever had the %s was %sin the %s." % (w, neg, pl)
    raise ValueError("no sentence for a %s clue of %s and %s" % (t, ca, cb))


def murder_text(p, names=None):
    nm = names or p.get("names") or default_names(p)
    return "The body was found in the %s." % nm[p["murder"]["place"]]


def step_text(p, step, names=None):
    """Why a deduction step holds, in a sentence for a hint."""
    nm = names or p.get("names") or default_names(p)
    a, b = step["cell"]
    A, B = _the_name(p, a, nm), _the_name(p, b, nm)
    yes = step["value"] == "yes"
    rule = step["rule"]
    if rule == "clue":
        cl = next((c for c in p["clues"] if c["id"] == step.get("clue")), None)
        num = cl["id"][1:] if cl else "?"
        return "Clue %s says: %s So %s %s %s." % (num, clue_text(p, cl, nm) if cl else "", A, "goes with" if yes else "cannot go with", B)
    if rule == "elim":
        f = step["from"][0]
        return "%s goes with %s, so %s cannot go with %s." % (_the_name(p, f[0], nm, cap=True), _the_name(p, f[1], nm), A, B)
    if rule == "last":
        return "Everything else for %s is ruled out, so %s goes with %s." % (A, A, B)
    if rule == "either":
        cl = next((c for c in p["clues"] if c["id"] == step.get("clue")), None)
        num = cl["id"][1:] if cl else "?"
        return "Clue %s says: %s One of the two is ruled out, so %s goes with %s." % (num, clue_text(p, cl, nm) if cl else "", A, B)
    if rule == "trans":
        f1, f2 = step["from"]
        return "%s and %s are linked through %s, so %s %s %s." % (A, B, _the_name(p, _shared(f1, f2), nm), A, "goes with" if yes else "cannot go with", B)
    return "%s %s %s." % (A, "goes with" if yes else "cannot go with", B)


def _shared(c1, c2):
    for x in c1:
        if x in c2:
            return x
    return c1[0]


def _the_name(p, item, nm, cap=False):
    s = _the(category_key_of(p, item), nm[item])
    return _cap(s) if cap else s


def fill(p, names=None):
    """Adds `names` and `text` (clue id -> sentence, and `murder`) from the canonical sentences."""
    nm = dict(names) if names else default_names(p)
    p["names"] = nm
    p["text"] = {c["id"]: clue_text(p, c, nm) for c in p["clues"]}
    p["text"]["murder"] = murder_text(p, nm)
    return p


def all_sentences(p):
    return list(p.get("text", {}).values()) + list(p.get("names", {}).values())


__all__ = ["POC_NAMES", "LABELS", "safe_text", "default_names", "clue_text", "murder_text", "step_text", "fill", "all_sentences", "category_index"]
