# Instructions for Claude

1. **Before any work, read `PROJECT_STATUS.md`** in this folder. It holds the full context (links, accounts, file map,
   data model, procedures, open items). Do not reconstruct context from old chat history.
2. **After every change, update `PROJECT_STATUS.md`**: add a row to §9 Change log, and adjust §5 Features, §7 Known
   issues and §8 To do as needed. Commit it together with the code change.
3. Standard finish for any change: test locally (`?local=1` on localhost) → commit (end message with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`) → `git push origin main:main` → publish Firestore rule
   changes in the console if `cloud/firestore.rules` changed → rebuild the APK and replace
   `C:\Users\fahad\OneDrive\Desktop\Virtual-Therapy.apk` → send it to the user.
4. Every new patient-facing string needs an Urdu entry in `js/okc/lang-ur.js`.
5. Never type the user's passwords; never delete live study data without explicit confirmation.
