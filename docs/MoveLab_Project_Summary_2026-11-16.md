# MoveLab / KneeQuest — Work Summary

Camera-based gamified rehabilitation for knee osteoarthritis (KOA grade 2–3). This file records what was built and set up in this chat, how to use it, and what is still open.

*Last updated: 2026-11-16*

---

## 1. Where everything lives

| Item | Location |
|---|---|
| Project folder (local) | `C:\Users\fahad\Downloads\MoveLab-KneeQuest-main\MoveLab-KneeQuest-main` |
| GitHub repo | `mahadbintariq2002-glitch/MoveLab-KneeQuest-main-2` (public) |
| Live web version (GitHub Pages) | https://mahadbintariq2002-glitch.github.io/MoveLab-KneeQuest-main-2/okc.html |
| Android project | `…\MoveLab-KneeQuest-main\android\` |
| Patient APK (debug) | `…\android\app\build\outputs\apk\patient\debug\app-patient-debug.apk` |
| Researcher APK (debug) | `…\android\app\build\outputs\apk\researcher\debug\app-researcher-debug.apk` |
| Android Studio | `C:\Users\fahad\AppData\Local\Programs\Android Studio\android-studio\bin\studio64.exe` (shortcuts on Desktop + Start menu) |
| Android SDK | `C:\Users\fahad\AppData\Local\Android\Sdk` |
| JDK 21 (used for Gradle) | `C:\Users\fahad\AppData\Local\Programs\JDK21\jdk-21.0.13+9` |

Latest pushed commit: `b7e2df9` — "Android Studio project: patient + researcher apps hosting the web app".

---

## 2. The rehab games (web)

Seven open-kinetic-chain / balance exercises, all driven by the phone/laptop camera using MediaPipe Pose:

1. **Quad Press** – isometric quadriceps hold
2. **Lift-Off** – straight-leg raise
3. **Trace the Arc** – knee range-of-motion tracing
4. **Lock the Slot** – terminal knee extension
5. **Tempo Lift** – paced lift with optional ghost guide
6. **Reel It In** – hamstring curl
7. **Steady Scales** – static balance (front-facing, closed chain)

Shared features: calibration (`extRef`) before play, selectable reps / hold time / pace / ghost, shoulder and side-on tracking gates, forgiving slow paces suited to KOA grade 2–3, plain-language feedback. Known honest limits: the camera measures position, not force, and weight distribution can't be verified.

**Caching fix:** GitHub Pages serves files with a 10-minute cache, which made phones show old versions. The service worker now revalidates (`cache: "no-cache"`), cache name `okc-offline-v3`.

---

## 3. The research-study web app

Built for the final-year project's data collection.

**Researcher side** (`researcher.html`, works on phone and laptop)
- Register participants (auto Study ID such as `P001` + access code), demographics: name, age, gender, residence, education, occupation, marital status, duration of pain, KOA grade, CNIC
- Outcome assessments: WOMAC, TUG, Berg Balance Scale, VAS, knee flexion and extension
- Per-participant outcome tables, game progress, adherence ("needs attention"), CSV export, access-code reset
- Demo-data generator (clearly fictional, removable)

**Participant side** (`participant.html`)
- Sign in with Study ID + access code, consent step, then the games
- Urdu and English (RTL layout, Urdu dictionary, speech only if the device has an Urdu voice)
- Pain check (0–10) before and after each session; session records carry the Study ID only — never name or CNIC

**Data layer**
- One store interface with two implementations: `localstore.js` (data stays in the browser — demo/testing) and `cloudstore.js` (Firebase Auth + Firestore — real remote tracking)
- Cloud mode: researchers sign in with email/password; participants use anonymous sign-in plus a link document proving the access code; rules re-check the code on every access, so resetting a code locks out old devices; identities (name/CNIC) are readable by researchers only; sessions are immutable
- Security rules: `cloud/firestore.rules`; setup guide: `cloud/SETUP.md`
- **Status:** `js/study/cloud-config.js` is still `null`, so everything currently runs in local mode (not remote tracking).

**Sync seam** (`js/okc/sync.js`): decides who the participant is, hands each finished session to the store (or an outbox if offline), and defines the `AndroidBridge` contract used by the apps.

---

## 4. Android apps (this session's main work)

### 4.1 Toolchain installed (no admin rights needed)
- Android Studio 2026.2.2.8 (zip install under your user folder)
- Android command-line tools, SDK platform 35, build-tools 35.0.0, platform-tools, emulator
- JDK 21 (Temurin) — needed because Studio's bundled JDK 25 is too new for Gradle 8.14
- Gradle 8.14.3 (wrapper committed to the repo), Android Gradle Plugin 8.13.2
- Emulator system image `x86_64 / Android 35` was still downloading (about 30%) when last checked
- Installer zips were deleted afterwards

### 4.2 Project design
Two apps from one Android Studio project (`android/`), both hosting the existing web code in a WebView, so **web and app stay in sync** — nothing is duplicated.

| Flavor | App name | Package | Opens |
|---|---|---|---|
| `patient` | MoveLab Rehab | `pk.movelab.kneequest.patient` | `participant.html` → consent → games (camera permission) |
| `researcher` | MoveLab Researcher | `pk.movelab.kneequest.researcher` | `researcher.html` |

- `WebViewAssetLoader` serves bundled files from `https://appassets.androidplatform.net/assets/` (a secure origin, so ES modules, camera and Firebase work)
- Gradle tasks `syncWebPatient` / `syncWebResearcher` copy `okc.html`, `participant.html`, `researcher.html`, `css/`, `js/` into each app at build time (the patient build leaves out researcher code)
- Min SDK 26, target/compile SDK 35, plain Java (no Kotlin plugin)
- Native code (`android/app/src/main/java/pk/movelab/kneequest/`):
  - `MainActivity` – WebView host; camera granted only to the app's own pages; screen kept on in the patient app; Back goes back through page history; edge-to-edge insets handled; debug builds can open a specific page
  - `AndroidBridge` – `getContext`, `saveSession` (safety copy in SQLite), `setLang`, `saveFile` (CSV export via the share sheet), `shareText` (study ID + access code via the share sheet)
  - `LocalDb` – SQLite table of finished sessions

