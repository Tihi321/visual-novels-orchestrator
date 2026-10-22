"""Canonical English sentences for each clue type, the names of the proof of concept, and the sentences of the hints.

Ren'Py reads `[` as interpolation and `{` as a text tag, so no sentence made here may contain either (names are checked by `safe_text`).
In phase 2 a model writes the names and the prose; these sentences stay as the canonical reading the checker compares against.
"""

from .model import category_key_of, category_index

#: The names of the proof of concept (no Clue or Murdle names).
POC_NAMES = {
    "suspect": ["Colonel Ash", "Doctor Birch", "Miss Cole", "Lady Dunn", "Mr Frost"],
    "weapon": ["rope", "candlestick", "poison", "dagger", "vase"],
    "place": ["library", "kitchen", "garden", "cellar", "study"],
    "motive": ["jealousy", "greed", "revenge", "fear", "love"],
}

#: How a suspect, weapon or place can be pointed at without its name (attribute clues): "the tall guest", "the heavy weapon".
POC_DESCR = {
    "suspect": ["the tall guest", "the left-handed guest", "the youngest guest", "the quiet guest", "the guest in grey"],
    "weapon": ["the heavy weapon", "the metal weapon", "the sharp weapon", "the silent weapon", "the fragile weapon"],
    "place": ["the room upstairs", "the room by the stairs", "the room with the fire", "the room below ground", "the room facing east"],
}

LABELS = {"suspect": "Suspects", "weapon": "Weapons", "place": "Places", "motive": "Motives"}


def safe_text(s):
    """True when the text has nothing Ren'Py would read as interpolation or a text tag."""
    return "[" not in s and "{" not in s and "%" not in s


def default_names(p):
    """item id -> name for the PoC: the first names of `POC_NAMES` per category, in item order (a puzzle's own `names` come first)."""
    if p.get("kind") == "knights":
        from .knights import default_names as knights_names

        return knights_names(p)
    have = p.get("names") or {}
    names = {}
    for c in p["categories"]:
        pool = POC_NAMES.get(c["key"], [])
        for i, it in enumerate(c["items"]):
            names[it] = have.get(it) or (pool[i] if i < len(pool) else it)
    return names


def default_descr(p):
    """item id -> how to point at it without its name (suspects, weapons and places), for attribute clues."""
    out = {}
    for c in p["categories"]:
        pool = POC_DESCR.get(c["key"], [])
        for i, it in enumerate(c["items"]):
            if i < len(pool):
                out[it] = pool[i]
    return out


def _cap(s):
    return s[:1].upper() + s[1:]


def _the(cat, name):
    """`the rope`, `Colonel Ash`, `jealousy`: weapons and places take an article, people and motives do not."""
    return name if cat in ("suspect", "motive") else "the " + name


_IS = {
    ("suspect", "weapon"): ("{X} had {Y}.", "{X} did not have {Y}."),
    ("suspect", "place"): ("{X} was in {Y}.", "{X} was not in {Y}."),
    ("suspect", "motive"): ("{X} acted out of {Y}.", "{X} did not act out of {Y}."),
    ("weapon", "place"): ("Whoever had {X} was in {Y}.", "Whoever had {X} was not in {Y}."),
    ("weapon", "motive"): ("Whoever had {X} acted out of {Y}.", "Whoever had {X} did not act out of {Y}."),
    ("place", "motive"): ("Whoever was in {X} acted out of {Y}.", "Whoever was in {X} did not act out of {Y}."),
}

_EITHER = {
    ("suspect", "place"): "{A} was either in {B1} or {B2}.",
    ("suspect", "weapon"): "{A} had either {B1} or {B2}.",
    ("weapon", "place"): "{A} was either in {B1} or {B2}.",
    ("weapon", "suspect"): "Either {B1} or {B2} had {A}.",
    ("place", "suspect"): "Either {B1} or {B2} was in {A}.",
    ("place", "weapon"): "Either {B1} or {B2} was in {A}.",
    ("suspect", "motive"): "{A} acted out of either {B1} or {B2}.",
    ("motive", "suspect"): "Either {B1} or {B2} acted out of {A}.",
    ("weapon", "motive"): "Whoever had {A} acted out of either {B1} or {B2}.",
    ("motive", "weapon"): "Whoever acted out of {A} had either {B1} or {B2}.",
    ("place", "motive"): "Whoever was in {A} acted out of either {B1} or {B2}.",
    ("motive", "place"): "Whoever acted out of {A} was either in {B1} or {B2}.",
}


def _murdle_text(p, clue, nm):
    descr = p.get("descr") or {}
    pointed = set(clue.get("descr") or [])

    def np(item):
        if item in pointed and item in descr:
            return descr[item]
        return _the(category_key_of(p, item), nm[item])

    a = clue["a"]
    bs = clue["b"] if isinstance(clue["b"], list) else [clue["b"]]
    ca, cb = category_key_of(p, a), category_key_of(p, bs[0])
    if clue["type"] == "either":
        frame = _EITHER.get((ca, cb))
        if frame is None:
            raise ValueError("no sentence for an either clue of %s and %s" % (ca, cb))
        return _cap(frame.format(A=np(a), B1=np(bs[0]), B2=np(bs[1])))
    idx = category_index(p)
    first, second = (a, bs[0]) if idx[a] < idx[bs[0]] else (bs[0], a)
    frames = _IS.get((category_key_of(p, first), category_key_of(p, second)))
    if frames is None:
        raise ValueError("no sentence for a %s clue of %s and %s" % (clue["type"], ca, cb))
    return _cap(frames[1 if clue["type"] == "not" else 0].format(X=np(first), Y=np(second)))


