"""Testimony: an Ace Attorney cross-examination. A witness makes statements; the player may press a statement for more, and must present the
one piece of evidence that proves one statement false.

This kind is authored, then checked (the logic is not generated from nothing):

* `keys` is the vocabulary of the world: facts such as `clock` (the hour the clock struck) with their possible values.
* A statement has `claims` (what the witness asserts: `{key, value}`) and may have `press` claims, said only when the statement is pressed.
* A piece of evidence has `facts` (what it shows: `{key, value}`).
* A claim and a fact clash when they are about the same key and the values differ. The code finds every clash; a puzzle is sound when there is
  exactly one, and it is the pair the puzzle says (`solution: {statement, evidence, press}`).

`generate_testimony` makes a puzzle from the built-in vocabulary (for tests and for a first draft); an author gives their own data and the tools
prove it. The prose of statements and evidence is flavour; the flavour check has a reader write the claims and facts back from the prose.
"""

import random

from .model import BANDS, FORMAT, PuzzleError

#: The world the built-in generator draws from: key -> label (what the key is about), values, the evidence item that shows it, and templates
#: ({v} is the value). The witness phrase is `claim`, the evidence phrase `fact`.
VOCAB = [
    {
        "key": "clock", "label": "the hour the clock struck", "values": ["nine", "ten", "eleven", "twelve"], "item": "pocket watch",
        "claim": "I heard the clock strike {v} just before the scream", "fact": "It is stopped, and it reads {v} o'clock",
    },
    {
        "key": "door", "label": "the state of the study door", "values": ["locked", "open", "ajar"], "item": "key log",
        "claim": "The study door was {v} when I passed it", "fact": "It says the study door was {v} that evening",
    },
    {
        "key": "lamp", "label": "the hall lamp", "values": ["lit", "dark", "dim"], "item": "photograph",
        "claim": "The lamp in the hall was {v}", "fact": "It shows the hall lamp {v}",
    },
    {
        "key": "weather", "label": "the weather that night", "values": ["raining", "dry", "foggy"], "item": "weather report",
        "claim": "It was {v} outside", "fact": "It says it was {v} that night",
    },
    {
        "key": "weapon", "label": "what lay on the table", "values": ["rope", "candlestick", "poison", "dagger"], "item": "inventory",
        "claim": "I saw the {v} on the table", "fact": "It lists the {v} on the table",
    },
    {
        "key": "guest", "label": "who left first", "values": ["the doctor", "the colonel", "the cook"], "item": "guest list",
        "claim": "{v} left first", "fact": "It shows {v} leaving first",
    },
    {
        "key": "window", "label": "the library window", "values": ["shut", "broken", "wide open"], "item": "repair bill",
        "claim": "The library window was {v}", "fact": "It records the library window as {v}",
    },
    {
        "key": "shoes", "label": "the shoes by the door", "values": ["muddy", "polished", "missing"], "item": "boot print",
        "claim": "The shoes by the door were {v}", "fact": "It shows the shoes by the door {v}",
    },
]
BY_KEY = {v["key"]: v for v in VOCAB}
SIZES = {"easy": (4, 3), "medium": (5, 4), "hard": (6, 5)}  # statements, pieces of evidence
WITNESS = "Mr Halloran"


# ---- the logic ----

def _pairs(items):
    return {(c["key"], c["value"]) for c in items}


def all_claims(s):
    """Every claim of a statement: what it says, and what it says when pressed."""
    return list(s.get("claims", [])) + list((s.get("press") or {}).get("claims", []))


def clashes(p, statements=None, evidence=None):
    """Every (statement, evidence) pair with a claim and a fact about the same key and different values:
    [{statement, evidence, key, claim, fact, press}]."""
    out = []
    for s in p["statements"] if statements is None else statements:
        pressed = [(c, True) for c in (s.get("press") or {}).get("claims", [])]
        for c, via in [(c, False) for c in s.get("claims", [])] + pressed:
            for e in p["evidence"] if evidence is None else evidence:
                for f in e["facts"]:
                    if f["key"] == c["key"] and f["value"] != c["value"]:
                        out.append({"statement": s["id"], "evidence": e["id"], "key": c["key"], "claim": c["value"], "fact": f["value"], "press": via})
    return out


