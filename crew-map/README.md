# Claude Crew (plugin `crew-map`)

A live view of what Claude and its helper Claudes are doing, for when you give Claude Code a task and want to *see* the work instead of scrolling through a transcript.

```
/plugin install crew-map --marketplace D3K1D/claude-crew-mods
```

Open it with `/crew` (it also opens by itself in a wide window). The repository's [README](../README.md) covers other ways to install it and troubleshooting.

## What you see

The pane is four bands, top to bottom. Every Claude always shows: the Claudes band is as tall as its rows. Touched keeps a fixed height, and the viewer takes all the room left, down to the bottom of the pane: a taller pane shows more of the log.

**The header.** Counts by state, in their colours: **⏸ 1 needs you** (amber), **● 4 working** (green), **◌ 1 waiting**, **✓ 1 done**. At the right, what the whole chat has cost, as Claude Code's own `/cost` totals it, and **of $10** when you set a budget (the cost turns amber at 80% of it and red past it).

**The Claudes.** One row per Claude, readable at a glance by anyone. Its first line: a little Claude, its name, and what it is doing in plain words ("Writing code · fixture.js", "Running tests · Rust tests (cargo): chunk · 42s", "Reading online", "Using Blender", "Thinking · 12s", "Waiting · for Scout, Atlas"), with how long it has been at it. Its second line: how far along, a dot per step and "Step 2 of 3 · Wire the fixture agent" (or "4 actions so far"), and its model (Opus 5.5, Sonnet 5.5…). Colour means its state only: green working, grey waiting or idle, amber when it needs you, dim once done. A helper sits indented under the Claude that started it, a helper's helper further in, and a Codex run under whoever ran it. One that needs you is pinned on top, in amber, with its whole request ("Allow running …? Answer in the chat."). A finished helper is one dim line for a moment. A Claude that looks stuck says why on its second line, in amber (the same command failing three times, five failed calls in a row, or eight edits to one file in five minutes).

**Nested chats.** In the desktop app, a chat Claude started from this one (its own session, nested under this chat in the sidebar) gets a row too, under this chat, and a chat that one started sits further in. It says Working or Idle and when it was last active, with its branch and folder; Details shows who started it and where it works. The pane reads them from the app's own session list every 15 seconds, and only where that read needs nobody's approval; it is not one of Claude's actions in the log.

When nobody is working, the last task's card takes the room the helpers used: how long it took, what changed, the tests, the cost and who worked on it, with **Copy as Markdown** for a PR description. Before any work, it says what will show there, with a pretend session to try.

**Touched.** One line per folder the work touched (the three worked in most lately), its files as buttons: lines added in green and removed, a red **✕2** when a build or test named errors in it, and a dot in a Claude's colour on the file it is editing now. **+N more** opens the Files tab, **Open folder** the project folder.

**The viewer.** One box with tabs: **Activity**, **Files**, **⌕** (search), **⚙** (settings), and a Claude's own tab when you press **Details** on its row. **▲ older** and **▼ newer** scroll whichever tab is shown, and **⤓ latest** goes back to the newest.

- **Activity** is the log: every action, thought and message in time order, with who did it and how long each action took (340ms, 2.4s, 1m12s; one still running counts up with ●). Your messages show as **You**, and a message another Claude session sent shows its sender and words. A line cut short has a **›**: click it to read it whole (a thought opens to everything Claude said), **▾** folds it again. While you're scrolled back or have a line open, the log holds still as new lines come in.
- **Details** for a Claude: its model, who it helps, its time; its cost and tokens; how full its context is (red with "compacts soon" from 85%, and how often it was compacted); everything it was asked; its steps (✓ done, ▸ on it, ○ to come); and its own lines from the log. **Hide** beside its row, or **✕** on its tab, closes it.
- **Files** lists every file touched, under its folder, with lines added and removed, or "read", and who touched it. Files outside the project can be hidden.
- **Search** finds files and log lines as you type.
- **Settings**: the theme (◐ auto, ☀ light, ☾ dark), a budget (with a heads-up at 50%, 80% and 100%), where files open, files outside the project shown or hidden, the intro on or off (and play it now), and a pretend session to try the pane.

**Opening files.** Click any file to open it. Pictures, video, audio, documents, archives, fonts and 3D files open in your system's app for that type (Photos for a .png on Windows, Preview on a Mac). Code and text open in the editor you pick in Settings (VS Code, Cursor, or your system's default app). A file edited this session opens as a diff against your last commit, and a file with errors opens at its first one. Programs, and scripts when no editor is picked, are shown selected in their folder rather than run.

**Tests.** A Claude running a test command (cargo test, npm test, jest, vitest, pytest, go test and the like) says "Running tests" with what the run is for and how long it has gone. The pass and fail counts land in the log and a pop-up.

**Codex.** With the `codex-bridge` mod installed, a running Codex gets its own row, its Details and its lines in the log.

**The intro.** When the mod starts and when you open `/crew`, a six-second intro plays: the title rises a letter at a time and four little Claudes hop across it. **skip ▸** jumps past it, **don't show again** turns it off, and Settings plays it again or turns it back on.

**Light and dark.** The pane follows the app's theme, and Settings can pick light or dark when it guesses wrong. The choice is kept for new sessions, and Codex Bridge's pane follows it.

**In a terminal.** The same bands as text: each row's words, Touched's files and the tabs as buttons.

## How it works

The mod hooks Claude Code's events:

- **every tool call:** which file, which tool, and for edits the lines added and removed. Shell output is read for test results and error locations.
- **every reply:** summarised into "thoughts".
- **every helper spawn**
- **every turn's start and end:** goal, status, tokens

What is only read (the header, each Claude's row, the last task's card) is drawn as a picture laid out to the pixel, so nothing is clipped. Everything you press (Details, files, tabs, scrolling, the log's lines, settings) is a real button beside or under the pictures, never over them.

A warning also pops up when two Claudes edit the same file within a minute of each other.

---

Part of [claude-crew-mods](https://github.com/D3K1D/claude-crew-mods) by [D3K1D](https://github.com/D3K1D), made with Claude in Claude Code. MIT licensed.
