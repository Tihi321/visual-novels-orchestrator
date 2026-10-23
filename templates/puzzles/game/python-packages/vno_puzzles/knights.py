"""Knights and Knaves: some speakers always tell the truth (knights), the others always lie (knaves). Each statement is about the speakers;
who is who?

A puzzle is `{kind: "knights", speakers: ["k1", ...], statements: [{id, speaker, claim}], solution: {k1: "knight" | "knave", ...}}`. A claim is a
small structured sentence (`CLAIMS` below). The proofs: exactly one assignment of knight and knave satisfies every statement (all
2**n assignments are tried), and a person can find it without guessing: single-statement inference (`direct`) and case splits that end
in a contradiction (`split`, a proof by contradiction, not a guess). Difficulty is the number of splits.
"""

import itertools
import random

from .model import BANDS, FORMAT, WEIGHTS, PuzzleError

KNIGHT, KNAVE = "knight", "knave"
WEIGHTS.setdefault("direct", 1)
WEIGHTS.setdefault("split", 4)
RULES_KK = ("direct", "split")
NAMES = ["Aldo", "Brin", "Cass", "Dara", "Evo"]

#: The claim types: knight/knave (who), same/diff (a, b), some_knave/all_knight (of), exactly (k, of), not (c), and/or (a, b are claims).
CLAIMS = ("knight", "knave", "same", "diff", "some_knave", "all_knight", "exactly", "not", "and", "or")


def claim_vars(c):
    """The speakers a claim talks about."""
    t = c["type"]
    if t in ("knight", "knave"):
        return {c["who"]}
    if t in ("same", "diff"):
        return {c["a"], c["b"]}
    if t in ("some_knave", "all_knight", "exactly"):
        return set(c["of"])
    if t == "not":
        return claim_vars(c["c"])
    if t in ("and", "or"):
        return claim_vars(c["a"]) | claim_vars(c["b"])
    raise PuzzleError("unknown claim type %r" % (t,))


def claim_true(c, is_knight):
    """Is the claim true when `is_knight` maps every speaker it names to True (a knight) or False (a knave)?"""
    t = c["type"]
    if t == "knight":
        return is_knight[c["who"]]
    if t == "knave":
        return not is_knight[c["who"]]
    if t == "same":
        return is_knight[c["a"]] == is_knight[c["b"]]
    if t == "diff":
        return is_knight[c["a"]] != is_knight[c["b"]]
    if t == "some_knave":
        return any(not is_knight[x] for x in c["of"])
    if t == "all_knight":
        return all(is_knight[x] for x in c["of"])
    if t == "exactly":
        return sum(1 for x in c["of"] if is_knight[x]) == c["k"]
    if t == "not":
        return not claim_true(c["c"], is_knight)
    if t == "and":
        return claim_true(c["a"], is_knight) and claim_true(c["b"], is_knight)
    if t == "or":
        return claim_true(c["a"], is_knight) or claim_true(c["b"], is_knight)
    raise PuzzleError("unknown claim type %r" % (t,))


def _assignments(p):
    sp = p["speakers"]
    for bits in itertools.product((True, False), repeat=len(sp)):
        yield dict(zip(sp, bits))


def _consistent(stmts, a):
    return all(a[s["speaker"]] == claim_true(s["claim"], a) for s in stmts)


def count_solutions(p, limit=2, statements=None):
    use = p["statements"] if statements is None else statements
    n = 0
    for a in _assignments(p):
        if _consistent(use, a):
            n += 1
            if n >= limit:
                break
    return n


def solution_of(p):
    return {k: v == KNIGHT for k, v in p["solution"].items()}


# ---- deduction ----

def _local(stmt, state):
    """The assignments of the speakers a statement touches that fit the statement and what is known. Returns a list of dicts."""
    vs = sorted({stmt["speaker"]} | claim_vars(stmt["claim"]))
    unknown = [v for v in vs if v not in state]
    out = []
    for bits in itertools.product((True, False), repeat=len(unknown)):
        a = {v: state[v] for v in vs if v in state}
        a.update(zip(unknown, bits))
        if a[stmt["speaker"]] == claim_true(stmt["claim"], a):
            out.append(a)
    return out, unknown


