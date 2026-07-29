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
Set TypingSpeed 70ms
Set PlaybackSpeed 1

Hide
Type "rm -rf /tmp/Flameco"
Enter
Type "mkdir -p /tmp/Flameco/docs /tmp/Flameco/database"
Enter
Type "printf '# Flameco operations handbook\n\nFlameco maintains commercial fire systems for regional facilities.\n\n- Operations Lead owns daily service delivery.\n- Safety Lead may stop unsafe field work.\n- Customer Success receives completed-service handoffs.\n- General Manager receives unresolved safety escalations.\n' > /tmp/Flameco/docs/OPERATIONS.md"
Enter
Type "printf 'title,department,reports_to,purpose,authority\nGeneral Manager,Leadership,,Set company direction,Approve operating policy\nOperations Lead,Operations,General Manager,Coordinate daily service delivery,Assign field work\nSafety Lead,Safety,General Manager,Protect field teams,Stop unsafe work\n' > /tmp/Flameco/docs/roles.csv"
Enter
Type "printf 'CREATE TABLE service_jobs (id text, customer_id text, assigned_role text, status text);' > /tmp/Flameco/database/schema.sql"
Enter
Type "cd /tmp/Flameco"
Enter
Type "export PATH=/tmp/deltadotta-demo-runtime/bin:$PATH"
Enter
Type "clear"
Enter
Show

Type "find . -maxdepth 2 -type f | sort"
Enter
Sleep 1800ms
Type "deltadotta --no-open"
Enter
Sleep 5500ms
Type "find .deltadotta/onboarding/providers/chatgpt -maxdepth 1 -type f -print | sort"
Enter
Sleep 3500ms
