## The puzzle screens (phase 1: a 3x3 Murdle grid) and the label that plays one.
##
## The logic lives in the package game/python-packages/vno_puzzles. These screens only draw the grid and call it. Puzzle data is plain
## dicts and lists, kept in `default` variables, so Ren'Py saves it and rolls it back. The library never changes a value it is given:
## the helpers below assign a new one, so a rollback finds the old one intact.

init python:
    import vno_puzzles
    from vno_puzzles import play as vno_play
    from vno_puzzles import testimony as vno_tm

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

    def vno_kk_set(pid, who, value):
        """Knights and Knaves: mark a speaker as a knight or a knave (the same mark again clears it)."""
        st = vno_ps(pid)
        st["history"] = st["history"] + [st["marks"]]
        st["marks"] = vno_play.set_mark(st["marks"], who, "" if st["marks"].get(who) == value else value)
        renpy.restart_interaction()

    def vno_tm_at(pid):
        """Testimony: the number of the statement on show (0 is the first)."""
        return vno_ps(pid).get("at", 0)

    def vno_tm_go(pid, p, step):
        """Testimony: to the next statement (step 1) or the one before (step -1); the witness goes round."""
        st = vno_ps(pid)
        st["at"] = (st.get("at", 0) + step) % len(p["statements"])
        renpy.restart_interaction()

    def vno_tm_press(pid, p):
        """Testimony: press the statement on show. It stays pressed (and its extra words stay on screen)."""
        st = vno_ps(pid)
        sid = p["statements"][st.get("at", 0)]["id"]
        st["marks"] = vno_play.set_mark(st["marks"], sid, "pressed")
        renpy.restart_interaction()

    def vno_tm_lives(p):
        """Testimony: the length of the penalty bar (onFail.maxTries, else 5)."""
        return vno_max_tries(p) or 5

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

    def vno_title(p):
        """What the puzzle asks."""
        if p.get("murder"):
            return "Who did it, with what, where and why?" if "motive" in p["murder"]["answer"] else "Who did it, with what, and where?"
        return p.get("text", {}).get("intro") or "Work out who goes with what."

    def vno_ask(key):
        return {"suspect": "Who did it?", "weapon": "With what?", "place": "Where?", "motive": "Why?"}.get(key, key)

    def vno_wrong_message(p, check):
        if p.get("kind") == "testimony":
            return "Objection overruled. That does not contradict the statement."
        n = len(check["wrong"])
        if p.get("murder"):
            return "Not quite. %d of the %d parts of that accusation are wrong." % (n, len(p["murder"]["answer"]))
        if p.get("kind") == "knights":
            return "Not quite. %d of the %d speakers are marked wrong, or not at all." % (n, len(p["speakers"]))
        return "Not quite. %d of the answers in your grid are not right yet." % n

    def vno_dev_line(p):
        d = p["difficulty"]
        return "steps %d, score %d, rules %s" % (d["steps"], d["score"], ", ".join("%s %d" % (k, v) for k, v in sorted(d["rules"].items())))

default vno_puzzle_state = {}
default vno_clues_found = {}
default vno_puzzle_failed = {}
default persistent.vno_auto_cross = True

## One cell of the grid: a button that shows nothing, a check mark or a cross.
screen vno_cell(pid, p, key, cs):
    $ v = vno_ps(pid)["marks"].get(key, "")
    button:
        xysize (cs, cs)
        margin (2, 2)
        background Solid("#ffffff26")
        hover_background Solid("#ffffff48")
        action Function(vno_mark_cycle, pid, key, p)
        alternate Function(vno_mark_no, pid, key)
        if v == "yes":
            text "✓" font "DejaVuSans.ttf" size int(cs * 0.66) color "#7fe39a" align (0.5, 0.5)
        elif v == "no":
            text "✗" font "DejaVuSans.ttf" size int(cs * 0.58) color "#e47c7c" align (0.5, 0.5)

## The head of a row (name, and a small picture when the item is a character or an object of the story).
screen vno_row_head(p, item, hw, cs):
    hbox:
        xsize hw
        ysize cs + 4
        spacing 8
        if item in p.get("pics", {}):
            add p["pics"][item] fit "contain" xysize (cs - 8, cs - 8) yalign 0.5
        text p["names"][item] size 22 yalign 0.5 xmaximum hw - (cs if item in p.get("pics", {}) else 0)

