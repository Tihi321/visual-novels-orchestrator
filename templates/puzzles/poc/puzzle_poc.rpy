## The proof of concept: a short intro, a puzzle, an answer and a reply, for every kind of puzzle. Not part of any normal build.

default vno_poc_seed = 1
default vno_poc_band = "medium"
default vno_poc = None
default vno_poc_kind = "murdle"
default vno_poc_big = False

init python:
    def vno_poc_make():
        """A new puzzle of the chosen kind, band and seed."""
        if vno_poc_kind == "murdle" and vno_poc_big:
            return vno_puzzles.generate("murdle", 4, vno_poc_seed, vno_poc_band, motive=True, attrs=True)
        if vno_poc_kind == "knights":
            return vno_puzzles.generate("knights", 4, vno_poc_seed, vno_poc_band)
        if vno_poc_kind == "testimony":
            return vno_puzzles.generate("testimony", None, vno_poc_seed, vno_poc_band)
        if vno_poc_kind == "logic":
            return vno_puzzles.generate("logic", 4, vno_poc_seed, vno_poc_band)
        return vno_puzzles.generate(vno_poc_kind, None, vno_poc_seed, vno_poc_band)

    def vno_poc_reveal(p, won):
        """What the story says when the puzzle is over."""
        names = p["names"]
        if p["kind"] == "knights":
            lines = ["%s is a %s" % (names[k], v) for k, v in p["solution"].items()]
            return ("That is right. " if won else "You give up. ") + "; ".join(lines) + "."
        if p["kind"] == "logic":
            first = p["categories"][0]["items"]
            lines = [", ".join([names[d]] + [names[p["solution"][d][c["key"]]] for c in p["categories"][1:]]) for d in first]
            return ("That is right. " if won else "You give up. ") + "; ".join(lines) + "."
        if p["kind"] == "testimony":
            sol = p["solution"]
            return ("That is it. " if won else "You give up. ") + "The %s proves statement %s false." % (names[sol["evidence"]], sol["statement"][1:])
        a = p["murder"]["answer"]
        why = (", out of " + names[a["motive"]]) if "motive" in a else ""
        fact = "%s did it, with the %s, in the %s%s." % (names[a["suspect"]], names[a["weapon"]], names[a["place"]], why)
        return ("That is it. " if won else "You put the notes away. It was ") + fact

label puzzle_poc:
    scene black
    "The dinner at Hartley Manor had gone cold before anyone noticed the body."
    "Three guests were still in the house, each with a different story, and the storm had cut the road."
    "You have the notes of the evening. Work out who did it, with what, and where."
    jump puzzle_poc_make

label puzzle_poc_make:
    $ vno_poc = vno_poc_make()
    $ vno_ps_reset("poc")
    jump puzzle_poc_play

label puzzle_poc_play:
    call vno_puzzle_play("poc", vno_poc)
    $ vno_poc_reply = vno_poc_reveal(vno_poc, bool(_return))
    "[vno_poc_reply]"
    menu:
        "What now?"
        "A bigger Murdle (4x4, with a motive and clues about traits)":
            $ vno_poc_kind = "murdle"
            $ vno_poc_big = True
            $ vno_poc_seed = renpy.random.randint(1, 10**9)
            jump puzzle_poc_make
        "A logic grid (deliveries)":
            $ vno_poc_kind = "logic"
            $ vno_poc_seed = renpy.random.randint(1, 10**9)
            jump puzzle_poc_make
        "Testimony (cross-examination)":
            $ vno_poc_kind = "testimony"
            $ vno_poc_seed = renpy.random.randint(1, 10**9)
            jump puzzle_poc_make
        "Knights and Knaves":
            $ vno_poc_kind = "knights"
            $ vno_poc_seed = renpy.random.randint(1, 10**9)
            jump puzzle_poc_make
        "Another Murdle (easy)":
            $ vno_poc_kind = "murdle"
            $ vno_poc_big = False
            $ vno_poc_band = "easy"
            $ vno_poc_seed = renpy.random.randint(1, 10**9)
            jump puzzle_poc_make
        "Another Murdle (medium)":
            $ vno_poc_kind = "murdle"
            $ vno_poc_big = False
            $ vno_poc_band = "medium"
            $ vno_poc_seed = renpy.random.randint(1, 10**9)
            jump puzzle_poc_make
        "Another Murdle (hard)":
            $ vno_poc_kind = "murdle"
            $ vno_poc_big = False
            $ vno_poc_band = "hard"
            $ vno_poc_seed = renpy.random.randint(1, 10**9)
            jump puzzle_poc_make
        "The same puzzle again":
            $ vno_ps_reset("poc")
            jump puzzle_poc_play
        "Back to the main menu":
            return

## For the self-test: a 4x4 puzzle with a motive and clues about traits, from the start.
label puzzle_poc_big:
    $ vno_poc_kind = "murdle"
    $ vno_poc_big = True
    $ vno_poc_band = "medium"
    $ vno_poc_seed = 2
    jump puzzle_poc_make

## For the self-test: Knights and Knaves.
label puzzle_poc_knights:
    $ vno_poc_kind = "knights"
    $ vno_poc_big = False
    $ vno_poc_band = "medium"
    $ vno_poc_seed = 3
    jump puzzle_poc_make

## For the self-test: a cross-examination.
label puzzle_poc_testimony:
    $ vno_poc_kind = "testimony"
    $ vno_poc_big = False
    $ vno_poc_band = "medium"
    $ vno_poc_seed = 4
    jump puzzle_poc_make

## For the self-test: a logic grid.
label puzzle_poc_logic:
    $ vno_poc_kind = "logic"
    $ vno_poc_big = False
    $ vno_poc_band = "medium"
    $ vno_poc_seed = 5
    jump puzzle_poc_make
