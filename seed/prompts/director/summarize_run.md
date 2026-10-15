---
kind: prompt
role: director
task: summarize_run
---
Project: "{{title}}" ({{slug}}).

A pipeline run has finished. These are its steps, with their status and what each reported:
{{steps}}

Write a status summary for the project log: two to four plain sentences saying what was built, what was skipped or failed, and what the user should look at next (for example an asset that failed, a language with no voice, a lint problem). Do not repeat every step. If a step failed or was skipped and a rerun would help, list it in `redo` with the step name and the reason; otherwise `redo` is empty.

Answer with one JSON object and nothing else:
{"summary": "...", "redo": [{"step": "generate", "reason": "two backgrounds failed"}]}