## The head of a column.
screen vno_col_head(p, item, cs):
    vbox:
        xsize cs + 4
        yalign 1.0
        spacing 2
        if item in p.get("pics", {}):
            add p["pics"][item] fit "contain" xysize (cs - 12, cs - 12) xalign 0.5
        text p["names"][item] size 16 xsize cs + 4 text_align 0.5

## The puzzle (Murdle, logic grids): the clues on the left, the grid on the right (it scrolls when it is big).
## Returns "hint", "accuse" or "giveup".
screen vno_murdle(pid, p):
    modal True
    zorder 100
    $ st = vno_ps(pid)
    $ cats = p["categories"]
    $ k = len(cats)
    $ n = len(cats[0]["items"])
    $ cs = 96 if n <= 3 else (72 if n == 4 else 60)
    $ gap = 14
    $ hw = 230
    $ found = vno_clues_found.get(pid, [])
    add Solid("#0d0d16ee")
    if "seed" in p:
        text ("seed %s, %s" % (p["seed"], p["band"])) size 18 color "#8888aa" xalign 1.0 xoffset -12 yoffset 6
    if config.developer:
        text vno_dev_line(p) size 18 color "#8888aa" xalign 1.0 xoffset -12 yoffset 28
    hbox:
        xpos 30
        ypos 24
        spacing 30
        vbox:
            xsize 600
            spacing 10
            text vno_title(p) size 36
            if "murder" in p["text"]:
                text p["text"]["murder"] size 28 color "#f0d890"
            text "Click a clue to strike it out." size 18 color "#8888aa"
            viewport:
                xsize 600
                ysize 700
                scrollbars "vertical"
                mousewheel True
                draggable True
                vbox:
                    spacing 6
                    for c in [x for x in p["clues"] if "at" not in x or x["id"] in found]:
                        $ struck = c["id"] in st["struck"]
                        textbutton p["text"][c["id"]]:
                            action Function(vno_strike, pid, c["id"])
                            text_size 26
                            text_strikethrough struck
                            text_color ("#777788" if struck else "#ffffff")
                            text_hover_color "#f0d890"
                            xsize 570
        vbox:
            spacing 10
            viewport:
                xsize 1220
                ysize 800
                scrollbars "both"
                mousewheel True
                draggable True
                vbox:
                    spacing 2
                    hbox:
                        null width hw
                        for c in range(k - 1):
                            for it in cats[c]["items"]:
                                use vno_col_head(p, it, cs)
                            null width gap
                    for r in range(1, k):
                        for it in cats[r]["items"]:
                            hbox:
                                use vno_row_head(p, it, hw, cs)
                                for c in range(k - 1):
                                    if c < r:
                                        for citem in cats[c]["items"]:
                                            use vno_cell(pid, p, citem + "|" + it, cs)
                                    else:
                                        null width (cs + 4) * n
                                    null width gap
                        null height gap
            hbox:
                spacing 24
                if p.get("hints", True):
                    textbutton "Hint" action Return("hint")
                textbutton "Undo" action Function(vno_undo, pid) sensitive bool(st["history"])
                textbutton "Clear" action Function(vno_clear, pid) sensitive bool(st["marks"])
                textbutton ("Accuse" if p.get("murder") else "Submit") action Return("accuse") text_color "#f0d890"
                textbutton "Give up" action Return("giveup")
                textbutton ("Auto-✗ after a ✓: " + ("on" if persistent.vno_auto_cross else "off")):
                    action ToggleField(persistent, "vno_auto_cross")
                    text_size 22
                    text_font "DejaVuSans.ttf"

