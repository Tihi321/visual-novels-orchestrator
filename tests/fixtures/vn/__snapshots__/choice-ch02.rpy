# Chapter 2: Bakery Street
label ch_02:

    play music "audio/music_02.ogg" fadein 2.0 loop if_changed
    scene black
    with vn_fade
    call screen chapter_card(_("Bakery Street"))

    # scene ch02.s01: Bakery street
    scene bg bakery_street_day
    with vn_dissolve
    show petra happy at center
    with vn_show
    # beat:ch02.s01.b002
    petra "Warm bread!"

    # end of chapter 2
    call screen the_end(_("Petra ate warm bread, and everyone was happy."))
    return
