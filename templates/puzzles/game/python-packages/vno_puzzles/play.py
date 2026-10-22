"""Game-time helpers. They never change what they are given: each returns a new value, so Ren'Py's rollback (which restores the old
reference held in a `default` variable) always finds the old value intact."""

from .model import all_cells, answer_of, category_index, cell_items, owners_of
from .text import step_text


def cycle_mark(marks, key):
    """blank -> no -> yes -> blank."""
    out = dict(marks)
    cur = out.get(key, "")
    nxt = {"": "no", "no": "yes", "yes": ""}[cur]
    if nxt:
        out[key] = nxt
    else:
        out.pop(key, None)
    return out


def set_mark(marks, key, value):
    out = dict(marks)
    if value:
        out[key] = value
    else:
        out.pop(key, None)
    return out


def auto_cross(p, marks, key):
    """After a yes at `key`: a no on every blank cell of its row and column in that block (a mark is never overwritten)."""
    if marks.get(key) != "yes":
        return dict(marks)
    a, b = cell_items(key)
    idx = category_index(p)
    out = dict(marks)
    for cell in all_cells(p):
        x, y = cell_items(cell)
        if cell == key or cell in out:
            continue
        if idx[x] == idx[a] and idx[y] == idx[b] and (x == a or y == b):
            out[cell] = "no"
    return out


def truth(p):
    """cell key -> "yes" or "no" in the solution."""
    owner = owners_of(p)
    return {c: ("yes" if owner[cell_items(c)[0]] == owner[cell_items(c)[1]] else "no") for c in all_cells(p)}


def check_accusation(p, accusation):
    """{correct, wrong}: `wrong` lists the parts (suspect, weapon, place) that are not the answer."""
    answer = answer_of(p)
    wrong = [k for k in answer if accusation.get(k) != answer[k]]
    return {"correct": not wrong, "wrong": wrong}


def check_solution(p, marks):
    """For puzzles without a question (logic grids, Knights and Knaves): the player's grid is right when every pair that goes together is
    marked yes and no pair is marked yes that does not (Knights and Knaves: everyone is marked right). `wrong` lists the cells at fault."""
    if p.get("kind") == "knights":
        from .knights import check_solution as check_knights

        return check_knights(p, marks)
    t = truth(p)
    wrong = [c for c, v in t.items() if (marks.get(c) == "yes") != (v == "yes")]
    return {"correct": not wrong, "wrong": wrong}


def check_marks(p, marks):
    """The marked cells that contradict the solution."""
    if p.get("kind") == "knights":
        return [k for k, v in marks.items() if p["solution"].get(k) != v]
    t = truth(p)
    return [c for c, v in marks.items() if t.get(c) != v]


def is_complete(p, marks):
    """Every cell is marked, and every mark is right."""
    if p.get("kind") == "knights":
        from .knights import is_complete as done

        return done(p, marks)
    t = truth(p)
    return all(marks.get(c) == v for c, v in t.items())


def hint(p, marks, hints=0):
    """{kind, text, cell}. A wrong mark first; else the first deduction step the grid does not show yet; else: accuse.
    Testimony: `hints` (how many were given already) says how much the hint gives away."""
    if p.get("kind") == "testimony":
        from .testimony import hint as hint_testimony

        return hint_testimony(p, marks, hints)
    if p.get("kind") == "knights":
        from .knights import hint as hint_knights

        return hint_knights(p, marks)
    nm = p["names"]
    bad = check_marks(p, marks)
    if bad:
        a, b = cell_items(bad[0])
        return {"kind": "wrong", "cell": bad[0], "text": "Look again at %s and %s." % (nm[a], nm[b])}
    for step in p["steps"]:
        key = "|".join(step["cell"])
        if marks.get(key) != step["value"]:
            return {"kind": "step", "cell": key, "text": step_text(p, step)}
    return {"kind": "accuse", "cell": "", "text": "The grid is complete. Make your accusation."}
