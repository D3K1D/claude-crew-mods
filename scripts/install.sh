#!/bin/sh
# Installs Claude Crew (crew-map) and Codex Bridge (codex-bridge) for every Claude Code chat on this
# machine, without the plugin marketplace: copies both mods to ~/.claude/mods and points Claude Code at them.
#
#   sh scripts/install.sh               # both mods
#   sh scripts/install.sh crew-map      # just one
#
# It backs up ~/.claude/settings.json before changing it (it needs node or python3 to edit the JSON),
# and changes nothing if that file is not valid JSON. Run it again to update.
# CLAUDE_DIR=<folder> installs into another Claude config folder.
set -eu

repo=$(cd "$(dirname "$0")/.." && pwd)
claude="${CLAUDE_DIR:-$HOME/.claude}"
target="$claude/mods"
settings="$claude/settings.json"
[ $# -gt 0 ] || set -- crew-map codex-bridge
# Claude Code splits the folder list on the platform's separator: ; on Windows (Git Bash too), : elsewhere.
sep=":"
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) sep=";" ;; esac

for m in "$@"; do
  [ -f "$repo/$m/.claude-plugin/plugin.json" ] || { echo "No mod named '$m' in $repo" >&2; exit 1; }
done

if command -v node >/dev/null 2>&1; then
  tool=node
elif command -v python3 >/dev/null 2>&1; then
  tool=python3
else
  tool=none
fi

# The settings edit: keep everything, add our folders to CLAUDE_CODE_PLUGIN_DIRS, turn mods' hooks on.
# With "check" as the 4th argument it only says whether the file can be read.
edit_js='
const fs = require("fs"); const [file, dirs, sep, mode] = process.argv.slice(1);
let s = {};
if (fs.existsSync(file)) {
  try { s = JSON.parse(fs.readFileSync(file, "utf8")) }
  catch (e) { console.error(file + " is not valid JSON, so nothing was changed: " + e.message); process.exit(2) }
}
if (mode === "check") process.exit(0);
s.env = s.env || {};
const have = (s.env.CLAUDE_CODE_PLUGIN_DIRS || "").split(sep).filter(Boolean);
s.env.CLAUDE_CODE_PLUGIN_DIRS = [...new Set([...have, ...dirs.split(sep)])].join(sep);
s.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = "1";
fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");'
edit_py='
import json, os, sys
f, dirs, sep, mode = sys.argv[1:5]
s = {}
if os.path.exists(f):
    try:
        s = json.load(open(f))
    except Exception as e:
        sys.exit(f + " is not valid JSON, so nothing was changed: " + str(e))
if mode == "check":
    sys.exit(0)
env = s.setdefault("env", {})
have = [d for d in env.get("CLAUDE_CODE_PLUGIN_DIRS", "").split(sep) if d]
env["CLAUDE_CODE_PLUGIN_DIRS"] = sep.join(dict.fromkeys(have + dirs.split(sep)))
env["CLAUDE_CODE_ENABLE_FUNCTION_HOOKS"] = "1"
with open(f, "w") as out:
    json.dump(s, out, indent=2)
    out.write("\n")'
edit() {
  case "$tool" in
    node) node -e "$edit_js" "$settings" "$1" "$sep" "$2" ;;
    python3) python3 -c "$edit_py" "$settings" "$1" "$sep" "$2" ;;
    none) return 0 ;;
  esac
}

# Read the settings first: if they cannot be read, nothing is installed or changed.
edit "" check

mkdir -p "$target"
dirs=""
for m in "$@"; do
  rm -rf "${target:?}/$m"
  cp -R "$repo/$m" "$target/$m"
  where="$target/$m"
  # Git Bash paths (/c/Users/...) mean nothing to Claude Code on Windows: write C:/Users/... instead.
  if [ "$sep" = ";" ] && command -v cygpath >/dev/null 2>&1; then where=$(cygpath -m "$where"); fi
  dirs="${dirs:+$dirs$sep}$where"
  echo "copied $m -> $target/$m"
done

if [ "$tool" = none ]; then
  echo "Neither node nor python3 found: add these to the \"env\" block of $settings yourself:"
  echo "  \"CLAUDE_CODE_PLUGIN_DIRS\": \"$dirs\","
  echo "  \"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS\": \"1\""
  exit 0
fi
[ -f "$settings" ] && cp "$settings" "$settings.bak-$(date +%Y%m%d-%H%M%S)"
edit "$dirs" write
echo "updated $settings (a backup sits next to it)"
echo
echo "Done. Quit Claude Code completely (the desktop app, or every claude terminal), start it again,"
echo "and open a new chat: /crew opens the crew map, /codex the Codex pane."
