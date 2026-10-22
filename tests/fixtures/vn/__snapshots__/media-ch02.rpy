# Chapter 2: The Lamp
label ch_02:

    play music "audio/music_02.ogg" fadein 2.0 loop if_changed
    scene black
    with vn_fade
    call screen chapter_card(_("The Lamp"))

    # scene ch02.s01: Lighthouse
    scene bg lighthouse_any
    with vn_dissolve
    stop music fadeout 2.0
    show mara thinking at center
    with vn_show
    # beat:ch02.s01.b002
    mara "It was never broken."
    # beat:ch02.s01.b003
    "And the night went on."

    # end of chapter 2
    call screen the_end(_("Mara kept the lamp burning."))
    return