## Knights and Knaves: the statements on the left, a Knight / Knave choice per speaker on the right. Returns "hint", "accuse" or "giveup".
screen vno_knights(pid, p):
    modal True
    zorder 100
    $ st = vno_ps(pid)
    $ nm = p["names"]
    $ pics = p.get("pics", {})
    add Solid("#0d0d16ee")
    if "seed" in p:
        text ("seed %s, %s" % (p["seed"], p["band"])) size 18 color "#8888aa" xalign 1.0 xoffset -12 yoffset 6
    if config.developer:
        text vno_dev_line(p) size 18 color "#8888aa" xalign 1.0 xoffset -12 yoffset 28
    hbox:
        xpos 40
        ypos 30
        spacing 50
        vbox:
            xsize 900
            spacing 14
            text vno_title(p) size 32
            text "Knights always tell the truth. Knaves always lie." size 22 color "#f0d890"
            viewport:
                xsize 900
                ysize 760
                scrollbars "vertical"
                mousewheel True
                draggable True
                vbox:
                    spacing 14
                    for s in p["statements"]:
                        hbox:
                            spacing 14
                            if s["speaker"] in pics:
                                add pics[s["speaker"]] fit "contain" xysize (96, 96) yalign 0.5
                            text p["text"][s["id"]] size 28 xsize 760 yalign 0.5
        vbox:
            xsize 760
            spacing 16
            text "Who is who?" size 32
            for k in p["speakers"]:
                hbox:
                    spacing 16
                    if k in pics:
                        add pics[k] fit "contain" xysize (72, 72) yalign 0.5
                    text nm[k] size 28 xsize 200 yalign 0.5
                    textbutton "Knight":
                        action Function(vno_kk_set, pid, k, "knight")
                        selected st["marks"].get(k) == "knight"
                        text_size 28
                    textbutton "Knave":
                        action Function(vno_kk_set, pid, k, "knave")
                        selected st["marks"].get(k) == "knave"
                        text_size 28
            null height 20
            hbox:
                spacing 24
                if p.get("hints", True):
                    textbutton "Hint" action Return("hint")
                textbutton "Undo" action Function(vno_undo, pid) sensitive bool(st["history"])
                textbutton "Clear" action Function(vno_clear, pid) sensitive bool(st["marks"])
                textbutton "Submit" action Return("accuse") text_color "#f0d890"
                textbutton "Give up" action Return("giveup")

## Testimony: the witness on show, a statement at a time. Press it for more, open the court record and present a piece of evidence. Returns
## "hint", "giveup" or ("present", evidence id).
screen vno_testimony(pid, p):
    modal True
    zorder 100
    default record = False
    $ st = vno_ps(pid)
    $ nm = p["names"]
    $ pics = p.get("pics", {})
    $ found = vno_clues_found.get(pid, [])
    $ at = vno_tm_at(pid)
    $ s = p["statements"][at]
    $ pressed = st["marks"].get(s["id"]) == "pressed"
    $ lives = vno_tm_lives(p)
    $ left = max(0, lives - st["tries"])
    add Solid("#0d0d16ee")
    if "seed" in p:
        text ("seed %s, %s" % (p["seed"], p["band"])) size 18 color "#8888aa" xalign 1.0 xoffset -12 yoffset 6
    if config.developer:
        text vno_dev_line(p) size 18 color "#8888aa" xalign 1.0 xoffset -12 yoffset 28
    vbox:
        xpos 60
        ypos 30
        xsize 1760
        spacing 20
        text vno_title(p) size 30 xsize 1500
        hbox:
            spacing 16
            text "Penalty" size 24 color "#f0d890" yalign 0.5
            for i in range(lives):
                add Solid("#d04040" if i < left else "#40262a") xysize (44, 22) yalign 0.5
        hbox:
            spacing 40
            if "wit" in pics:
                add pics["wit"] fit "contain" xysize (300, 460) yalign 0.0
            vbox:
                spacing 18
                text nm["wit"] size 26 color "#f0d890"
                text ("%d / %d" % (at + 1, len(p["statements"]))) size 22 color "#8888aa"
                frame:
                    padding (30, 24)
                    xsize 1200
                    vbox:
                        spacing 16
                        text p["text"][s["id"]] size 32 xsize 1140
                        if pressed:
                            if (s["id"] + ".press") in p["text"]:
                                text p["text"][s["id"] + ".press"] size 30 xsize 1140 color "#f0d890"
                            else:
                                text _("I have nothing to add.") size 30 color "#f0d890"
                hbox:
                    spacing 28
                    textbutton "< Back" action Function(vno_tm_go, pid, p, -1)
                    textbutton "Next >" action Function(vno_tm_go, pid, p, 1)
                    textbutton "Press" action Function(vno_tm_press, pid, p) sensitive not pressed text_color "#f0d890"
                    textbutton "Present" action SetScreenVariable("record", True) text_color "#f0d890"
                hbox:
                    spacing 28
                    if p.get("hints", True):
                        textbutton "Hint" action Return("hint")
                    textbutton "Give up" action Return("giveup")
    if record:
        add Solid("#000000c8")
        frame:
            align (0.5, 0.5)
            padding (40, 30)
            vbox:
                spacing 18
                text "Court record" size 40
                text "Pick the evidence that proves the statement on show false." size 24 color "#8888aa"
                hbox:
                    spacing 24
                    for e in [x for x in p["evidence"] if "at" not in x or x["id"] in found]:
                        button:
                            action Return(("present", e["id"]))
                            xsize 320
                            padding (10, 10)
                            vbox:
                                spacing 8
                                if e["id"] in pics:
                                    add pics[e["id"]] fit "contain" xysize (280, 200) xalign 0.5
                                text nm[e["id"]] size 28 color "#f0d890" xalign 0.5
                                text p["text"][e["id"]] size 22 xsize 290
                textbutton "Back" action SetScreenVariable("record", False)

