# VHS tape for docs/assets/simulator-code.gif and docs/assets/simulator-code.mp4.
# Rendered by scripts/demos/record-terminal.mjs, which replaces the {{...}} values.
# The synthetic CSMS must be listening on 127.0.0.1:9000.

Output "{{OUTPUT_GIF}}"
Output "{{OUTPUT_MP4}}"
Require {{SHELL}}
Set Shell {{SHELL}}
Set Width 1400
Set Height 560
Set FontSize 22
Set FontFamily "{{FONT}}"
Set Padding 30
Set TypingSpeed 35ms
Set CursorBlink false
Set WaitTimeout 60s

Env NO_COLOR "1"

Hide
Type `{{SETUP}}`
Enter
Wait+Line /^>\s*$/
Show

Type "node station.mjs"
Sleep 300ms
Enter
Wait+Screen /scenario\s+completed/
Wait+Line /^>\s*$/
# VHS captures fewer frames than its frame rate while Node starts, which
# shortens the video, so the final pause is longer than in the other tapes.
Sleep 7s
