# VHS tape for docs/assets/cli-demo.gif and docs/assets/cli-demo.mp4.
# Rendered by scripts/demos/record-terminal.mjs, which replaces the {{...}} values.
# The synthetic CSMS must be listening on 127.0.0.1:9000.

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

Type "ocpptools validate boot.json --version 2.0.1"
Sleep 300ms
Enter
Wait+Screen /Valid: boot\.json/
Sleep 1.2s

Type "ocpptools validate bad-boot.json --version 2.0.1"
Sleep 300ms
Enter
Wait+Screen /is required/
Sleep 2s

Type "ocpptools simulate --config charge-point.json --scenario run.json"
Sleep 300ms
Enter
Wait+Screen /\[4\] stop ok/
Sleep 3s
