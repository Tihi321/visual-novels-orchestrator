## A smoke test for Ren'Py's own test runner (`renpy.exe <game> test puzzle_smoke`): it clicks through the grid, the hint and the accusation.
## Not part of the normal PoC build: `npx tsx scripts/puzzle-poc.ts --selftest` copies it in.

testcase puzzle_smoke:
    pause 1.0
    click "Start"
    advance until screen "vno_murdle"
    assert eval vno_puzzle_state["poc"]["marks"] == {}
    click "Hint"
    advance until screen "vno_murdle"
    assert eval vno_puzzle_state["poc"]["hints"] == 1
    click "Accuse"
    pause 0.5
    assert screen "vno_accuse"
    click "Back"
    pause 0.5
    assert screen "vno_murdle"
    assert eval vno_puzzle_state["poc"]["tries"] == 0

testcase puzzle_smoke_big:
    pause 1.0
    click "Start"
    advance until screen "vno_murdle"
    run Jump("puzzle_poc_big")
    pause 1.0
    advance until screen "vno_murdle"
    assert eval vno_poc["size"] == 4
    assert eval len(vno_poc["categories"]) == 4
    click "Accuse"
    pause 0.5
    assert screen "vno_accuse"
    click "Back"
    pause 0.5
    assert screen "vno_murdle"