### 4.3 Web-code changes made for the apps
- `js/okc/sync.js`: native safety copy is now **additional** to the study-store path (previously the native route would have bypassed it); exposes a `preview` flag for debug builds
- `js/okc/shell.js`: the mouse "preview" button is hidden in the app except in debug builds
- `js/study/researcher.js`: CSV export and access-code sharing use the native share sheet inside the app; shows the public sign-in address on access cards
- `okc.html`: service worker is skipped inside the app
- `participant.html`: the researcher link is hidden inside the patient app

### 4.4 Build and preview
- `gradlew assembleDebug` → both debug APKs build successfully (~2.4 MB each)
- Emulator could **not** be started: Windows Hypervisor Platform is off (needs admin + restart — a user-only step)
- Instead, phone-sized previews (412×892) of the exact bundled files were produced with a small stand-in for the bridge, and sent as screenshots (patient sign-in, Urdu home, Urdu game hub; researcher dashboard and participant outcomes). These approximate the WebView; they are not the emulator.
- The APKs have **not yet been run on a real device**.

---

## 5. GitHub connection

- The GitHub CLI is now signed in as `mahadbintariq2002-glitch` (scopes: repo, read:org, gist) via a one-time browser approval, and git is configured to use it. Pushes work without pasting tokens.
- A second account (`apexaiagent786-cpu`) is also saved on this PC but inactive.
- Earlier personal access tokens pasted into chat should be deleted at https://github.com/settings/tokens if not already done.
- The commit was pushed; the GitHub Pages site rebuilt on it and still serves correctly.

---

## 6. How to use what exists

**Install on a phone**
1. Copy the APK to the phone (USB, WhatsApp to yourself, or Google Drive)
2. Open it and allow installs from that source
3. Open "MoveLab Rehab", allow the camera, sign in with a Study ID + access code
4. The phone needs internet when a game starts (the pose model loads online)

**Open in Android Studio**: use the Desktop/Start-menu shortcut, then File → Open → the `android` folder; pick the build variant `patientDebug` or `researcherDebug`; Run.

**Build from a terminal**
```
cd android
set JAVA_HOME=C:\Users\fahad\AppData\Local\Programs\JDK21\jdk-21.0.13+9
gradlew assembleDebug
```

**Start the emulator later**: enable "Windows Hypervisor Platform" and "Virtual Machine Platform" in Windows Features, restart, then ask for an emulator run.

---

## 7. Open items / next steps

1. **Run the APKs on a real phone** and report any problems (camera, games, language)
2. **Decide how to share the APKs** (GitHub Release is public; Google Drive or direct transfer keeps them private)
3. **Create a Firebase project** and fill `js/study/cloud-config.js` — required for remote progress tracking and for the patient and researcher apps to see each other's data (see `cloud/SETUP.md`)
4. **Enable Windows Hypervisor Platform**, restart, then create the virtual phone and capture real emulator screenshots
5. Optional: bundle MediaPipe and the pose model inside the app for fully offline use; sign a release build; QR code / WhatsApp sharing for access codes; native Firebase sync
6. Clinical sign-off on the pain-advisory thresholds (`PAIN` in `js/okc/sync.js`, currently placeholders at 7/10)

---

## 8. Technical notes and gotchas

- Gradle 8.14 fails on Studio's JDK 25 (error message just says "25.0.4") → always use JDK 21 for `JAVA_HOME`
- `android/local.properties` must use forward slashes (`sdk.dir=C:/Users/.../Sdk`)
- `sdkmanager.bat` mangles package names containing `;`; run `com.android.sdklib.tool.sdkmanager.SdkManagerCli` through `java` directly
- Large downloads from Google reset mid-transfer; resume with `curl -C -`
- Study data is private: only the Study ID leaves the device with a session; names and CNIC stay in the researcher-only collection
- Debug APKs are for testing; a signed release build is needed for wider distribution
