# Chapter 1: The Harbour
label ch_01:

    play music "audio/music_02.ogg" fadein 2.0 loop if_changed
    scene black
    with vn_fade
    call screen chapter_card(_("The Harbour"))

    # scene ch01.s01: Harbour wall
    scene bg harbour_wall_dusk
    with vn_dissolve
    show mara worried at center
    with vn_show
    # beat:ch01.s01.b002
    "The sea was calm. {i}Too{/i} calm, thought Mara."
    # beat:ch01.s01.b003
    mara "Is that light [[still] on? It is {{not} 100% safe."
    show mara worried at left
    show tomo neutral at right
    with vn_show
    # beat:ch01.s01.b005
    tomo "She said \"come back\", {b}and{/b} I did."
    # beat:ch01.s01.b006
    extra_gull "Screech!"
    show mara happy
    with vn_show
    # beat:ch01.s01.b007
    mara "Then let us go up."

    # scene ch01.s02: Lighthouse
    scene black
    with vn_fade
    scene bg lighthouse_any
    with vn_dissolve
    show mara neutral at left
    show tomo surprised at center
    show dog neutral at right
    with vn_show
    # beat:ch01.s02.b002
    tomo "So many of you!"
    # beat:ch01.s02.b003
    "Back\\slash path."

    # end of chapter 1
    jump ch_02
