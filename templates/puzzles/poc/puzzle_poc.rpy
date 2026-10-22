## The proof of concept: a short intro, a 3x3 Murdle puzzle, an accusation and a reply. Not part of any normal build.

default vno_poc_seed = 1
default vno_poc_band = "medium"
default vno_poc = None
default vno_poc_big = False

label puzzle_poc:
    scene black
    "The dinner at Hartley Manor had gone cold before anyone noticed the body."
    "Three guests were still in the house, each with a different story, and the storm had cut the road."
    "You have the notes of the evening. Work out who did it, with what, and where."
    jump puzzle_poc_make

label puzzle_poc_make:
    if vno_poc_big:
        $ vno_poc = vno_puzzles.generate("murdle", 4, vno_poc_seed, vno_poc_band, motive=True, attrs=True)
    else:
        $ vno_poc = vno_puzzles.generate("murdle", 3, vno_poc_seed, vno_poc_band)
    $ vno_ps_reset("poc")
    jump puzzle_poc_play

label puzzle_poc_play:
    call vno_puzzle_play("poc", vno_poc)
    $ vno_poc_answer = vno_poc["murder"]["answer"]
    $ vno_poc_who = vno_poc["names"][vno_poc_answer["suspect"]]
    $ vno_poc_with = vno_poc["names"][vno_poc_answer["weapon"]]
    $ vno_poc_where = vno_poc["names"][vno_poc_answer["place"]]
    if _return:
        "That is it. [vno_poc_who] did it, with the [vno_poc_with], in the [vno_poc_where]."
    else:
        "You put the notes away. It was [vno_poc_who], with the [vno_poc_with], in the [vno_poc_where]."
    menu:
        "What now?"
        "A bigger puzzle (4x4, with a motive and clues about traits)":
            $ vno_poc_big = True
            $ vno_poc_seed = renpy.random.randint(1, 10**9)
            jump puzzle_poc_make
        "Another puzzle (easy)":
            $ vno_poc_big = False
            $ vno_poc_band = "easy"
            $ vno_poc_seed = renpy.random.randint(1, 10**9)
            jump puzzle_poc_make
        "Another puzzle (medium)":
            $ vno_poc_big = False
            $ vno_poc_band = "medium"
            $ vno_poc_seed = renpy.random.randint(1, 10**9)
            jump puzzle_poc_make
        "Another puzzle (hard)":
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
    $ vno_poc_big = True
    $ vno_poc_band = "medium"
    $ vno_poc_seed = 2
    jump puzzle_poc_make