def near_misses(p):
    """Claims and facts about the same key that agree: the evidence that looks relevant and is not."""
    n = 0
    for s in p["statements"]:
        for c in all_claims(s):
            for e in p["evidence"]:
                n += sum(1 for f in e["facts"] if f["key"] == c["key"] and f["value"] == c["value"])
    return n


def repeats(p):
    """Ways a puzzle says the same thing twice (VNO-25), as a list of strings; empty is good. The generator rejects a core that has any, and the
    tests check it. It is not part of `validate_testimony`: an author may repeat on purpose."""
    out = []
    seen = {}
    for s in p["statements"]:
        said = frozenset(_pairs(s["claims"]))
        if said in seen:
            out.append("%s says what %s says" % (s["id"], seen[said]))
        seen[said] = s["id"]
        press = _pairs((s.get("press") or {}).get("claims", []))
        if press and press <= said:
            out.append("the press line of %s only repeats the statement" % s["id"])
        if press and {c["key"] for c in s["claims"]} & {k for k, _ in press}:
            out.append("the press line of %s is about the same thing as the statement" % s["id"])
    claimed = {}
    for s in p["statements"]:
        for c in s["claims"]:
            if c["key"] in claimed:
                out.append("%s and %s both claim something about %s" % (claimed[c["key"]], s["id"], c["key"]))
            claimed[c["key"]] = s["id"]
    pressed = {}
    for s in p["statements"]:
        for c in (s.get("press") or {}).get("claims", []):
            if c["key"] in pressed:
                out.append("the press lines of %s and %s are about the same thing (%s)" % (pressed[c["key"]], s["id"], c["key"]))
            pressed[c["key"]] = s["id"]
    shown = {}
    for e in p["evidence"]:
        for f in e["facts"]:
            if f["key"] in shown:
                out.append("%s and %s show the same fact (%s)" % (shown[f["key"]], e["id"], f["key"]))
            shown[f["key"]] = e["id"]
    return out


def band_of(p, found=None):
    """easy: the contradiction is in what the witness says at first. medium: it only comes out when the statement is pressed. hard: pressed,
    and four or more claims agree with pieces of evidence (the evidence looks relevant)."""
    found = found or clashes(p)
    needs_press = any(c["press"] for c in found)
    if not needs_press:
        return "easy"
    return "hard" if near_misses(p) >= 4 else "medium"


def validate_testimony(p):
    if p.get("format") != FORMAT or p.get("kind") != "testimony":
        raise PuzzleError("not a testimony puzzle of format %d" % FORMAT)
    keys = {k["key"]: k for k in p.get("keys") or []}
    if not keys:
        raise PuzzleError("a testimony puzzle needs keys (the vocabulary of the facts)")
    for k in keys.values():
        if len(k.get("values") or []) < 2:
            raise PuzzleError("key %s needs at least two values" % k["key"])
    ids = set()
    for s in p.get("statements") or []:
        if s["id"] in ids:
            raise PuzzleError("statement %s is listed twice" % s["id"])
        ids.add(s["id"])
        for c in all_claims(s):
            if c["key"] not in keys or c["value"] not in keys[c["key"]]["values"]:
                raise PuzzleError("statement %s claims %s=%s, which is not in the keys" % (s["id"], c["key"], c["value"]))
    if len(p.get("statements") or []) < 2:
        raise PuzzleError("a testimony needs at least two statements")
    eids = set()
    for e in p.get("evidence") or []:
        if e["id"] in eids or e["id"] in ids:
            raise PuzzleError("id %s is used twice" % e["id"])
        eids.add(e["id"])
        for f in e["facts"]:
            if f["key"] not in keys or f["value"] not in keys[f["key"]]["values"]:
                raise PuzzleError("evidence %s shows %s=%s, which is not in the keys" % (e["id"], f["key"], f["value"]))
    if not eids:
        raise PuzzleError("a testimony needs evidence")
    sol = p.get("solution") or {}
    if sol.get("statement") not in ids or sol.get("evidence") not in eids:
        raise PuzzleError("the solution names a statement or evidence that is not there")


