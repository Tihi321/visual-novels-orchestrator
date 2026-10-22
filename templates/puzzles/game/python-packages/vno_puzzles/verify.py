"""The flavour check: does the prose still mean the same constraints?

A model writes names and one prose sentence per clue. A second, separate model reads only the prose and the names (never the structured
clue) and writes each clue back as structured data. `check_text` compares that read-back with the original clue by truth table: over every
assignment the two must be true in exactly the same ones. Then the read-back set must still give one solution, solvable by deduction.
"""

from .model import all_owner_maps, clue_true, validate
from .solver import count_solutions, deduce


def _norm(s):
    return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in str(s)).split())


def _name_to_item(p):
    out = {}
    for item, name in p["names"].items():
        out[_norm(name)] = item
        out[_norm(item)] = item
    return out


def _item(table, name):
    return table.get(_norm(name))


def check_text(p, read_back, text=None):
    """{ok, problems, differing}: `read_back` is a list of {id, type, a, b} written by a reader of the prose (names, or ids).

    `text` (clue id -> prose) turns on the cheap check first: every name the reader used must appear in that clue's prose.
    """
    validate(p)
    table = _name_to_item(p)
    owners = all_owner_maps(p)
    by_id = {r.get("id"): r for r in read_back}
    problems = []
    differing = []
    rebuilt = []
    for clue in p["clues"]:
        r = by_id.get(clue["id"])
        if r is None:
            problems.append({"clue": clue["id"], "problem": "the reader gave no clue for this one"})
            differing.append(clue["id"])
            continue
        bs = r.get("b")
        names = [r.get("a")] + (list(bs) if isinstance(bs, (list, tuple)) else [bs])
        if r.get("type") not in ("is", "not", "either"):
            problems.append({"clue": clue["id"], "problem": "unknown clue type %r" % (r.get("type"),)})
            differing.append(clue["id"])
            continue
        if (r["type"] == "either") != isinstance(bs, (list, tuple)) or (r["type"] == "either" and len(bs) != 2):
            problems.append({"clue": clue["id"], "problem": "an either clue needs exactly two options, and only an either clue has them"})
            differing.append(clue["id"])
            continue
        ids = [_item(table, n) for n in names]
        bad = [n for n, i in zip(names, ids) if i is None]
        if bad:
            problems.append({"clue": clue["id"], "problem": "the reader used %s, which is not a name of this puzzle" % ", ".join(repr(n) for n in bad)})
            differing.append(clue["id"])
            continue
        if text is not None and clue["id"] in text:
            prose = _norm(text[clue["id"]])
            missing = [n for n in names if _norm(n) not in prose and _norm(p["names"][_item(table, n)]) not in prose]
            if missing:
                problems.append({"clue": clue["id"], "problem": "the reader named %s, which the prose does not contain" % ", ".join(repr(n) for n in missing)})
                differing.append(clue["id"])
                continue
        back = {"id": clue["id"], "type": r["type"], "a": ids[0], "b": ids[1:] if r["type"] == "either" else ids[1]}
        if r["type"] == "either" and len(set(ids[1:])) != 2:
            problems.append({"clue": clue["id"], "problem": "the two options of an either clue must differ"})
            differing.append(clue["id"])
            continue
        try:
            same = all(clue_true(clue, o) == clue_true(back, o) for o in owners)
        except (KeyError, TypeError):
            same = False
        if not same:
            problems.append({"clue": clue["id"], "problem": "the prose means something else than the clue (%s read back as %s)" % (clue["type"], r["type"]) if clue["type"] != r["type"] else "the prose means something else than the clue (other items)"})
            differing.append(clue["id"])
            continue
        rebuilt.append(back)
    if not problems:
        q = dict(p, clues=rebuilt)
        if count_solutions(q, 2) != 1:
            problems.append({"clue": "", "problem": "the read-back clues do not give exactly one solution"})
        elif not deduce(q)["solved"]:
            problems.append({"clue": "", "problem": "the read-back clues cannot be solved by deduction alone"})
    return {"ok": not problems, "problems": problems, "differing": differing}
