# Turning on remote tracking (Firebase setup)

Until you do this, the app runs in **local demo mode** (data stays in one browser — fine for trying it out, but a
patient's phone cannot reach your dashboard). These steps take about 15 minutes and use your own Google account.

> **Ethics first.** Firebase stores data on Google servers. Confirm with your ethics committee / institution that
> storing de-identified participant data this way is approved, and replace the placeholder consent wording in
> `js/study/participant.js` with your approved text. Names and CNIC numbers are stored in a separate, researcher-only
> collection; the research data and exports use the Study ID only.

## 1. Create the project
1. Go to <https://console.firebase.google.com> → **Add project** (name it e.g. `movelab-study`; Analytics not needed).
2. **Build → Authentication → Get started**, then enable two sign-in methods:
   * **Email/Password** (for researchers)
   * **Anonymous** (for participants — they never see this; they sign in with Study ID + access code)
3. **Build → Firestore Database → Create database** → *Production mode*. Pick a region close to you
   (`asia-south1` Mumbai is nearest to Pakistan; this cannot be changed later).

## 2. Paste the security rules
Firestore → **Rules** tab → replace everything with the contents of [`firestore.rules`](firestore.rules) → **Publish**.
Use the **Rules Playground** to sanity-check (for example: an unauthenticated read of `identities/P001` must be denied).

## 3. Create your researcher account
1. Authentication → **Users → Add user** → your email + a strong password. Copy the user's **UID**.
2. Firestore → **Start collection** `researchers` → Document ID = that **UID** → add any field (e.g. `email: "you@…"`).
   Only accounts that have a document here can open the researcher dashboard. Repeat for each co-researcher.

## 4. Connect the app
1. Project settings (gear) → **Your apps → Web (</>)** → register an app → copy the `firebaseConfig` object.
2. Paste it into `js/study/cloud-config.js` (replace `export default null;`):
   ```js
   export default { apiKey: "…", authDomain: "…", projectId: "…", storageBucket: "…", messagingSenderId: "…", appId: "…" };
   ```
   (This config is not a secret; the rules are what protect the data.)
3. Authentication → **Settings → Authorized domains** → add the site's domain, e.g. `mahadbintariq2002-glitch.github.io`.
4. Commit and push. The dashboard badge changes from *Local demo mode* to *Cloud*.

## 5. Try it
* Open `researcher.html`, sign in, **Add participant** → note the Study ID and access code.
* On a **different browser or phone**, open `participant.html`, sign in with that ID + code, accept the consent, play a game.
* The session appears under the participant's **Game progress** tab within seconds (or when the phone is next online).

## Notes
* **Don't test the participant app in the same browser profile as the researcher dashboard** — the participant sign-in uses Firebase's
  anonymous session and the app refuses to replace a signed-in researcher.
* **Lost access code?** Participant → *Details & access* → **Issue new code**. Old devices are signed out automatically.
* **Offline:** sessions are saved on the phone and upload when it is next online.
* **Backups/exports:** use *Export* in the dashboard for CSVs; consider scheduled Firestore exports for a full backup.
* **Costs:** the free (Spark) tier is far more than a study of this size needs.