def solve_testimony(p):
    """The proof: {unique, solutions, deducible, band, steps, score, rules}. `solutions` is the number of clashes: exactly one is sound, and
    it must be the pair the puzzle names. `deducible` is that (there is nothing to guess: the evidence is shown and compared)."""
    validate_testimony(p)
    found = clashes(p)
    sol = p["solution"]
    ok = len(found) == 1 and found[0]["statement"] == sol["statement"] and found[0]["evidence"] == sol["evidence"] and found[0]["press"] == bool(sol.get("press", False))
    steps = _steps(p, found[0]) if len(found) == 1 else []
    score = len(p["statements"]) * len(p["evidence"]) + near_misses(p) + (3 if found and any(c["press"] for c in found) else 0)
    return {"unique": len(found) == 1, "solutions": len(found), "deducible": ok, "band": band_of(p, found) if ok else None, "steps": steps, "score": score, "rules": {"clash": len(found), "near": near_misses(p)}}


def verify_testimony(p):
    r = solve_testimony(p)
    if not r["unique"]:
        raise PuzzleError("the testimony has %d clashes, not one" % r["solutions"])
    if not r["deducible"]:
        raise PuzzleError("the clash is not the pair the solution names")
    return r


def _steps(p, c):
    steps = [{"rule": "look", "key": c["key"], "statement": c["statement"], "evidence": c["evidence"], "value": ""}]
    if c["press"]:
        steps.append({"rule": "press", "statement": c["statement"], "value": ""})
    steps.append({"rule": "present", "statement": c["statement"], "evidence": c["evidence"], "value": ""})
    return steps


# ---- text ----

def _sentence(template, v):
    return template.format(v=v)


def _keyinfo(p, key):
    for k in p["keys"]:
        if k["key"] == key:
            return k
    raise PuzzleError("no key %r" % (key,))


def claim_sentence(p, c):
    k = _keyinfo(p, c["key"])
    s = _sentence(k.get("claim") or "The %s is {v}" % k["key"], c["value"])
    return s[:1].upper() + s[1:]


def fact_sentence(p, f):
    k = _keyinfo(p, f["key"])
    return _sentence(k.get("fact") or "The %s is {v}" % k["key"], f["value"])


def default_names(p):
    have = p.get("names") or {}
    out = {"wit": have.get("wit") or WITNESS}
    used = {}
    for e in p["evidence"]:
        k = _keyinfo(p, e["facts"][0]["key"])
        base = k.get("item") or e["id"]
        used[base] = used.get(base, 0) + 1
        out[e["id"]] = have.get(e["id"]) or (base if used[base] == 1 else "%s %d" % (base, used[base]))
    return out


def fill_testimony(p, names=None):
    nm = dict(names) if names else default_names(p)
    p["names"] = nm
    w = nm["wit"]
    text = {"intro": "%s is giving testimony. Press a statement to hear more, and present the evidence that proves one of them false." % w}
    for s in p["statements"]:
        text[s["id"]] = "%s." % ". ".join(claim_sentence(p, c) for c in s["claims"])
        extra = (s.get("press") or {}).get("claims", [])
        if extra:
            text[s["id"] + ".press"] = "Now that you ask. %s." % ". ".join(claim_sentence(p, c) for c in extra)
    for e in p["evidence"]:
        text[e["id"]] = "%s: %s." % (nm[e["id"]], ". ".join(fact_sentence(p, f) for f in e["facts"]))
    p["text"] = text
    return p


# ---- generation ----

