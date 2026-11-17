# Claude Crew (plugin `crew-map`)

A live view of what Claude and its helper Claudes are doing, for when you give Claude Code a task and want to *see* the work instead of scrolling through a transcript.

```
/plugin install crew-map --marketplace D3K1D/claude-crew-mods
```

Each chat gets its own Claude Crew website, run by the mod on your computer (only your computer can open it). It starts on the chat's first `/crew` (a chat that never opens it runs no website), and comes back by itself when Claude reopens a chat that had one. Type `/crew` and Claude opens it in the browser pane beside the chat (if it doesn't, click the address `/crew` shows). The mod's own pane no longer opens by itself; opened, it shows the website's address and a one-line status on the desktop, and the whole view as text in a terminal. If the website can't start (it needs Node), the pane opens by itself and shows the whole view as text instead. The repository's [README](../README.md) covers other ways to install it and troubleshooting.

**The website.** The same view as the pane, drawn as a web page: real buttons in Claude Crew's own colours, hover, and a **drag line** between the Claudes and the log (drag it up for more log, down for more Claudes; double-click to reset). The log goes back to the start of the chat: **Load 200 older** at its top loads the lines before, from the journal on disk (the page keeps up to 5,000 lines). Only what changed is drawn again, and the timers count on the page, so a selection, a hover or a press is never lost to a redraw. Every press on the page goes back to the mod and does what the pane's buttons do. The page reaches the mod at `127.0.0.1` with a random token in its address, and refuses requests that name any other host. The website stops when the chat ends, and on its own when Claude is closed (it checks every few seconds that the Claude that started it is still running) or when the mod has not been heard from for a minute. When you reopen Claude and go back to the chat, its website comes back at the same address (it asks the old one, if it is still winding down, to hand it over; only if something else holds the port does it move), so the browser pane picks it up again; a page that was left open reloads itself.

**Saving the log.** The log keeps every line of the chat (on disk, in `~/.claude/crew-map/journals/<chat>/`, in files of 250 lines so only the newest is rewritten as it grows; a restart of Claude loses nothing). Journals and the small per-chat files beside them go once nothing has written them for 30 days, and past the newest 300 journals (checked once a day, with Node). Saving again updates the summary with what is new since the last one, so a save with nothing new asks no model. Its buttons on the Activity tab copy it as Markdown, download it as a `.md` file, or **save** it into the project: `.claude/crew-logs/<date>-<what you asked>-<chat>.md`, with a summary beside it (`.summary.md`) written by a cheaper model (Haiku): the goal, what was done, how and why, problems and fixes, and what is left open. Saving is on the button only, unless Settings → Save log is set to "after each task". New chats in a project with saved summaries get one line telling Claude where they are, so it reads them when it needs to know what was done before and why.

**MCP tools** (connectors and apps, such as GitHub or the Claude app itself) show in the log with their own plug icon; the browser and computer use keep theirs.

**The cost** in the header is the chat's cost as Claude Code reports it (`/cost`): every model call in the chat, helpers included, at API list prices. On a Pro or Max plan you are not charged this; it is what the same work would cost on the API.

## What you see

The pane is four bands, top to bottom. Every Claude always shows: the Claudes band is as tall as its rows. Touched keeps a fixed height, and the viewer takes all the room left, down to the bottom of the pane: a taller pane shows more of the log.

**The header.** Counts by state, in their colours: **⏸ 1 needs you** (amber), **● 4 working** (green), **◌ 1 waiting**, **✓ 1 done**. At the right, what the whole chat has cost, as Claude Code's own `/cost` totals it, and **of $10** when you set a budget (the cost turns amber at 80% of it and red past it).

**The Claudes.** One row per Claude, readable at a glance by anyone. Its first line: a dot in its colour, its name, and what it is doing in plain words ("Writing code · fixture.js", "Running tests · Rust tests (cargo): chunk · 42s", "Reading online", "Using Blender", "Thinking · 12s", "Waiting · for Scout, Atlas"), with how long it has been at it. Its second line: how far along, a dot per step and "Step 2 of 3 · Wire the fixture agent" (or "4 actions so far"), and its model (Opus 5.5, Sonnet 5.5…). Colour means its state only: green working, grey waiting or idle, amber when it needs you, dim once done. A helper sits indented under the Claude that started it, a helper's helper further in, and a Codex run under whoever ran it. One that needs you is pinned on top, in amber, with its whole request ("Allow running …? Answer in the chat."). A finished helper is one dim line for a moment. A Claude that looks stuck says why on its second line, in amber (the same command failing three times, five failed calls in a row, or eight edits to one file in five minutes).

