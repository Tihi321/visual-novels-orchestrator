## The puzzle screens (phase 1: a 3x3 Murdle grid) and the label that plays one.
##
## The logic lives in the package game/python-packages/vno_puzzles. These screens only draw the grid and call it. Puzzle data is plain
## dicts and lists, kept in `default` variables, so Ren'Py saves it and rolls it back. The library never changes a value it is given:
## the helpers below assign a new one, so a rollback finds the old one intact.

init python:
    import vno_puzzles
    from vno_puzzles import play as vno_play

    def vno_ps(pid):
        """The state of one puzzle: the player's marks, the struck-out clues, the undo history, the tries and hints used."""
        if pid not in vno_puzzle_state:
            vno_puzzle_state[pid] = {"marks": {}, "struck": [], "history": [], "tries": 0, "hints": 0}
        return vno_puzzle_state[pid]

    def vno_ps_reset(pid):
        vno_puzzle_state[pid] = {"marks": {}, "struck": [], "history": [], "tries": 0, "hints": 0}

    def vno_mark_cycle(pid, key, p):
        """A click: blank, then no, then yes, then blank. A yes can fill no along its row and column of the block (auto-no)."""
        st = vno_ps(pid)
        st["history"] = st["history"] + [st["marks"]]
        marks = vno_play.cycle_mark(st["marks"], key)
        if marks.get(key) == "yes" and persistent.vno_auto_cross:
            marks = vno_play.auto_cross(p, marks, key)
        st["marks"] = marks
        renpy.restart_interaction()

    def vno_mark_no(pid, key):
        """A right click or a long press: a no, or blank when it already is one."""
        st = vno_ps(pid)
        st["history"] = st["history"] + [st["marks"]]
        st["marks"] = vno_play.set_mark(st["marks"], key, "" if st["marks"].get(key) == "no" else "no")
        renpy.restart_interaction()

    def vno_undo(pid):
        st = vno_ps(pid)
        if st["history"]:
            st["marks"] = st["history"][-1]
            st["history"] = st["history"][:-1]
        renpy.restart_interaction()

    def vno_clear(pid):
        st = vno_ps(pid)
        if st["marks"]:
            st["history"] = st["history"] + [st["marks"]]
            st["marks"] = {}
        renpy.restart_interaction()

    def vno_strike(pid, clue_id):
        st = vno_ps(pid)
        if clue_id in st["struck"]:
            st["struck"] = [c for c in st["struck"] if c != clue_id]
        else:
            st["struck"] = st["struck"] + [clue_id]
        renpy.restart_interaction()

    def vno_clue_found(pid, clue_id):
        """A clue of a puzzle is found in the story (a `CLUE:` beat): the puzzle screen lists it from now on."""
        found = vno_clues_found.get(pid, [])
        if clue_id not in found:
            vno_clues_found[pid] = found + [clue_id]

    def vno_max_tries(p):
        """How many wrong accusations end the puzzle: 0 (never) for `retry`, else onFail.maxTries (default 3)."""
        fail = p.get("onFail")
        if not fail or fail.get("mode", "retry") == "retry":
            return 0
        return fail.get("maxTries", 3)

    def vno_dev_line(p):
        d = p["difficulty"]
        return "steps %d, score %d, rules %s" % (d["steps"], d["score"], ", ".join("%s %d" % (k, v) for k, v in sorted(d["rules"].items())))

default vno_puzzle_state = {}
default vno_clues_found = {}
default vno_puzzle_failed = {}
default persistent.vno_auto_cross = True

## One cell of the grid: a button that shows nothing, a check mark or a cross.
screen vno_cell(pid, p, key):
    $ v = vno_ps(pid)["marks"].get(key, "")
    button:
        xysize (96, 96)
        margin (2, 2)
        background Solid("#ffffff26")
        hover_background Solid("#ffffff48")
        action Function(vno_mark_cycle, pid, key, p)
        alternate Function(vno_mark_no, pid, key)
        if v == "yes":
            text "✓" font "DejaVuSans.ttf" size 64 color "#7fe39a" align (0.5, 0.5)
        elif v == "no":
            text "✗" font "DejaVuSans.ttf" size 56 color "#e47c7c" align (0.5, 0.5)