def _propagate(stmts, state, steps):
    """Single-statement inference until nothing new: what every assignment that fits one statement agrees on is known. Returns the id of a
    statement that cannot hold any more (a contradiction), or None."""
    changed = True
    while changed:
        changed = False
        for s in stmts:
            sols, unknown = _local(s, state)
            if not sols:
                return s["id"]
            for v in unknown:
                vals = {a[v] for a in sols}
                if len(vals) == 1:
                    val = next(iter(vals))
                    state[v] = val
                    if steps is not None:
                        steps.append({"rule": "direct", "statement": s["id"], "who": v, "value": KNIGHT if val else KNAVE})
                    changed = True
    return None


def deduce(p, statements=None):
    """{solved, steps, rules, score, splits}. Single-statement inference first; when it stops, a case split: assume one speaker is a knight,
    then a knave; the assumption that ends in a contradiction is ruled out, so the other is known."""
    use = p["statements"] if statements is None else statements
    steps = []
    state = {}
    if _propagate(use, state, steps) is not None:
        return _result(p, state, steps, False)
    while len(state) < len(p["speakers"]):
        decided = False
        for v in [x for x in p["speakers"] if x not in state]:
            bad = {}
            for val in (True, False):
                trial = dict(state)
                trial[v] = val
                bad[val] = _propagate(use, trial, None)
            if bad[True] is not None and bad[False] is not None:
                return _result(p, state, steps, False)
            if bad[True] is not None or bad[False] is not None:
                wrong = True if bad[True] is not None else False
                state[v] = not wrong
                steps.append({"rule": "split", "who": v, "value": KNIGHT if not wrong else KNAVE, "contradicts": KNIGHT if wrong else KNAVE, "statement": bad[wrong]})
                if _propagate(use, state, steps) is not None:
                    return _result(p, state, steps, False)
                decided = True
                break
        if not decided:
            return _result(p, state, steps, False)
    return _result(p, state, steps, state == solution_of(p))


def _result(p, state, steps, solved):
    rules = {}
    for s in steps:
        rules[s["rule"]] = rules.get(s["rule"], 0) + 1
    score = sum(WEIGHTS[r] * n for r, n in rules.items())
    return {"solved": bool(solved and len(state) == len(p["speakers"])), "steps": steps, "rules": rules, "score": score, "splits": rules.get("split", 0)}


def deduce_fast(p, statements=None):
    """The same fixed point as `deduce`, nothing recorded."""
    use = p["statements"] if statements is None else statements
    return deduce(p, use)["solved"]


def band_of(res):
    s = res["splits"]
    return "easy" if s == 0 else "medium" if s == 1 else "hard"


def solve_knights(p):
    """The proof of a puzzle: {unique, solutions, deducible, band, steps, score, rules}."""
    validate_knights(p)
    n = count_solutions(p, 2)
    res = deduce(p)
    return {"unique": n == 1, "solutions": n, "deducible": res["solved"], "band": band_of(res) if res["solved"] else None, "steps": res["steps"], "score": res["score"], "rules": res["rules"]}


def validate_knights(p):
    if p.get("format") != FORMAT or p.get("kind") != "knights":
        raise PuzzleError("not a knights puzzle of format %d" % FORMAT)
    sp = p.get("speakers") or []
    if not 2 <= len(sp) <= 5 or len(set(sp)) != len(sp):
        raise PuzzleError("a Knights and Knaves puzzle has 2 to 5 different speakers")
    for k in sp:
        if p["solution"].get(k) not in (KNIGHT, KNAVE):
            raise PuzzleError("the solution has no knight or knave for %s" % k)
    ids = set()
    for s in p["statements"]:
        if s["id"] in ids:
            raise PuzzleError("statement %s is listed twice" % s["id"])
        ids.add(s["id"])
        if s["speaker"] not in sp:
            raise PuzzleError("statement %s has an unknown speaker %s" % (s["id"], s["speaker"]))
        bad = claim_vars(s["claim"]) - set(sp)
        if bad:
            raise PuzzleError("statement %s names the unknown speaker %s" % (s["id"], sorted(bad)[0]))


