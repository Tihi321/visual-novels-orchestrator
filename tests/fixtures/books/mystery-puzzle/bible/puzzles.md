---
{
 "kind": "puzzles",
 "puzzles": [
  {
   "key": "dinner",
   "kind": "murdle",
   "title": "The Dinner Party",
   "chapter": 2,
   "core": {
    "band": "medium",
    "categories": [
     {
      "items": [
       "s1",
       "s2",
       "s3"
      ],
      "key": "suspect"
     },
     {
      "items": [
       "w1",
       "w2",
       "w3"
      ],
      "key": "weapon"
     },
     {
      "items": [
       "p1",
       "p2",
       "p3"
      ],
      "key": "place"
     }
    ],
    "clues": [
     {
      "a": "s2",
      "b": "w1",
      "id": "c1",
      "type": "not"
     },
     {
      "a": "p2",
      "b": [
       "w1",
       "w3"
      ],
      "id": "c2",
      "type": "either"
     },
     {
      "a": "s2",
      "b": [
       "p2",
       "p3"
      ],
      "id": "c3",
      "type": "either"
     },
     {
      "a": "s3",
      "b": "w1",
      "id": "c4",
      "type": "not"
     },
     {
      "a": "s3",
      "b": "p2",
      "id": "c5",
      "type": "is"
     }
    ],
    "difficulty": {
     "rules": {
      "clue": 5,
      "elim": 14,
      "last": 6,
      "trans": 2
     },
     "score": 37,
     "steps": 27
    },
    "format": 1,
    "kind": "murdle",
    "murder": {
     "answer": {
      "place": "p1",
      "suspect": "s1",
      "weapon": "w1"
     },
     "place": "p1"
    },
    "seed": 1,
    "size": 3,
    "solution": {
     "s1": {
      "place": "p1",
      "weapon": "w1"
     },
     "s2": {
      "place": "p3",
      "weapon": "w2"
     },
     "s3": {
      "place": "p2",
      "weapon": "w3"
     }
    },
    "steps": [
     {
      "cell": [
       "s2",
       "w1"
      ],
      "clue": "c1",
      "rule": "clue",
      "value": "no"
     },
     {
      "cell": [
       "w2",
       "p2"
      ],
      "clue": "c2",
      "rule": "clue",
      "value": "no"
     },
     {
      "cell": [
       "s2",
       "p1"
      ],
      "clue": "c3",
      "rule": "clue",
      "value": "no"
     },
     {
      "cell": [
       "s3",
       "w1"
      ],
      "clue": "c4",
      "rule": "clue",
      "value": "no"
     },
     {
      "cell": [
       "s3",
       "p2"
      ],
      "clue": "c5",
      "rule": "clue",
      "value": "yes"
     },
     {
      "cell": [
       "s3",
       "p1"
      ],
      "from": [
       [
        "s3",
        "p2"
       ]
      ],
      "rule": "elim",
      "value": "no"
     },
     {
      "cell": [
       "s3",
       "p3"
      ],
      "from": [
       [
        "s3",
        "p2"
       ]
      ],
      "rule": "elim",
      "value": "no"
     },
     {
      "cell": [
       "s1",
       "p2"
      ],
      "from": [
       [
        "s3",
        "p2"
       ]
      ],
      "rule": "elim",
      "value": "no"
     },
     {
      "cell": [
       "s2",
       "p2"
      ],
      "from": [
       [
        "s3",
        "p2"
       ]
      ],
      "rule": "elim",
      "value": "no"
     },
     {
      "cell": [
       "s1",
       "w1"
      ],
      "from": [
       [
        "s2",
        "w1"
       ],
       [
        "s3",
        "w1"
       ]
      ],
      "rule": "last",
      "value": "yes"
     },
     {
      "cell": [
       "s1",
       "w2"
      ],
      "from": [
       [
        "s1",
        "w1"
       ]
      ],
      "rule": "elim",
      "value": "no"
     },
     {
      "cell": [
       "s1",
       "w3"
      ],
      "from": [
       [
        "s1",
        "w1"
       ]
      ],
      "rule": "elim",
      "value": "no"
     },
     {
      "cell": [
       "s2",
       "p3"
      ],
      "from": [
       [
        "s2",
        "p1"
       ],
       [
        "s2",
        "p2"
       ]
      ],
      "rule": "last",
      "value": "yes"
     },
     {
      "cell": [
       "s1",
       "p3"
      ],
      "from": [
       [
        "s2",
        "p3"
       ]
      ],
      "rule": "elim",
      "value": "no"
     },
     {
      "cell": [
       "s1",
       "p1"
      ],
      "from": [
       [
        "s1",
        "p2"
       ],
       [
        "s1",
        "p3"
       ]
      ],
      "rule": "last",
      "value": "yes"
     },
     {
      "cell": [
       "w1",
       "p1"
      ],
      "from": [
       [
        "s1",
        "w1"
       ],
       [
        "s1",
        "p1"
       ]
      ],
      "rule": "trans",
      "value": "yes"
     },
     {
      "cell": [
       "w1",
       "p2"
      ],
      "from": [
       [
        "w1",
        "p1"
       ]
      ],
      "rule": "elim",
      "value": "no"
     },
     {
      "cell": [
       "w1",
       "p3"
      ],
      "from": [
       [
        "w1",
        "p1"
       ]
      ],
      "rule": "elim",
      "value": "no"
     },
     {
      "cell": [
       "w2",
       "p1"
      ],
      "from": [
       [
        "w1",
        "p1"
       ]
      ],
      "rule": "elim",
      "value": "no"
     },
     {
      "cell": [
       "w3",
       "p1"
      ],
      "from": [
       [
        "w1",
        "p1"
       ]
      ],
      "rule": "elim",
      "value": "no"
     },
     {
      "cell": [
       "w2",
       "p3"
      ],
      "from": [
       [
        "w2",
        "p1"
       ],
       [
        "w2",
        "p2"
       ]
      ],
      "rule": "last",
      "value": "yes"
     },
     {
      "cell": [
       "w3",
       "p3"
      ],
      "from": [
       [
        "w2",
        "p3"
       ]
      ],
      "rule": "elim",
      "value": "no"
     },
     {
      "cell": [
       "w3",
       "p2"
      ],
      "from": [
       [
        "w3",
        "p1"
       ],
       [
        "w3",
        "p3"
       ]
      ],
      "rule": "last",
      "value": "yes"
     },
     {
      "cell": [
       "s2",
       "w2"
      ],
      "from": [
       [
        "s2",
        "p3"
       ],
       [
        "w2",
        "p3"
       ]
      ],
      "rule": "trans",
      "value": "yes"
     },
     {
      "cell": [
       "s2",
       "w3"
      ],
      "from": [
       [
        "s2",
        "w2"
       ]
      ],
      "rule": "elim",
      "value": "no"
     },
     {
      "cell": [
       "s3",
       "w2"
      ],
      "from": [
       [
        "s2",
        "w2"
       ]
      ],
      "rule": "elim",
      "value": "no"
     },
     {
      "cell": [
       "s3",
       "w3"
      ],
      "from": [
       [
        "s3",
        "w1"
       ],
       [
        "s3",
        "w2"
       ]
      ],
      "rule": "last",
      "value": "yes"
     }
    ]
   },
   "names": {
    "p1": "library",
    "p2": "kitchen",
    "p3": "garden",
    "s1": "Colonel Ash",
    "s2": "Doctor Birch",
    "s3": "Miss Cole",
    "w1": "rope",
    "w2": "candlestick",
    "w3": "poison"
   },
   "text": {
    "c1": "Doctor Birch did not have the rope.",
    "c2": "Either the rope or the poison was in the kitchen.",
    "c3": "Doctor Birch was either in the kitchen or the garden.",
    "c4": "Miss Cole did not have the rope.",
    "c5": "Miss Cole was in the kitchen.",
    "murder": "The body was found in the library."
   }
  },
  {
   "key": "courtroom",
   "kind": "testimony",
   "chapter": 3,
   "core": {
    "band": "medium",
    "difficulty": {
     "rules": {
      "clash": 1,
      "near": 1
     },
     "score": 24,
     "steps": 3
    },
    "evidence": [
     {
      "facts": [
       {
        "key": "guest",
        "value": "the cook"
       }
      ],
      "id": "e1"
     },
     {
      "facts": [
       {
        "key": "weather",
        "value": "raining"
       }
      ],
      "id": "e2"
     },
     {
      "facts": [
       {
        "key": "weather",
        "value": "raining"
       }
      ],
      "id": "e3"
     },
     {
      "facts": [
       {
        "key": "lamp",
        "value": "dark"
       }
      ],
      "id": "e4"
     }
    ],
    "format": 1,
    "keys": [
     {
      "claim": "I heard the clock strike {v} just before the scream",
      "fact": "It is stopped, and it reads {v} o'clock",
      "item": "pocket watch",
      "key": "clock",
      "label": "the hour the clock struck",
      "values": [
       "nine",
       "ten",
       "eleven",
       "twelve"
      ]
     },
     {
      "claim": "The study door was {v} when I passed it",
      "fact": "It says the study door was {v} that evening",
      "item": "key log",
      "key": "door",
      "label": "the state of the study door",
      "values": [
       "locked",
       "open",
       "ajar"
      ]
     },
     {
      "claim": "The lamp in the hall was {v}",
      "fact": "It shows the hall lamp {v}",
      "item": "photograph",
      "key": "lamp",
      "label": "the hall lamp",
      "values": [
       "lit",
       "dark",
       "dim"
      ]
     },
     {
      "claim": "It was {v} outside",
      "fact": "It says it was {v} that night",
      "item": "weather report",
      "key": "weather",
      "label": "the weather that night",
      "values": [
       "raining",
       "dry",
       "foggy"
      ]
     },
     {
      "claim": "I saw the {v} on the table",
      "fact": "It lists the {v} on the table",
      "item": "inventory",
      "key": "weapon",
      "label": "what lay on the table",
      "values": [
       "rope",
       "candlestick",
       "poison",
       "dagger"
      ]
     },
     {
      "claim": "{v} left first",
      "fact": "It shows {v} leaving first",
      "item": "guest list",
      "key": "guest",
      "label": "who left first",
      "values": [
       "the doctor",
       "the colonel",
       "the cook"
      ]
     }
    ],
    "kind": "testimony",
    "seed": 4,
    "size": 5,
    "solution": {
     "evidence": "e1",
     "press": true,
     "statement": "t5"
    },
    "statements": [
     {
      "claims": [
       {
        "key": "clock",
        "value": "twelve"
       }
      ],
      "id": "t1"
     },
     {
      "claims": [
       {
        "key": "door",
        "value": "open"
       }
      ],
      "id": "t2",
      "press": {
       "claims": [
        {
         "key": "lamp",
         "value": "dark"
        }
       ]
      }
     },
     {
      "claims": [
       {
        "key": "door",
        "value": "open"
       }
      ],
      "id": "t3",
      "press": {
       "claims": [
        {
         "key": "weapon",
         "value": "dagger"
        }
       ]
      }
     },
     {
      "claims": [
       {
        "key": "clock",
        "value": "twelve"
       }
      ],
      "id": "t4",
      "press": {
       "claims": [
        {
         "key": "door",
         "value": "open"
        }
       ]
      }
     },
     {
      "claims": [
       {
        "key": "door",
        "value": "open"
       }
      ],
      "id": "t5",
      "press": {
       "claims": [
        {
         "key": "guest",
         "value": "the colonel"
        }
       ]
      }
     }
    ],
    "steps": [
     {
      "evidence": "e1",
      "key": "guest",
      "rule": "look",
      "statement": "t5",
      "value": ""
     },
     {
      "rule": "press",
      "statement": "t5",
      "value": ""
     },
     {
      "evidence": "e1",
      "rule": "present",
      "statement": "t5",
      "value": ""
     }
    ],
    "witness": "wit"
   },
   "names": {
    "e1": "guest list",
    "e2": "weather report",
    "e3": "weather report 2",
    "e4": "photograph",
    "wit": "Mr Halloran"
   },
   "text": {
    "e1": "guest list: It shows the cook leaving first.",
    "e2": "weather report: It says it was raining that night.",
    "e3": "weather report 2: It says it was raining that night.",
    "e4": "photograph: It shows the hall lamp dark.",
    "intro": "Mr Halloran is giving testimony. Press a statement to hear more, and present the evidence that proves one of them false.",
    "t1": "I heard the clock strike twelve just before the scream.",
    "t2": "The study door was open when I passed it.",
    "t2.press": "Now that you ask. The lamp in the hall was dark.",
    "t3": "The study door was open when I passed it.",
    "t3.press": "Now that you ask. I saw the dagger on the table.",
    "t4": "I heard the clock strike twelve just before the scream.",
    "t4.press": "Now that you ask. The study door was open when I passed it.",
    "t5": "The study door was open when I passed it.",
    "t5.press": "Now that you ask. The colonel left first."
   },
   "testimony": {
    "witness": "Mr Halloran",
    "breaks": [
     {
      "statement": 5,
      "evidence": "guest_list"
     }
    ],
    "evidence": [
     {
      "key": "guest_list",
      "description": "A guest list in a neat hand"
     },
     {
      "key": "weather_report",
      "description": "A weather report, folded twice"
     },
     {
      "key": "weather_report_2",
      "description": "A second weather report from the next town"
     },
     {
      "key": "photograph",
      "description": "A photograph of the dark hall"
     }
    ]
   }
  }
 ]
}
---

The puzzles of the book: the dinner party (a Murdle) and the courtroom (a cross-examination).
