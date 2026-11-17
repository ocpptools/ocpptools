# VHS tape for docs/assets/testing-vitest.gif and docs/assets/testing-vitest.mp4.
# Rendered by scripts/demos/record-terminal.mjs, which replaces the {{...}} values.

Output "{{OUTPUT_GIF}}"
Output "{{OUTPUT_MP4}}"
Require {{SHELL}}
Set Shell {{SHELL}}
Set Width 1400
Set Height 460
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

Type "npx vitest run"
Sleep 300ms
Enter
Wait+Screen /Tests\s+2 passed/
Wait+Line /^>\s*$/
Sleep 4s
