# Virtual Therapy — Android app

One app for both roles. It hosts the web code in the repo root in a WebView (`WebViewAssetLoader`, so pages load
from the APK over a secure `https://appassets.androidplatform.net` origin). There is **no copy of the web code** here:
Gradle copies `therapy.html`, `participant.html`, `researcher.html`, `okc.html`, `css/` and `js/` into the app at build
time, so the website and the app are always the same.

## Flow
1. **therapy.html** — "Who is using the app?" → **Patient** or **Researcher** (remembered; "Change role" switches).
2. **Patient** → Study ID + access code → consent (once) → **only the games the researcher assigned** → every finished
   game is saved as a session record (game, reps, quality, knee angles, pain before/after).
3. **Researcher** → (cloud mode: email + password) → dashboard: register patients and tick their games, record
   assessments (WOMAC, TUG, BBS, VAS, ROM), follow each patient's **Game progress**, export CSV.

## Open in Android Studio
`File → Open →` this `android/` folder, let Gradle sync, then Run.

## Build from a terminal
```
cd android
set JAVA_HOME=C:\Users\fahad\AppData\Local\Programs\JDK21\jdk-21.0.13+9
gradlew assembleDebug            → app/build/outputs/apk/debug/app-debug.apk
```
(Gradle 8.14 needs JDK 17–24; Android Studio's bundled JDK 25 is too new for the command line.)

## Native layer (`app/src/main/java/pk/movelab/kneequest/`)
* `MainActivity` — WebView host; grants the **camera** only to its own pages (video only); keeps the screen on; Back goes back in page history.
* `AndroidBridge` — `window.AndroidBridge` (contract in `js/okc/sync.js`): `getContext()`, `saveSession(json)` (safety copy in SQLite via `LocalDb`),
  `setLang()`, `saveFile()` / `shareText()` (CSV export and access-code sharing through the Android share sheet).
* Debug builds: `adb shell am start -n pk.movelab.virtualtherapy/pk.movelab.kneequest.MainActivity --es page "therapy.html?choose=1"` opens a page directly; `chrome://inspect` can inspect the WebView.

## Remote tracking needs the cloud
Until `js/study/cloud-config.js` holds a Firebase config (see `cloud/SETUP.md`) the app runs in **local mode**: data stays on
that one phone, so a patient's games only show on a researcher screen on the *same* phone. With the config pasted and the app
rebuilt, patients and researchers on different phones share one online database.

## Notes
* The games load the MediaPipe pose model from the internet when a game starts; sessions recorded offline sync later.
* A release build for wider distribution needs a signing key; debug APKs are fine for sideloading to test phones.
