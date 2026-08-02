Output docs/demos/deltadotta-human-onboarding.gif
Output docs/demos/deltadotta-human-onboarding.mp4

Require node

Set Shell "zsh"
Set FontSize 20
Set FontFamily "Menlo"
Set Width 1420
Set Height 820
Set LetterSpacing 0
Set LineHeight 1.25
Set Padding 32
Set Margin 28
Set MarginFill "#1f2328"
Set BorderRadius 14
Set WindowBar "Colorful"
Set WindowBarSize 42
Set Theme "iTerm2 Dark Background"
Set Framerate 30
Set TypingSpeed 85ms
Set PlaybackSpeed 1

Hide
Type "rm -rf /tmp/Aster-Ridge-Logistics"
Enter
Type "mkdir -p /tmp/Aster-Ridge-Logistics"
Enter
Type "unzip -q docs/demos/aster-ridge-company.zip -d /tmp/Aster-Ridge-Logistics"
Enter
Type "cd /tmp/Aster-Ridge-Logistics"
Enter
Type "export PATH=/tmp/deltadotta-demo-runtime/bin:$PATH"
Enter
Type "clear"
Enter
Show

Type "deltadotta --no-open"
Enter
Sleep 12000ms