def verify_knights(p):
    validate_knights(p)
    a = solution_of(p)
    for s in p["statements"]:
        if a[s["speaker"]] != claim_true(s["claim"], a):
            raise PuzzleError("statement %s does not hold in the solution" % s["id"])
    if count_solutions(p, 2) != 1:
        raise PuzzleError("the puzzle does not have exactly one solution")
    res = deduce(p)
    if not res["solved"]:
        raise PuzzleError("the puzzle cannot be solved without guessing")
    return res


# ---- text ----

def _list(names):
    return ", ".join(names[:-1]) + " and " + names[-1] if len(names) > 1 else names[0]


def claim_text(p, c, nm, speaker=None):
    """The claim as a sentence of what the speaker says (no final full stop: statement_text adds it)."""
    t = c["type"]
    of = ""
    if c.get("of"):
        of = "us" if set(c["of"]) == set(p["speakers"]) else _list([nm[x] for x in c["of"]])
    if t == "knight":
        return "%s is a knight" % nm[c["who"]]
    if t == "knave":
        return "%s is a knave" % nm[c["who"]]
    if t == "same":
        return "%s and %s are the same kind" % (nm[c["a"]], nm[c["b"]])
    if t == "diff":
        return "%s and %s are different kinds" % (nm[c["a"]], nm[c["b"]])
    if t == "some_knave":
        return "At least one of %s is a knave" % of
    if t == "all_knight":
        return "All of %s are knights" % of
    if t == "exactly":
        return "Exactly %d of %s %s" % (c["k"], of, "is a knight" if c["k"] == 1 else "are knights")
    if t == "not":
        return "It is not true that %s" % _lower(claim_text(p, c["c"], nm))
    if t == "and":
        return "%s, and %s" % (claim_text(p, c["a"], nm), _lower(claim_text(p, c["b"], nm)))
    if t == "or":
        return "Either %s, or %s" % (_lower(claim_text(p, c["a"], nm)), _lower(claim_text(p, c["b"], nm)))
    raise PuzzleError("no sentence for a %s claim" % (t,))


def _lower(s):
    # lower-case the first letter of a sentence part unless it starts with a name (names are capitalised in the source list)
    return s[:1].lower() + s[1:] if s.split(" ")[0] in ("At", "All", "Exactly", "It", "Either") else s


def statement_text(p, s, nm):
    return '%s says: "%s."' % (nm[s["speaker"]], claim_text(p, s["claim"], nm))


def default_names(p):
    have = p.get("names") or {}
    return {k: have.get(k) or (NAMES[i] if i < len(NAMES) else k) for i, k in enumerate(p["speakers"])}


def fill_knights(p, names=None):
    nm = dict(names) if names else default_names(p)
    p["names"] = nm
    p["text"] = {s["id"]: statement_text(p, s, nm) for s in p["statements"]}
    p["text"]["intro"] = "On this island knights always tell the truth and knaves always lie. Who is a knight and who is a knave?"
    return p


def step_text(p, step, nm):
    sid = step.get("statement")
    st = next((s for s in p["statements"] if s["id"] == sid), None)
    quote = (p.get("text", {}).get(sid) or (statement_text(p, st, nm) if st else "")) if st else ""
    who = nm[step["who"]]
    if step["rule"] == "direct":
        return "Look at what %s says: %s Given what is known, only one case fits: %s is a %s." % (nm[st["speaker"]] if st else who, quote, who, step["value"])
    owner = nm[st["speaker"]] if st else "one of the statements"
    return "Suppose %s were a %s. Following the statements, what %s says cannot hold. So %s is a %s." % (who, step["contradicts"], owner, who, step["value"])