## The puzzle: the clues on the left, the grid on the right. Returns "hint", "accuse" or "giveup".
screen vno_murdle(pid, p):
    modal True
    zorder 100
    $ st = vno_ps(pid)
    $ nm = p["names"]
    $ people = p["categories"][0]["items"]
    $ weapons = p["categories"][1]["items"]
    $ places = p["categories"][2]["items"]
    add Solid("#0d0d16ee")
    if "seed" in p:
        text ("seed %s, %s" % (p["seed"], p["band"])) size 18 color "#8888aa" xalign 1.0 xoffset -12 yoffset 6
    if config.developer:
        text vno_dev_line(p) size 18 color "#8888aa" xalign 1.0 xoffset -12 yoffset 28
    hbox:
        xpos 40
        ypos 30
        spacing 40
        vbox:
            xsize 660
            spacing 12
            text "Who did it, with what, and where?" size 40
            text p["text"]["murder"] size 30 color "#f0d890"
            text "Click a clue to strike it out." size 20 color "#8888aa"
            $ found = vno_clues_found.get(pid, [])
            for c in [x for x in p["clues"] if "at" not in x or x["id"] in found]:
                $ struck = c["id"] in st["struck"]
                textbutton p["text"][c["id"]]:
                    action Function(vno_strike, pid, c["id"])
                    text_size 28
                    text_strikethrough struck
                    text_color ("#777788" if struck else "#ffffff")
                    text_hover_color "#f0d890"
                    xsize 660
        vbox:
            spacing 2
            hbox:
                null width 200 height 74
                for s in people:
                    text nm[s] size 20 xsize 100 text_align 0.5 yalign 1.0
                null width 14
                for pl in places:
                    text nm[pl] size 20 xsize 100 text_align 0.5 yalign 1.0
            for w in weapons:
                hbox:
                    text nm[w] size 24 xsize 200 yalign 0.5
                    for s in people:
                        use vno_cell(pid, p, s + "|" + w)
                    null width 14
                    for pl in places:
                        use vno_cell(pid, p, w + "|" + pl)
            null height 14
            for pl in places:
                hbox:
                    text nm[pl] size 24 xsize 200 yalign 0.5
                    for s in people:
                        use vno_cell(pid, p, s + "|" + pl)
            null height 18
            hbox:
                spacing 24
                if p.get("hints", True):
                    textbutton "Hint" action Return("hint")
                textbutton "Undo" action Function(vno_undo, pid) sensitive bool(st["history"])
                textbutton "Clear" action Function(vno_clear, pid) sensitive bool(st["marks"])
                textbutton "Accuse" action Return("accuse") text_color "#f0d890"
                textbutton "Give up" action Return("giveup")
            textbutton ("Auto-✗ after a ✓: " + ("on" if persistent.vno_auto_cross else "off")):
                action ToggleField(persistent, "vno_auto_cross")
                text_size 22
                text_font "DejaVuSans.ttf"

## The accusation: one choice of suspect, weapon and place. Returns {"suspect": .., "weapon": .., "place": ..}, or None for Back.
screen vno_accuse(p):
    modal True
    zorder 110
    default pick = {}
    $ nm = p["names"]
    $ groups = [("suspect", "Who did it?", p["categories"][0]["items"]), ("weapon", "With what?", p["categories"][1]["items"]), ("place", "Where?", p["categories"][2]["items"])]
    add Solid("#000000c8")
    frame:
        align (0.5, 0.5)
        padding (50, 36)
        vbox:
            spacing 22
            text "Make your accusation" size 44
            for key, label, its in groups:
                vbox:
                    spacing 8
                    text label size 28 color "#f0d890"
                    hbox:
                        spacing 16
                        for it in its:
                            textbutton nm[it]:
                                action SetDict(pick, key, it)
                                selected pick.get(key) == it
                                text_size 30
            hbox:
                spacing 40
                textbutton "Accuse" action Return(dict(pick)) sensitive len(pick) == 3
                textbutton "Back" action Return(None)

## Plays one puzzle. Returns True for the right accusation, False when the player gives up.
## Phase 1: endless retries; a hint is offered after two wrong accusations.
label vno_puzzle_play(pid, p):
    $ vno_ps(pid)
    $ vno_result = None
    $ vno_limit = vno_max_tries(p)
    while vno_result is None:
        call screen vno_murdle(pid, p)
        $ vno_action = _return
        if vno_action == "hint":
            $ vno_hint_text = vno_play.hint(p, vno_ps(pid)["marks"])["text"]
            $ vno_ps(pid)["hints"] += 1
            narrator "[vno_hint_text]"
        elif vno_action == "accuse":
            call screen vno_accuse(p)
            if isinstance(_return, dict) and _return:
                $ vno_check = vno_play.check_accusation(p, _return)
                if vno_check["correct"]:
                    $ vno_result = True
                else:
                    $ vno_ps(pid)["tries"] += 1
                    $ vno_n_wrong = len(vno_check["wrong"])
                    narrator "Not quite. [vno_n_wrong] of the three parts of that accusation are wrong."
                    if vno_limit and vno_ps(pid)["tries"] >= vno_limit:
                        narrator "That was the last chance."
                        $ vno_result = False
                    elif p.get("hints", True) and vno_ps(pid)["tries"] >= 2:
                        menu:
                            "Would you like a hint?"
                            "Yes, a hint please":
                                $ vno_hint_text = vno_play.hint(p, vno_ps(pid)["marks"])["text"]
                                $ vno_ps(pid)["hints"] += 1
                                narrator "[vno_hint_text]"
                            "No, I will keep looking":
                                pass
        elif vno_action == "giveup":
            $ vno_result = False
    if vno_result is False:
        $ vno_puzzle_failed[pid] = True
    $ renpy.block_rollback()
    return vno_result
