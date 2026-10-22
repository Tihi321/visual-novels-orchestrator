"""vno_puzzles: puzzle generators and solvers for VN Studio visual novels.

Pure Python, standard library only (the Python that ships with Ren'Py has no more). Puzzles are plain JSON-shaped data, see `model.py`.
The game imports this from `game/python-packages/`; the engine runs the same files at authoring time (`cli.py`).
"""

from .generator import generate, verify
from .model import FORMAT, PuzzleError, validate
from .play import auto_cross, check_accusation, check_marks, cycle_mark, hint, is_complete, set_mark
from .solver import band_of, count_solutions, deduce
from .text import clue_text, murder_text, render_text, step_text
from .verify import check_text

__version__ = "1.0"


def solve(p):
    """{unique, solutions, deducible, band, steps, score, rules}: the proof the engine asks for."""
    validate(p)
    n = count_solutions(p, 2)
    res = deduce(p)
    return {
        "unique": n == 1,
        "solutions": n,
        "deducible": res["solved"],
        "band": band_of(p, res) if res["solved"] else None,
        "steps": res["steps"],
        "score": res["score"],
        "rules": res["rules"],
    }


__all__ = [
    "FORMAT", "PuzzleError", "__version__", "auto_cross", "band_of", "check_accusation", "check_marks", "check_text", "clue_text", "render_text", "count_solutions",
    "cycle_mark", "deduce", "generate", "hint", "is_complete", "murder_text", "set_mark", "solve", "step_text", "validate", "verify",
]