# ---- generation ----

def _subsets(rng, sp, lo=2):
    out = []
    for r in range(lo, len(sp) + 1):
        for combo in itertools.combinations(sp, r):
            out.append(list(combo))
    rng.shuffle(out)
    return out[:8]


def _claims(rng, sp, band):
    pool = []
    for x in sp:
        pool.append({"type": "knight", "who": x})
        pool.append({"type": "knave", "who": x})
    for a, b in itertools.combinations(sp, 2):
        pool.append({"type": "same", "a": a, "b": b})
        pool.append({"type": "diff", "a": a, "b": b})
    if band != "easy":
        for of in _subsets(rng, sp):
            pool.append({"type": "some_knave", "of": of})
            pool.append({"type": "all_knight", "of": of})
            for k in range(0, len(of) + 1):
                pool.append({"type": "exactly", "k": k, "of": of})
    if band == "hard":
        simple = [c for c in pool if c["type"] in ("knight", "knave", "same", "diff")]
        for _ in range(12):
            a, b = rng.sample(simple, 2)
            pool.append({"type": rng.choice(("and", "or")), "a": a, "b": b})
        for c in rng.sample(simple, min(4, len(simple))):
            pool.append({"type": "not", "c": c})
    rng.shuffle(pool)
    return pool


def generate_knights(size=3, seed=0, band="medium", max_tries=400):
    if not 2 <= size <= 5:
        raise PuzzleError("Knights and Knaves has 2 to 5 speakers, not %r" % (size,))
    if band not in BANDS:
        raise PuzzleError("unknown band %r (easy, medium or hard)" % (band,))
    rng = random.Random("vno-puzzles:knights:%s:%s:%s" % (seed, band, size))
    sp = ["k%d" % (i + 1) for i in range(size)]
    for _ in range(max_tries):
        truth = {k: rng.random() < 0.5 for k in sp}
        if size >= 3 and (all(truth.values()) or not any(truth.values())):
            continue
        cands = []
        for c in _claims(rng, sp, band):
            for x in sp:
                if truth[x] == claim_true(c, truth) and not (c["type"] in ("knight", "knave") and c["who"] == x):
                    cands.append({"speaker": x, "claim": c})
        rng.shuffle(cands)
        base = {"format": FORMAT, "kind": "knights", "size": size, "seed": seed, "band": band, "speakers": sp, "solution": {k: KNIGHT if truth[k] else KNAVE for k in sp}}
        chosen = []
        for c in cands:
            chosen.append(c)
            q = _with_ids(base, chosen)
            if count_solutions(q, 2) == 1:
                break
        else:
            continue
        keep = list(chosen)
        # every speaker must say something: a silent speaker would be a clue nobody wrote (VNO-26)
        for x in sp:
            if not any(c["speaker"] == x for c in keep):
                extra = next((c for c in cands if c["speaker"] == x and c not in keep), None)
                if extra is not None:
                    keep.append(extra)
        order = list(range(len(keep)))
        rng.shuffle(order)
        gone = set()
        for i in order:
            trial = [c for j, c in enumerate(keep) if j != i and j not in gone]
            if all(any(c["speaker"] == x for c in trial) for x in sp) and count_solutions(_with_ids(base, trial), 2) == 1:
                gone.add(i)
        stmts = [c for j, c in enumerate(keep) if j not in gone]
        if {c["speaker"] for c in stmts} != set(sp):
            continue
        rng.shuffle(stmts)
        p = _with_ids(base, stmts)
        res = deduce(p)
        if not res["solved"] or band_of(res) != band:
            continue
        p["difficulty"] = {"steps": len(res["steps"]), "score": res["score"], "rules": res["rules"]}
        p["steps"] = res["steps"]
        return fill_knights(p)
    raise PuzzleError("no %s knights puzzle found for seed %s in %d tries" % (band, seed, max_tries))


