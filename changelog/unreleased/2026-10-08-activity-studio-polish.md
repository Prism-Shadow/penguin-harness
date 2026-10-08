# Activity studio: one account of a run, a stepper, a calmer header

- **Date:** 2026-10-08
- **Type:** feat
- **Scope:** `web`

**Build agrees with the run.** Build used to read only finished assemblies. While the
Assemble module stage was running, it said "Ready to assemble", offered a second Assemble,
and said the activity had never been assembled. It now says "Assembling now", and its button
reads "Assembling…" and stays disabled. The checks that pass fold into a "9 checks pass"
line that opens to the list. The header's running chip shows elapsed time and opens the
panel that follows the run.

**Stages read as a stepper.** A segmented progress bar and a "5 of 7" count sit above the
stages. Each stage shows how long it took, from its runs' times, and wears the shared
run-state icon. While a run goes on, its finished stages fold into one row, and the agent
and stage pickers fold into a line with Stop.

**The run log is quieter.** In a stage's log only, reasoning with no text folds into the
step it led to as "thought 49ms", and a failed step's row is tinted in the danger tone. Chat
is unchanged.

**The header holds less.** Ref settings, Change number, New ref and Reload draft move into a
menu on the ref's name, which also lists the product's other refs. The draft's state is a
pill beside the title. The product code is left out when the title already says it.

**The rail says more.** Section rows show unsaved edits, the specification's validity, and
how many scenes and audios there are. A section that cannot open yet says what it waits for.
Scenes go by the script's titles ("1 Intro") rather than their ids.

**The script editor tells media apart.** Audio, video, image and animation elements each
take their own categorical hue, with a soft wash over the words between the tags. Scene
headings sit under a hairline with their "Scene N:" set small. Prose wraps at about 92
characters. Diff is a segmented control, and Save script is the primary button only while
there is something to save.
