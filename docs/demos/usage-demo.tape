Output docs/demos/deltadotta-usage-demo.mp4

Require node

Set Shell "zsh"
Set FontSize 18
Set FontFamily "Menlo"
Set Width 1420
Set Height 900
Set LetterSpacing 0
Set LineHeight 1.2
Set Padding 30
Set Margin 28
Set MarginFill "#1f2328"
Set BorderRadius 14
Set WindowBar "Colorful"
Set WindowBarSize 42
Set Theme "iTerm2 Dark Background"
Set Framerate 30
Set TypingSpeed 55ms
Set PlaybackSpeed 1

Hide
Type "export DELTADOTTA_DEMO_ROOT=$PWD"
Enter
Type "rm -rf /tmp/Harbor-Lane-Delivery"
Enter
Type "mkdir -p /tmp/Harbor-Lane-Delivery"
Enter
Type "cp -R docs/demos/usage-demo-workspace/. /tmp/Harbor-Lane-Delivery"
Enter
Type "cd /tmp/Harbor-Lane-Delivery"
Enter
Type "export PATH=/tmp/deltadotta-demo-runtime/bin:$PATH"
Enter
Type "clear"
Enter
Show

Type "deltadotta --name 'Harbor Lane Delivery' --provider chatgpt --no-open"
Enter
Sleep 5000ms

Hide
Type "node $DELTADOTTA_DEMO_ROOT/docs/demos/usage-demo-review.mjs"
Enter
Type "clear"
Enter
Show

Type "deltadotta refine --package .deltadotta/onboarding"
Enter
Sleep 4500ms

Hide
Type "clear"
Enter
Show

Type "deltadotta validate --package .deltadotta/onboarding"
Enter
Sleep 4500ms

Hide
Type "clear"
Enter
Show

Type "deltadotta install --provider chatgpt --package .deltadotta/onboarding --no-open"
Enter
Sleep 7000ms

