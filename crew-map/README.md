# Claude Crew (plugin `crew-map`)

A live view of what Claude and its helper Claudes are doing, for when you give Claude Code a task and want to *see* the work instead of scrolling through a transcript.

```
/plugin install crew-map --marketplace D3K1D/claude-crew-mods
```

Open it with `/crew` (it also opens by itself in a wide window). The repository's [README](../README.md) covers other ways to install it and troubleshooting.

## What you see

**Desks.** Across the top, every Claude at work has a desk: a small animated Claude (bobbing quickly when busy, slowly when thinking, with a "!" when it needs you and a tick when it's done), what it's on right now in large text (a file, or a command in plain words), the folder it's in, and the last few files it touched. A running Codex gets a desk too. Desks keep the same size, so nothing jumps as work comes and goes.

**Folder cards.** Below the desks, every folder the crew touched gets a card, in the order the work first reached it. Its files are chips you can click to open: green with +/− line counts when edited, red with a count when a build or test failed on them, dim when nobody has touched them for five minutes, and with a coloured dot while a Claude is on them. A card shows ten chips, and **+N more** opens the rest. Files outside your project get their own card, which **✕ hide** puts away (**👁 show outside** brings it back). Typing in the search box keeps only the matching files and their folders.

**The tree map.** **⊞ tree map** in the toolbar switches to the older view: every file as an icon hung under its folder or the file that imports it, with little Claudes swinging between them. Outlines say what happened to a file (dashed: not opened, light: read, green: edited, red: errors), and work that isn't a file gets a station down the right (the terminal, the web, browsers, computer use, documents, other MCP apps). Move it with **◀ ▲ ▼ ▶**, zoom with **− / +**, and **⤢ fit** shows all of it. **▤ desks** switches back.

**The windows.** Under the desks and cards, one window per Claude shows:

- its goal (your prompt, or the task a helper was given)
- a progress bar
- a cost line: the tokens its turns used and what they'd cost at Anthropic's API list prices (a subscription isn't billed per token, so treat it as a yardstick)
- how full its context is, with how often it was compacted (amber from 60%, red with "compacts soon" from 85%)
- what it's doing now, or its latest thought, and its last two actions

**Waiting on you.** When a Claude is waiting for a permission, an answer or a plan approval, the header says "⏸ N waiting on you", its desk and window turn amber and move to the front, and they say what it needs ("allow running Clear the old build folder").

**What else it's waiting on.** The main Claude's desk and window title also say when it's waiting on its helpers (in purple, with their names: "⏳ waiting on Scout"), on a command it runs or left running in the background (in orange, in Claude's own words: "⏳ waiting on Build the app"), or simply on you, once its turn is over and nothing else is running ("○ your turn").

**Finished helpers** keep their window for 20 seconds, then fold into a button on the log's title row. Click it to open the window again, and **– fold** puts it away.

The bar shows a percentage only when the Claude keeps a plan (Claude Code's task list, or a to-do list), since that's the only real measure of progress. It counts the tasks that Claude made which are finished, out of those still part of the work since your latest message ("40% · 2 of 5 tasks done"), with the one it's on shaded and named on the **now** row. Tasks finished before your latest message drop out, and a helper's tasks fill its own bar. Otherwise the window shows what's known: how many steps it has taken and for how long. A shell command shows as Claude's own one-line description of it. Every window keeps the same rows, and long lines are cut with "…".

**Compaction.** When the conversation is compacted to free up room, the Claude shows "Compacting memory", the header says "🗜 compacting", and the log says how many messages went in and came out.

**Tests.** When a Claude runs a test command (cargo test, npm test, jest, vitest, pytest, go test and the like):

- the running line under the toolbar says what the run is for (Claude's own description of the command, or the runner and its targets, like "Rust tests (cargo): chunk") and how long it's been going. A loop that keeps checking a test log reads as "watching <file>". Other long commands show there too, in plain words.
- the Claude's window shows the run with its timer
- on the tree map, a bubbling flask appears beside the terminal

The pass and fail counts land in its window, the log and a pop-up.

**Problems.** When a build or test fails, each file it names turns red in its folder card with a count of its errors, and a Problems list shows `file:line` and the message. Click an error to open the file at that line. A clean build or test run clears the list. It understands rustc and cargo panics, tsc, C#/MSBuild, gcc/clang, Go, Python tracebacks, pytest, and jest/vitest stack frames.

**Stuck warning.** A Claude gets a red "Stuck?" bubble, a warning in its window and a pop-up when:

- it runs the same command three times and it fails each time
- its last five tool calls all fail
- it edits the same file eight times in five minutes

The warning clears once it gets past the problem. It may just need a hint from you.

**Spending.** The spend row shows each Claude's share as a bar. Type a dollar amount into **budget $** to get a pop-up as the session passes 50%, 80% and 100% of it. The header shows how much has been spent against the budget, and the budget is remembered between sessions.

**Replay.** Press **⏪ replay** to step back through the session, one tool call at a time. You can play, pause, step, jump to either end, or go back to live.

**Task summary.** When a task ends, a green card sums it up: time taken, files changed with lines added and removed, tests run and the last result, which Claudes and how many Codex runs were involved, and the cost. **Copy as Markdown** puts it on your clipboard, ready for a PR description.

**Opening files.** Click a card's folder name (marked ↗) to open that folder in your file manager, and any file chip to open the file. Pictures, video, audio, documents, archives, fonts and 3D files open in your system's app for that type (Photos for a .png on Windows, Preview on a Mac). Code and text open in the editor you pick. Programs, and scripts when no editor is picked, are shown selected in their folder rather than run. **📁 folder** opens the project folder. **▸ files** lists every file touched this session with lines added and removed, and every file there, in the Problems list and in the Codex windows is a button too. A file edited this session opens as a diff against your last commit. Pick where code opens (VS Code, Cursor, or your system's default app) from the **code in** picker.

**The log.** Everything in time order, one line per action or thought, colour-coded by who did it.

**Codex.** With the `codex-bridge` mod installed, a running Codex gets its own desk, window and log lines. On the tree map it gets its own tree (Codex, its threads, and the files each thread read or edited), with a teal robot on the file it's on.

**The intro.** When the mod starts and when you open `/crew`, a six-second intro plays: the title rises a letter at a time, and four little Claudes drop onto it and hop across the letters before the pane takes over. **skip ▸** jumps past it, **don't show again** turns it off, and **⏻ intro** in the header plays it again (and turns it back on).

## Controls

- `⏻ intro` plays the start-up intro again.
- `▶ demo` runs three pretend Claudes over a pretend project for half a minute. It includes a failing test, a pretend Codex run and a summary card at the end.
- `Search files...` keeps only the matching files.
- `⏪ replay` steps back through the session.
- `▸ files N` lists every file touched this session.
- `⊞ tree map` / `▤ desks` switches between the two views. On the tree map, `◀ ▲ ▼ ▶` moves it and `− / +` and `⤢ fit` zoom.
- `code in` picks where code and text files open. Other files always open in their own app.
- `budget $` sets the spending budget.

## How it works

The mod hooks Claude Code's events:

- **every tool call:** which file, which tool, and for edits the lines added and removed. Shell output is read for test results and error locations.
- **every reply:** summarised into "thoughts".
- **every helper spawn**
- **every turn's start and end:** goal, status, tokens

When a code file is first opened, the mod reads that file's imports to build the tree map (JS/TS, Python, Rust including `use crate::…`, C/C++, CSS). The desks and cards are plain text and buttons, and the tree map is an SVG that only redraws when something on it changes.

A warning also pops up when two Claudes edit the same file within a minute of each other.

---

Part of [claude-crew-mods](https://github.com/D3K1D/claude-crew-mods) by [D3K1D](https://github.com/D3K1D), made with Claude in Claude Code. MIT licensed.
