Output "/tmp/deltadotta-onboard-segment.mp4"

Require node

Set Shell "zsh"
Set FontSize 22
Set FontFamily "Menlo"
Set Width 1920
Set Height 1080
Set LineHeight 1.25
Set Padding 40
Set Margin 32
Set MarginFill "#20251f"
Set BorderRadius 18
Set WindowBar "Colorful"
Set WindowBarSize 46
Set Theme "iTerm2 Dark Background"
Set Framerate 30
Set TypingSpeed 34ms

Hide
Type "cd /tmp/Aster-Ridge-Demo"
Enter
Type "export PATH=/tmp/deltadotta-demo-runtime/bin:$PATH"
Enter
Type "clear"
Enter
Show

Type "deltadotta --name 'Aster Ridge Logistics' --provider claude --yes --no-open"
Enter
Sleep 7500ms
