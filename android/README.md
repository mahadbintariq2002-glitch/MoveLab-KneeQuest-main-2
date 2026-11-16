# MoveLab Android apps

Two apps built from one Android Studio project. Both host the web code in the repo root in a WebView
(`WebViewAssetLoader`, so pages load from the APK over a secure `https://appassets.androidplatform.net` origin).
There is **no copy of the web code** here: Gradle copies `okc.html`, `participant.html`, `researcher.html`,
`css/` and `js/` into the app at build time, so a change to the web app reaches both Android apps on the next build.

| Flavor | App name | Opens | For |
|---|---|---|---|
| `patient` | MoveLab Rehab | `participant.html` → consent → the 7 games | study participants (Urdu / English, camera) |
| `researcher` | MoveLab Researcher | `researcher.html` | the dashboard (register participants, assessments, progress, CSV export) |

## Open in Android Studio
`File → Open →` this `android/` folder. Let Gradle sync, pick the build variant (`patientDebug` or `researcherDebug`) and Run.

## Build from a terminal
```
cd android
gradlew assembleDebug            # both apps  → app/build/outputs/apk/<flavor>/debug/
gradlew assemblePatientDebug     # patient only
```

## What the native layer does (`app/src/main/java/pk/movelab/kneequest/`)
* `MainActivity` — WebView host; grants the **camera** (only to its own pages, only video); keeps the screen on in the patient app; Back goes back in the page history.
* `AndroidBridge` — the `window.AndroidBridge` object the web code looks for (contract in `js/okc/sync.js`):
  `getContext()`, `saveSession(json)` (safety copy in SQLite via `LocalDb`), `setLang()`, `saveFile()` / `shareText()` (CSV export and access-code sharing through the Android share sheet).
* Debug builds only: `adb shell am start -n pk.movelab.kneequest.patient/pk.movelab.kneequest.MainActivity --es page "okc.html?pid=P001&lang=ur"` opens a page directly, Chrome `chrome://inspect` can inspect the WebView, and the games' mouse "preview" button stays available.

## Data
Until a Firebase project is configured (`js/study/cloud-config.js`, see `cloud/SETUP.md`) the apps run in **local mode**: data stays on that one phone,
so the patient app and researcher app cannot see each other. Paste the Firebase web config, rebuild, and both apps talk to the same cloud project — that is what makes remote progress tracking work.

## Before giving the patient app to participants
* The games load the MediaPipe pose library and model from the internet (`js/okc/pose.js`) — the phone needs a connection when a game starts. Bundling them for fully offline use is a possible next step.
* A release build needs a signing key (`gradlew assembleRelease` after adding a keystore); debug APKs are fine for sideloading to a few phones.
