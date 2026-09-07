# SIGNING.md — Overload iOS (Sideload Edition)

Build and install Overload on your iPhone with a **free Apple ID**. No paid
developer account, no App Store. The app expires every **7 days** and is
refreshed by AltStore/SideStore automatically (see §4).

**Time for a stranger to go 0 → installed: ~10 minutes** (plus one Xcode
download if Xcode isn't installed yet).

---

## 0. Prerequisites

| Need | Where |
|---|---|
| Mac with Xcode 15+ | App Store (free) |
| Free Apple ID | appleid.apple.com |
| iPhone with iOS 16.2+ | — |
| Lightning/USB-C cable | — |
| This repo cloned on the Mac | — |

---

## 1. One-time: trust the Apple ID in Xcode

1. Open `ios/App/App.xcodeproj` in Xcode.
2. Select the **App** target → **Signing & Capabilities**.
3. Check **Automatically manage signing**.
4. Under **Team**, choose your **Personal Team** (your Apple ID). If it isn't
   listed: Xcode → Settings → Accounts → **+** → sign in.
5. Repeat for the **OverloadWidget** target (same Personal Team).
6. If Xcode complains the bundle ID is taken, change
   `PRODUCT_BUNDLE_IDENTIFIER` for both targets to anything unique, e.g.
   `personal.overload.app.yourname` (widget must be the app ID + `.widget`).

## 2. One-time: register your iPhone

1. Plug the iPhone into the Mac. Trust the prompt on the phone.
2. In Xcode's device menu (top toolbar), pick your iPhone.
3. On the phone: Settings → General → VPN & Device Management → find your
   Apple ID under **Developer App** → **Trust**.

## 3. Build + install (every code change)

```bash
npm install
npm run build:native          # static export → ./out
npx cap sync ios              # copy ./out into the shell
```

Then in Xcode: select your iPhone → **▶ Run**. First build asks Xcode to
"Allow" — accept. The app installs and launches.

**HealthKit note:** the free Personal Team supports the HealthKit
entitlement. If signing fails with an entitlement error, delete
`App/App.entitlements` and remove the `CODE_SIGN_ENTITLEMENTS` build setting
from both configurations — the app ships without HealthKit and the daily
check-in falls back to manual entry (documented in SPRINT_REPORT.md).

## 4. The 7-day cycle (AltStore — set up once, then forget)

A free-provisioning app **stops launching after 7 days**. AltStore refreshes
it automatically and **keeps all app data**.

1. On the Mac: download **AltServer** from altstore.io → install → it lives
   in the menu bar.
2. On the iPhone: install **AltStore** (AltServer menu-bar icon →
   `Install AltStore → [your iPhone]`).
3. In AltStore on the phone, sign in with the **same Apple ID**.
4. Keep the Mac on the same Wi-Fi as the phone — AltStore re-signs Overload
   in the background every day well before expiry.

**SideStore** (altstore.io/sidestore) is the wire-free alternative: it
refreshes on-device via a VPN trick, no Mac needed after setup.

Manual refresh anytime: AltStore → My Apps → Overload → **Refresh**.

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| "Unable to launch" after 7 days | AltStore refresh didn't run — open AltStore on the phone with the Mac on the same network, refresh Overload |
| "Maximum of 3 apps" | Free profile allows 3 sideloaded apps — delete one in Settings, then refresh |
| Signing team error on widget | Set the same Personal Team on **both** targets (§1.5) |
| Profile mismatch | Xcode → Signing & Capabilities → **Try Again** |
| Phone says "Untrusted developer" | §2.3 — trust the certificate |
| AltStore can't find phone | Same Wi-Fi + install Apple's "bonjour" if missing; or plug in via cable once |

## 6. What free provisioning can't do (by design)

- No push notifications (APNs) — Overload uses **local notifications only**,
  which free provisioning fully supports.
- No App Store distribution, no TestFlight.
- App + widget must be re-signed every 7 days (AltStore automates it).