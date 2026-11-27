# Changelog

Newest first. Claude Crew is the `crew-map` plugin and Codex Bridge is the `codex-bridge` plugin.

## Claude Crew 1.9.0 · Codex Bridge 1.2.5 (2026-11-27)

- A cleanup release; nothing you see changes. The code the old picture pane left behind is gone: the map, its layout and import scanning, the replay, and a hook that ran on every tool call. That's about 900 lines, and Claude Crew no longer reads every code file Claude opens.
- The hooks module is split into files by job: the record (`track.ts`), the view (`model.ts`), the website and journal (`web.ts`), the pretend session (`demo.ts`), and the hooks with the text pane (`register.tsx`).
- Background work that fails is noted once and never left unhandled. A press that fails no longer stops the website.
- The website's server checks its token and key in constant time.
- Shorter READMEs, with one install command: `claude plugin install crew-map --marketplace D3K1D/claude-crew-mods`.
- Codex Bridge: README and description only.

## Claude Crew 1.8.9 (2026-11-20)

- `/crew-review` starts a nested **Crew Review** chat that summarises recent changes from Claude Crew's logs and git: since the chat began, a span (`2h`, `3d`), a date, or a git ref.
- Each chat records its project, so a review reads only that project's chats.
- **This project**: the other chats in the same repository or folder, under their own heading.

## Claude Crew 1.8.8 (2026-11-18)

- Each Claude keeps its own colour for the whole chat. Its card shows a context bar, and Details lists its helpers, nested chats and steps.
- Waiting on helpers or nested chats has its own colour (indigo). A card waiting after its turn says for how long.
- The app's wrap-up checks off the whole task list.
- Test toasts are a setting, off by default.

## Claude Crew 1.8.0–1.8.7 (2026-11-17)

- Open any action in the log to see what happened: an edit's diff, a command's output and exit, a failed call's error.
- Log filters by Claude, chat and kind, columns you can resize, and the chat's whole history (its newest 5,000 lines) with Load older.
- Nested chats read like helper Claudes: their cards, steps, files and log lines.
- Touched comes back after a restart and shows nested chats' files.
- Lighter on disk, memory and model use, and a safer local server.

## Claude Crew 1.7.0–1.7.8 (2026-11-14 to 2026-11-17)

- Each chat's crew is a website, opened beside the chat with `/crew`. It comes back at the same address after Claude reopens, and stops by itself when the chat ends.
- The desktop pane points at the website, and is a full text view in a terminal or without Node.
- Save the log into the project with a summary by Claude Haiku. MCP tools show in the log, and lines open with a click.

## Claude Crew 1.6.5 (2026-11-13)

- The last version drawn as a pane of pictures.
