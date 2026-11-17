# VHS tape for docs/assets/cli-ci.gif and docs/assets/cli-ci.mp4.
# Rendered by scripts/demos/record-terminal.mjs, which replaces the {{...}} values.

Output "{{OUTPUT_GIF}}"
Output "{{OUTPUT_MP4}}"
Require {{SHELL}}
Set Shell {{SHELL}}
Set Width 1400
Set Height 820
Set FontSize 20
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

Type "ocpptools validate heartbeat-response.json --version 2.0.1"
Sleep 300ms
Enter
Wait+Screen /unchecked-result/
Wait+Line /^>\s*$/
Sleep 2s

Type "ocpptools validate heartbeat-response.json --version 2.0.1 --action Heartbeat"
Sleep 300ms
Enter
Wait+Line /^>\s*$/
Sleep 2s

Type "clear"
Enter
Wait+Line /^>\s*$/

Type "ocpptools validate bad-boot.json --version 2.0.1 --json"
Sleep 300ms
Enter
Wait+Screen /"messageId": "msg-2"/
Wait+Line /^>\s*$/
Sleep 4s