def _with_ids(base, stmts):
    q = dict(base)
    q["statements"] = [dict(s, id="t%d" % (i + 1)) for i, s in enumerate(stmts)]
    return q


# ---- the player's side ----

def check_solution(p, marks):
    """{correct, wrong}: `marks` maps speakers to "knight" or "knave"; `wrong` lists the speakers that are unmarked or marked wrong."""
    wrong = [k for k, v in p["solution"].items() if marks.get(k) != v]
    return {"correct": not wrong, "wrong": wrong}


def hint(p, marks):
    nm = p["names"]
    bad = [k for k, v in marks.items() if p["solution"].get(k) != v]
    if bad:
        return {"kind": "wrong", "cell": bad[0], "text": "Look again at %s." % nm[bad[0]]}
    for step in p["steps"]:
        if marks.get(step["who"]) != step["value"]:
            return {"kind": "step", "cell": step["who"], "text": step_text(p, step, nm)}
    return {"kind": "accuse", "cell": "", "text": "Everyone is marked. Submit your answer."}


def is_complete(p, marks):
    return all(marks.get(k) == v for k, v in p["solution"].items())


# ---- the flavour check ----

def _norm(s):
    return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in str(s)).split())


def _read_claim(rc, table, sp):
    """A claim written by the reader (with names) as a claim of ids. Raises ValueError with what is wrong."""
    if not isinstance(rc, dict) or rc.get("type") not in CLAIMS:
        raise ValueError("unknown claim type %r" % (rc.get("type") if isinstance(rc, dict) else rc,))

    def one(name):
        i = table.get(_norm(name))
        if i is None:
            raise ValueError("%r is not a speaker of this puzzle" % (name,))
        return i

    t = rc["type"]
    if t in ("knight", "knave"):
        return {"type": t, "who": one(rc.get("who"))}
    if t in ("same", "diff"):
        return {"type": t, "a": one(rc.get("a")), "b": one(rc.get("b"))}
    if t in ("some_knave", "all_knight"):
        return {"type": t, "of": [one(x) for x in rc.get("of") or []]}
    if t == "exactly":
        if not isinstance(rc.get("k"), int):
            raise ValueError("an exactly claim needs the number k")
        return {"type": t, "k": rc["k"], "of": [one(x) for x in rc.get("of") or []]}
    if t == "not":
        return {"type": t, "c": _read_claim(rc.get("c"), table, sp)}
    return {"type": t, "a": _read_claim(rc.get("a"), table, sp), "b": _read_claim(rc.get("b"), table, sp)}


def _claim_names(rc, out, groups=None):
    """The names a reader's claim uses. The names of an `of` list go to `groups` (when given): the prose may say "us" for them."""
    if isinstance(rc, dict):
        for key in ("who", "a", "b"):
            v = rc.get(key)
            if isinstance(v, str):
                out.append(v)
        if isinstance(rc.get("of"), list):
            (groups if groups is not None else out).extend(x for x in rc["of"] if isinstance(x, str))
        for key in ("c", "a", "b"):
            if isinstance(rc.get(key), dict):
                _claim_names(rc[key], out, groups)
    return out


def _check_intro(r, intro, bad):
    """The reader's statement of the intro's rule, `{id: "intro", truthTellers, liars}`: the words of the prose for those who always tell
    the truth and for those who always lie. Returns (truthTellers, liars) when sound, else None after reporting the problem with `bad`."""
    it = {"id": "intro"}
    if r is None:
        bad(it, 'the reader gave no rule for the intro: answer {"id": "intro", "truthTellers": ..., "liars": ...}')
        return None
    tt, li = r.get("truthTellers"), r.get("liars")
    if not isinstance(tt, str) or not isinstance(li, str) or not _norm(tt) or not _norm(li):
        bad(it, "the intro rule needs the words of the prose for those who always tell the truth (truthTellers) and for those who always lie (liars)")
        return None
    prose = _norm(intro)
    gone = [w for w in (tt, li) if _norm(w) not in prose]
    if gone:
        bad(it, "the reader named %s, which the intro does not contain" % ", ".join(repr(w) for w in gone))
        return None
    if _norm(tt) == _norm(li):
        bad(it, "the intro rule gives the same words to those who tell the truth and those who lie")
        return None
    words_tt, words_li = _norm(tt).split(), _norm(li).split()
    if any(w.startswith("knave") for w in words_tt) or any(w.startswith("knight") for w in words_li):
        bad(it, "the intro says that knaves tell the truth or that knights lie: knights always tell the truth and knaves always lie")
        return None
    return tt, li