def generate_testimony(size=None, seed=0, band="medium", max_tries=200):
    if band not in BANDS:
        raise PuzzleError("unknown band %r (easy, medium or hard)" % (band,))
    n, m = SIZES[band]
    rng = random.Random("vno-puzzles:testimony:%s:%s" % (seed, band))
    for _ in range(max_tries):
        world = {v["key"]: rng.choice(v["values"]) for v in VOCAB}
        keys = [v["key"] for v in VOCAB]

        def claim(key, truth=True):
            vals = BY_KEY[key]["values"]
            value = world[key] if truth else rng.choice([x for x in vals if x != world[key]])
            return {"key": key, "value": value}

        liar_key = rng.choice(keys)
        pressed = band != "easy"
        others = [k for k in keys if k != liar_key]
        liar_at = rng.randrange(n)
        # VNO-25: every statement is about its own key, every press line about a key of its own, every piece of evidence about its own keys
        mains = rng.sample(others, n if pressed else n - 1)
        statements = []
        press_keys = [liar_key] if pressed else []
        for i in range(n):
            if i == liar_at:
                if pressed:
                    main = mains.pop()
                    st = {"claims": [claim(main)], "press": {"claims": [claim(liar_key, truth=False)]}}
                else:
                    st = {"claims": [claim(liar_key, truth=False)]}
            else:
                main = mains.pop()
                st = {"claims": [claim(main)]}
                if pressed and rng.random() < 0.5:
                    free = [k for k in others if k != main and k not in press_keys]
                    if free:
                        pk = rng.choice(free)
                        press_keys.append(pk)
                        st["press"] = {"claims": [claim(pk)]}
            statements.append(st)
        # the evidence: one piece shows the liar's key, the rest show other keys truthfully (they agree with what is said: near misses);
        # no key is shown twice
        evid_keys = rng.sample(others, m - 1)
        evidence = [{"facts": [claim(liar_key)]}] + [{"facts": [claim(k)]} for k in evid_keys]
        if band == "hard":
            spare = [k for k in others if k not in evid_keys]
            for e in evidence[1:]:
                if spare and rng.random() < 0.5:
                    e["facts"].append(claim(spare.pop(rng.randrange(len(spare)))))
        rng.shuffle(evidence)
        for i, s in enumerate(statements):
            s["id"] = "t%d" % (i + 1)
        for j, e in enumerate(evidence):
            e["id"] = "e%d" % (j + 1)
        liar_id = statements[liar_at]["id"]
        witness = next(e["id"] for e in evidence if e["facts"][0]["key"] == liar_key and e["facts"][0]["value"] == world[liar_key] and sum(1 for f in e["facts"] if f["key"] == liar_key) == 1)
        used = {c["key"] for s in statements for c in all_claims(s)} | {f["key"] for e in evidence for f in e["facts"]}
        p = {
            "format": FORMAT, "kind": "testimony", "size": n, "seed": seed, "band": band,
            "witness": "wit",
            "keys": [dict(v) for v in VOCAB if v["key"] in used],
            "statements": statements, "evidence": evidence,
            "solution": {"statement": liar_id, "evidence": witness, "press": pressed},
        }
        if repeats(p):
            continue
        found = clashes(p)
        if len(found) != 1 or found[0]["statement"] != liar_id or found[0]["evidence"] != witness:
            continue
        if band_of(p, found) != band:
            continue
        res = solve_testimony(p)
        p["difficulty"] = {"steps": len(res["steps"]), "score": res["score"], "rules": res["rules"]}
        p["steps"] = res["steps"]
        return fill_testimony(p)
    raise PuzzleError("no %s testimony found for seed %s in %d tries" % (band, seed, max_tries))


# ---- the player's side ----

def check_present(p, statement, evidence, pressed):
    """What presenting `evidence` at `statement` does: `correct`, `press_first` (it is the right pair but the statement has more to say: press it
    first) or `wrong`."""
    sol = p["solution"]
    if statement != sol["statement"] or evidence != sol["evidence"]:
        return {"result": "wrong"}
    if sol.get("press") and statement not in pressed:
        return {"result": "press_first"}
    return {"result": "correct"}