def _ref(p, item, nm):
    """How a logic puzzle refers to the one an item belongs to: the category's `ref` ("the {n} owner"), `{n}` being the item's name."""
    cat = p["categories"][category_index(p)[item]]
    return (cat.get("ref") or "{n}").format(n=nm[item])


def _logic_text(p, clue, nm):
    t = clue["type"]
    unit = (p.get("ordinal") or {}).get("unit", "")
    R = lambda i: _ref(p, i, nm)  # noqa: E731
    a, b = clue["a"], clue["b"]
    if t == "is":
        return _cap("%s is %s." % (R(a), R(b)))
    if t == "not":
        return _cap("%s is not %s." % (R(a), R(b)))
    if t == "either":
        return _cap("%s is either %s or %s." % (R(a), R(b[0]), R(b[1])))
    if t == "neither":
        return _cap("%s is neither %s nor %s." % (R(a), R(b[0]), R(b[1])))
    if t == "oneof":
        return _cap("Of %s and %s, one is %s and the other is %s." % (R(a[0]), R(a[1]), R(b[0]), R(b[1])))
    if t == "before":
        return _cap("%s came before %s." % (R(a), R(b)))
    if t == "after":
        return _cap("%s came after %s." % (R(a), R(b)))
    if t == "apart":
        return _cap("%s and %s are exactly %d %s apart." % (R(a), R(b), clue["n"], unit or "places"))
    raise ValueError("no sentence for a %s clue" % (t,))


def clue_text(p, clue, names=None):
    """The canonical sentence of a clue. Names come from `names`, else the puzzle's own `names`, else the PoC names."""
    nm = names or p.get("names") or default_names(p)
    if p.get("kind") == "logic":
        return _logic_text(p, clue, nm)
    return _murdle_text(p, clue, nm)


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
        return "Clue %s says: %s So %s %s %s." % (num, _clue_prose(p, cl, nm), A, "goes with" if yes else "cannot go with", B)
    if rule == "elim":
        f = step["from"][0]
        return "%s goes with %s, so %s cannot go with %s." % (_the_name(p, f[0], nm, cap=True), _the_name(p, f[1], nm), A, B)
    if rule == "last":
        return "Everything else for %s is ruled out, so %s goes with %s." % (A, A, B)
    if rule == "either":
        cl = next((c for c in p["clues"] if c["id"] == step.get("clue")), None)
        num = cl["id"][1:] if cl else "?"
        return "Clue %s says: %s One of the two is ruled out, so %s goes with %s." % (num, _clue_prose(p, cl, nm), A, B)
    if rule == "order":
        cl = next((c for c in p["clues"] if c["id"] == step.get("clue")), None)
        num = cl["id"][1:] if cl else "?"
        return "Clue %s says: %s Counting the places in order, that rules out %s %s." % (num, _clue_prose(p, cl, nm), A, B)
    if rule == "trans":
        f1, f2 = step["from"]
        return "%s and %s are linked through %s, so %s %s %s." % (A, B, _the_name(p, _shared(f1, f2), nm), A, "goes with" if yes else "cannot go with", B)
    return "%s %s %s." % (A, "goes with" if yes else "cannot go with", B)


def _clue_prose(p, clue, nm):
    """The clue as the player reads it: the prose of the book when it has one, else the canonical sentence."""
    if not clue:
        return ""
    return p.get("text", {}).get(clue["id"]) or clue_text(p, clue, nm)


def _shared(c1, c2):
    for x in c1:
        if x in c2:
            return x
    return c1[0]


def _the_name(p, item, nm, cap=False):
    s = _ref(p, item, nm) if p.get("kind") == "logic" else _the(category_key_of(p, item), nm[item])
    return _cap(s) if cap else s


def fill(p, names=None):
    """Adds `names` and `text` (clue id -> sentence, and `murder`) from the canonical sentences."""
    if p.get("kind") == "knights":
        from .knights import fill_knights

        return fill_knights(p, names)
    if p.get("kind") == "testimony":
        from .testimony import fill_testimony

        return fill_testimony(p, names)
    nm = dict(names) if names else default_names(p)
    p["names"] = nm
    p["text"] = {c["id"]: clue_text(p, c, nm) for c in p["clues"]}
    if p.get("murder"):
        p["text"]["murder"] = murder_text(p, nm)
    return p


def render_text(p, names=None):
    """{names, text}: the canonical sentences of a puzzle core with these names (default: the PoC names). The puzzle is not changed."""
    q = dict(p)
    q.pop("text", None)
    q.pop("names", None)
    fill(q, names)
    return {"names": q["names"], "text": q["text"]}


def all_sentences(p):
    return list(p.get("text", {}).values()) + list(p.get("names", {}).values())


__all__ = ["default_descr", "render_text", "POC_NAMES", "LABELS", "safe_text", "default_names", "clue_text", "murder_text", "step_text", "fill", "all_sentences", "category_index"]