def check_knights_text(p, read_back, text=None):
    """{ok, problems, differing}: the reader's statements `{id, speaker, claim}` (names) must mean the same claims as the originals, in every
    assignment; then they must still give one solution that can be found without guessing."""
    validate_knights(p)
    table = {}
    for k, name in p["names"].items():
        table[_norm(name)] = k
        table[_norm(k)] = k
    by_id = {r.get("id"): r for r in read_back}
    problems, differing, rebuilt = [], [], []

    def bad(s, problem):
        problems.append({"clue": s["id"], "problem": problem})
        differing.append(s["id"])

    # the intro: the rule the reader states back (who always tells the truth, who always lies), in the words of the prose. Only when the
    # prose of the intro is given (text); a puzzle read without prose has no intro to check.
    rule = None
    intro = (text or {}).get("intro")
    if intro:
        rule = _check_intro(by_id.get("intro"), intro, bad)

    for s in p["statements"]:
        r = by_id.get(s["id"])
        if r is None:
            bad(s, "the reader gave no statement for this one")
            continue
        sid = table.get(_norm(r.get("speaker", "")))
        if sid is None:
            bad(s, "the reader named the speaker %r, who is not a speaker of this puzzle" % (r.get("speaker"),))
            continue
        try:
            claim = _read_claim(r.get("claim"), table, p["speakers"])
        except ValueError as e:
            bad(s, str(e))
            continue
        if text is not None and s["id"] in text:
            prose = _norm(text[s["id"]])
            groups = []
            direct = [r.get("speaker")] + _claim_names(r.get("claim"), [], groups)
            says_us = "us" in prose.split()
            def appears(n):
                it = table.get(_norm(n))
                return _norm(n) in prose or (it is not None and _norm(p["names"][it]) in prose)

            missing = [n for n in direct + ([] if says_us else groups) if not appears(n)]
            if missing:
                bad(s, "the reader named %s, which the prose does not contain" % ", ".join(repr(n) for n in missing))
                continue
        if rule and isinstance(r.get("claim"), dict) and r["claim"].get("type") in ("knight", "knave"):
            prose = _norm(text[s["id"]]) if text and s["id"] in text else ""
            truth, lie = _norm(rule[0]) in prose, _norm(rule[1]) in prose
            expect = "knight" if truth and not lie else "knave" if lie and not truth else None
            if expect and r["claim"]["type"] != expect:
                bad(s, "the statement uses the intro's words for %s, but the reader read a %s: the intro and the statements disagree about who tells the truth" % ("those who tell the truth" if expect == "knight" else "those who lie", r["claim"]["type"]))
                continue
        if sid != s["speaker"]:
            bad(s, "the prose is said by someone else than the statement says")
            continue
        same = all(claim_true(s["claim"], a) == claim_true(claim, a) for a in _assignments(p))
        if not same:
            bad(s, "the prose means something else than the statement")
            continue
        rebuilt.append({"id": s["id"], "speaker": sid, "claim": claim})
    if not problems:
        q = dict(p, statements=rebuilt)
        if count_solutions(q, 2) != 1:
            problems.append({"clue": "", "problem": "the read-back statements do not give exactly one solution"})
        elif not deduce(q)["solved"]:
            problems.append({"clue": "", "problem": "the read-back statements cannot be solved without guessing"})
    return {"ok": not problems, "problems": problems, "differing": differing}