## The accusation: one choice per category of the answer (suspect, weapon, place and, with a motive, why). Returns the picks, or None for Back.
screen vno_accuse(p):
    modal True
    zorder 110
    default pick = {}
    $ nm = p["names"]
    $ groups = [(c["key"], vno_ask(c["key"]), c["items"]) for c in p["categories"] if c["key"] in p["murder"]["answer"]]
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
                textbutton "Accuse" action Return(dict(pick)) sensitive len(pick) == len(groups)
                textbutton "Back" action Return(None)

## Plays one puzzle. Returns True for the right accusation, False when the player gives up.
## Phase 1: endless retries; a hint is offered after two wrong accusations.
label vno_puzzle_play(pid, p):
    $ vno_ps(pid)
    $ vno_result = None
    $ vno_limit = vno_max_tries(p)
    while vno_result is None:
        if p.get("kind") == "knights":
            call screen vno_knights(pid, p)
        elif p.get("kind") == "testimony":
            call screen vno_testimony(pid, p)
        else:
            call screen vno_murdle(pid, p)
        $ vno_action = _return
        if vno_action == "hint":
            $ vno_hint_text = vno_play.hint(p, vno_ps(pid)["marks"], vno_ps(pid)["hints"])["text"]
            $ vno_ps(pid)["hints"] += 1
            narrator "[vno_hint_text]"
        elif isinstance(vno_action, tuple):
            $ vno_check = vno_tm.check_present(p, p["statements"][vno_tm_at(pid)]["id"], vno_action[1], [k for k, v in vno_ps(pid)["marks"].items() if v == "pressed"])
            if vno_check["result"] == "correct":
                $ vno_result = True
            elif vno_check["result"] == "press_first":
                narrator "That is it, but the witness is holding something back. Press the statement first."
            else:
                $ vno_ps(pid)["tries"] += 1
                $ vno_wrong_text = vno_wrong_message(p, vno_check)
                narrator "[vno_wrong_text]"
                if vno_ps(pid)["tries"] >= vno_tm_lives(p):
                    if vno_limit:
                        narrator "The penalty bar is empty. The case is lost."
                        $ vno_result = False
                    else:
                        narrator "The penalty bar is empty. The judge calls a recess, and the cross-examination starts again."
                        $ vno_ps_reset(pid)
        elif vno_action == "accuse":
            $ vno_check = None
            if p.get("murder"):
                call screen vno_accuse(p)
                if isinstance(_return, dict) and _return:
                    $ vno_check = vno_play.check_accusation(p, _return)
            else:
                $ vno_check = vno_play.check_solution(p, vno_ps(pid)["marks"])
            if vno_check is not None:
                if vno_check["correct"]:
                    $ vno_result = True
                else:
                    $ vno_ps(pid)["tries"] += 1
                    $ vno_wrong_text = vno_wrong_message(p, vno_check)
                    narrator "[vno_wrong_text]"
                    if vno_limit and vno_ps(pid)["tries"] >= vno_limit:
                        narrator "That was the last chance."
                        $ vno_result = False
                    elif p.get("hints", True) and vno_ps(pid)["tries"] >= 2:
                        menu:
                            "Would you like a hint?"
                            "Yes, a hint please":
                                $ vno_hint_text = vno_play.hint(p, vno_ps(pid)["marks"], vno_ps(pid)["hints"])["text"]
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
