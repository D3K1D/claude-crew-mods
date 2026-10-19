# Codex Bridge (plugin `codex-bridge`)

Gives Claude Code a `codex` tool, so Claude can hand work to OpenAI Codex the way it hands work to its own helper agents. Codex runs through the Codex CLI signed in to your ChatGPT/Codex subscription. There's no API key, and runs count against that subscription rather than Claude's.

```
/plugin install codex-bridge --marketplace D3K1D/claude-crew-mods
```

You also need the Codex CLI: the [Codex desktop app](https://openai.com/codex) includes it, or install it with `npm i -g @openai/codex` and run `codex login`. Open the pane with `/codex`. The repository's [README](../README.md) covers other ways to install it and troubleshooting.

## How to use it

Ask in plain words: "have Codex review the renderer", "ask Codex for a second opinion on this design", "give Codex a thread called chunk-loader and make chunk loading async while you work on the renderer". Claude writes Codex a self-contained brief (Codex can't see your chat), picks a model and effort, and reads the result back: Codex's answer, the files it changed with lines added and removed, the commands it ran, and how to continue.

**Models and effort.** The tool lists the models your account offers, with a rough guide:

- the fast model at low effort, for lookups and mechanical edits
- the workhorse at medium or high, for ordinary coding
- the frontier model at high or above, for hard design work or a critical review

Leave them unset and your Codex defaults apply.

**Read-only vs write.** Read-only (the default) lets Codex read files and run read-only commands. Write lets it edit inside the project folder only, and the result reminds Claude to review the diff.

**Memory.** Each project gets a `.codex-bridge/` folder, kept out of git through `.git/info/exclude`:

- `NOTES.md`: lasting project knowledge that Codex keeps up to date and reads at the start of every run.
- `threads/<name>.md`: a log per workstream, with each task, who asked, the result and the files.
- `threads.json`: which Codex conversation each named thread continues.

Give a workstream a `thread` name and every call with that name continues the same Codex conversation. If an old conversation can't be resumed, a fresh one starts with the notes and log as context.

## Threads

The pane's **Threads** section lists each project's threads, newest first, with how many runs each has had, when it was last used, its model and its last task. Each thread has these buttons:

- **open log**: opens the thread's log in your editor.
- **rename**: type a new name. The log file moves with it.
- **fresh start**: the next run starts a new Codex conversation, keeping the log and notes.
- **archive** / **restore**: hides the thread until it's used again. **show archived** lists hidden threads.
- **delete**: needs a second press. It removes the thread and its log; the project's `NOTES.md` stays.

Claude can manage threads too: the tool has `threads`, `rename_thread`, `reset_thread` and `archive_thread` actions.

## Usage

The top of the pane shows your Codex plan and each of its limits (the 5-hour window and the weekly one) as a bar, with how much is used and when it resets. The bar is green under 70%, yellow under 90%, and red above that. The numbers come from the session logs Codex writes after each run (under `~/.codex/sessions`), so they're as fresh as your last Codex run; **↻ refresh** reads them again. Every result Claude gets ends with the same numbers, and the tool's `usage` action asks for them directly, so Claude can pick a cheaper model or effort when you're close to a limit.

## The pane

Each run gets a card showing its thread, model and effort, mode, who asked, elapsed time, what Codex is doing right now, its commands (✓/✗), the files it changed, and a **stop** button while it runs. Finished runs show a summary and whether Codex updated its notes. Each changed file is a button that opens it in your editor as a diff against your last commit. The editor is the one picked in the crew map, or VS Code if that mod isn't installed.

With the `crew-map` mod installed, a running Codex also gets its own desk and window in the crew pane, and its own tree on the optional tree map.

## Limits

- On Windows, write mode doesn't work in folders under `AppData`, including a chat's own scratch folder. The tool says so and asks for a normal project folder.
- Stop takes effect at Codex's next event, so a long-running command finishes first.
- Outside a git repository, files Codex changes through shell commands can't be listed.
- The usage bars show what Codex last wrote down, not live numbers.

## Where it looks for Codex

- **Windows:** the newest CLI inside the Codex desktop app (`%LOCALAPPDATA%\OpenAI\Codex\bin\…`), then `where codex` (npm's `codex.cmd` works too).
- **macOS:** `Codex.app`, Homebrew, `/usr/local/bin`, `~/.local/bin`, then your login shell's PATH.
- **Linux:** `/usr/local/bin`, `~/.local/bin`, `~/.npm-global/bin`, `~/.bun/bin`, then your login shell's PATH.

Codex's home is `CODEX_HOME` if set, otherwise `~/.codex`.
