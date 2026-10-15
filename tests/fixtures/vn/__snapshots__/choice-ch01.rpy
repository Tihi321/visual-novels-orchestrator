# Chapter 1: The Crossroads
label ch_01:

    play music "audio/music_02.ogg" fadein 2.0 loop if_changed
    scene black
    with vn_fade
    call screen chapter_card(_("The Crossroads"))

    # scene ch01.s01: Crossroads
    scene bg crossroads_day
    with vn_dissolve
    show petra thinking at left
    show mango happy at right
    with vn_show
    # beat:ch01.s01.b002
    petra "Which way, Mango?"
    # beat:ch01.s01.b003
    mango "Where the bread smells!"
    # beat:ch01.s01.b004
    "Two streets lay ahead."

    # end of chapter 1
    menu:
        "Go down Bakery Street":
            jump ch_02
        "Go down River Street":
            jump ch_03
