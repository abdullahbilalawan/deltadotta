Output "/tmp/deltadotta-provider-segment.mp4"

Require node

Set Shell "zsh"
Set FontSize 20
Set FontFamily "Menlo"
Set Width 1920
Set Height 1080
Set LineHeight 1.22
Set Padding 38
Set Margin 32
Set MarginFill "#20251f"
Set BorderRadius 18
Set WindowBar "Colorful"
Set WindowBarSize 46
Set Theme "iTerm2 Dark Background"
Set Framerate 30
Set TypingSpeed 32ms

Hide
Type "cd /tmp/Aster-Ridge-Demo"
Enter
Type "export PATH=/tmp/deltadotta-demo-runtime/bin:$PATH"
Enter
Type "cp /tmp/Aster-Ridge-Reviewed.json .deltadotta/onboarding/review/organization.review.json"
Enter
Type "clear"
Enter
Show

Type "deltadotta refine --package .deltadotta/onboarding"
Enter
Sleep 4300ms

Hide
Type "clear"
Enter
Show

Type "deltadotta validate --package .deltadotta/onboarding"
Enter
Sleep 3600ms

Hide
Type "clear"
Enter
Show

Type "deltadotta install --provider claude --package .deltadotta/onboarding --no-open"
Enter
Sleep 7600ms