def hint(p, marks, hints=0):
    """{kind, text, cell}: four levels. `marks` holds "pressed" for every statement the player pressed; `hints` is how many were given."""
    state = {"hints": hints, "pressed": [k for k, v in marks.items() if v == "pressed"]}
    nm = p["names"]
    sol = p["solution"]
    found = clashes(p)[0]
    k = _keyinfo(p, found["key"])
    n = state.get("hints", 0)
    if n == 0:
        return {"kind": "step", "cell": "", "text": "One statement does not fit a piece of evidence. Look for what the evidence says about %s." % k["label"]}
    if sol.get("press") and sol["statement"] not in state.get("pressed", []) and n == 1:
        return {"kind": "step", "cell": "", "text": "Someone is holding something back. Press the statements and listen."}
    num = sol["statement"][1:]
    if n <= 2:
        return {"kind": "step", "cell": "", "text": "Statement %s is the one that does not hold." % num}
    return {"kind": "step", "cell": "", "text": "Present the %s at statement %s." % (nm[sol["evidence"]], num)}


# ---- the flavour check ----

def _norm(s):
    return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in str(s)).split())


def _set(items, label):
    out = set()
    for c in items or []:
        if not isinstance(c, dict) or "key" not in c or "value" not in c:
            raise ValueError("%s: a claim needs a key and a value" % label)
        out.add((str(c["key"]), str(c["value"])))
    return out


def check_testimony_text(p, read_back, text=None):
    """{ok, problems, differing}: the reader's `[{id, claims|facts}]` (ids `t1`, `t1.press`, `e1`) must be the same claims and facts as the
    originals, as sets; then the read-back puzzle must still have exactly one clash, the same one."""
    validate_testimony(p)
    by_id = {r.get("id"): r for r in read_back}
    problems, differing = [], []
    keys = {k["key"]: k for k in p["keys"]}

    def bad(ident, problem):
        problems.append({"clue": ident, "problem": problem})
        differing.append(ident)

    rb_statements, rb_evidence = [], []

    def compare(ident, want, field):
        r = by_id.get(ident)
        if r is None:
            bad(ident, "the reader gave nothing for this one")
            return None
        try:
            got = _set(r.get(field), ident)
        except ValueError as e:
            bad(ident, str(e))
            return None
        unknown = [(k, v) for k, v in got if k not in keys or v not in keys[k]["values"]]
        if unknown:
            bad(ident, "%s=%s is not in the keys of this puzzle" % unknown[0])
            return None
        if got != want:
            bad(ident, "the prose says %s, not what is written" % ("something else about " + ", ".join(sorted({k for k, _ in got ^ want}))))
            return None
        return [{"key": k, "value": v} for k, v in sorted(got)]

    for s in p["statements"]:
        base = compare(s["id"], _pairs(s["claims"]), "claims")
        extra_want = _pairs((s.get("press") or {}).get("claims", []))
        extra = compare(s["id"] + ".press", extra_want, "claims") if extra_want else []
        if base is not None and extra is not None:
            rb_statements.append({"id": s["id"], "claims": base, **({"press": {"claims": extra}} if extra else {})})
    for e in p["evidence"]:
        got = compare(e["id"], _pairs(e["facts"]), "facts")
        if got is not None:
            rb_evidence.append({"id": e["id"], "facts": got})
    if not problems:
        q = dict(p, statements=rb_statements, evidence=rb_evidence)
        found = clashes(q)
        sol = p["solution"]
        if len(found) != 1:
            problems.append({"clue": "", "problem": "the read-back puzzle has %d clashes, not one" % len(found)})
        elif found[0]["statement"] != sol["statement"] or found[0]["evidence"] != sol["evidence"]:
            problems.append({"clue": "", "problem": "the read-back puzzle clashes somewhere else"})
    return {"ok": not problems, "problems": problems, "differing": differing}