**Nested chats.** In the desktop app, a chat Claude started from this one (its own session, nested under this chat in the sidebar) gets a row too, under this chat, and a chat that one started sits further in. It says Working or Idle and when it was last active, with its branch and folder; Details shows who started it and where it works. The pane reads them from the app's own session list every 15 seconds, and only where that read needs nobody's approval; it is not one of Claude's actions in the log. Where it would need one (auto mode, for instance), the rows are as new as Claude's own last look at the chats (listing them, reading one, messaging one, starting one): their state is dim and they say **as of 13:09** (in a terminal, "Working (as of 13:09)"), until a read works again; the header counts only what is known live. A nested chat's card shows its own steps (pips and "Step 2 of 4 · …") and its lines join this chat's log: a bubble in the chat's colour, its short name, and a helper there named first ("Quill · Edited docs/build.mjs"); the website's Who list can show one chat. Each chat's Claude Crew writes a small file about itself (`~/.claude/crew-map/chats/<its app id>.json`: its log's name and its steps) beside its log; the chat above it reads both every few seconds, only when they changed, so a nested chat's lines show within about 5 seconds, whatever the Save log setting.

**Steps.** A Claude's steps come from its task list: TodoWrite, the task tools, or the desktop app's own task list (`update_plan`).

When nobody is working, the last task's card takes the room the helpers used: how long it took, what changed, the tests, the cost and who worked on it, with **Copy as Markdown** for a PR description. Before any work, it says what will show there, with a pretend session to try.

**Touched.** One line per folder the work touched (the three worked in most lately), its files as buttons: lines added in green and removed, a red **✕2** when a build or test named errors in it, and a dot in a Claude's colour on the file it is editing now. **+N more** opens the Files tab, **Open folder** the project folder.

**The viewer.** One box with tabs: **Activity**, **Files**, **⌕** (search), **⚙** (settings), and a Claude's own tab when you press **Details** on its row. **▲ older** and **▼ newer** scroll whichever tab is shown, and **⤓ latest** goes back to the newest.

- **Activity** is the log: every action, thought and message in time order, with who did it and how long each action took (340ms, 2.4s, 1m12s; one still running counts up with ●). Your messages show as **You**, and a message another Claude session sent shows its sender and words. A line cut short has a **›**: click it to read it whole, **▾** folds it again. A thought opens to everything Claude said; an action opens to what came of it: an edit to the lines it took out (-) and put in (+), a command to its exit and last 15 lines of output, a failed call to its error. A failed action's icon is red. On the website, the row under the tabs filters the log (one Claude, or only edits, commands or failures, or no thoughts; kept until you clear it) and counts its lines, beside Copy, Download and Save; the top of the log has **Load 200 older**, for the lines saved on disk before the oldest one shown. While you're scrolled back or have a line open, the log holds still as new lines come in.
- **Details** for a Claude: its model, who it helps, its time; its cost and tokens; how full its context is (red with "compacts soon" from 85%, and how often it was compacted); everything it was asked; its steps (✓ done, ▸ on it, ○ to come); and its own lines from the log. **Hide** beside its row, or **✕** on its tab, closes it.
- **Files** lists every file touched, under its folder, with lines added and removed, or "read", and who touched it. Files outside the project can be hidden.
- **Search** finds files and log lines as you type.
- **Settings**: the theme (◐ auto, ☀ light, ☾ dark), a budget (with a heads-up at 50%, 80% and 100%), where files open, files outside the project shown or hidden, and a pretend session to try the pane.

**Opening files.** Click any file to open it. Pictures, video, audio, documents, archives, fonts and 3D files open in your system's app for that type (Photos for a .png on Windows, Preview on a Mac). Code and text open in the editor you pick in Settings (VS Code, Cursor, or your system's default app). A file edited this session opens as a diff against your last commit, and a file with errors opens at its first one. Programs, and scripts when no editor is picked, are shown selected in their folder rather than run.

**Tests.** A Claude running a test command (cargo test, npm test, jest, vitest, pytest, go test and the like) says "Running tests" with what the run is for and how long it has gone. The pass and fail counts land in the log and a pop-up.

**Codex.** With the `codex-bridge` mod installed, a running Codex gets its own row, its Details and its lines in the log.

**Light and dark.** The pane follows the app's theme, and Settings can pick light or dark when it guesses wrong. The choice is kept for new sessions, and Codex Bridge's pane follows it.

**As text** (a terminal, or the desktop when the website can't start): the same bands, each row's words, Touched's files and the tabs as buttons.

## How it works

The mod hooks Claude Code's events:

- **every tool call:** which file, which tool, and for edits the lines added and removed. Shell output is read for test results and error locations.
- **every reply:** summarised into "thoughts".
- **every helper spawn**
- **every turn's start and end:** goal, status, tokens

The mod works out the view once and hands it to the website as data (the page draws it) or draws it as text in the pane. Everything you press is a button that goes back to the mod.

A warning also pops up when two Claudes edit the same file within a minute of each other.

---

Part of [claude-crew-mods](https://github.com/D3K1D/claude-crew-mods) by [D3K1D](https://github.com/D3K1D), made with Claude in Claude Code. MIT licensed.
