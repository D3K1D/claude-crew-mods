# Releasing

The same steps for every release of either mod.

1. **Bump the version** in all three places (the release test fails if they disagree):
   - `<mod>/.claude-plugin/plugin.json`
   - the mod's entry in `.claude-plugin/marketplace.json`
   - `VERSION` in the code: `crew-map/hooks/track.ts`, `codex-bridge/hooks/register.tsx`
2. **Write the changelog.** Add a section at the top of `CHANGELOG.md`, `## Claude Crew <version> (<date>)`, a few lines in words a user would use.
3. **Test from a clean clone**, as CI does:
   ```bash
   git clone . /tmp/crew-release && cd /tmp/crew-release
   npm ci
   npm test
   ```
   Every check must pass. The engine tests run when Claude Code is installed (set `CLAUDE_EXE` to pick one).
4. **Validate:** `claude plugin validate .`, `claude plugin validate crew-map` and `claude plugin validate codex-bridge` must pass. The TypeScript warnings they list must not grow; crew-map has 130 today and codex-bridge 163, all older than 1.9.0.
5. **Try it in the app.** Install the mod locally (`sh scripts/install.sh crew-map`, or copy the folder to `~/.claude/mods/crew-map`), start a new chat, type `/crew`, and look at both themes.
6. **Commit, tag and push:** `git tag v<version>`, `git push`, `git push --tags`.
7. **Publish the release** on GitHub from the tag (`gh release create v<version> --notes-from-tag`, or paste the changelog section). Users update with `claude plugin marketplace update crew-mods`, then `claude plugin update crew-map`.
