# ShopMe desktop app (Windows, macOS, Linux)

Run your store on your own computer: download, double-click, done. No terminal, no database to install.

## 1. Download

Open the [Releases page](https://github.com/aymaneprojects/shopme/releases/latest) and download the file for your system:

| System | File |
| --- | --- |
| Windows 10/11 (64-bit) | `ShopMe-<version>-win-x64.exe` |
| macOS, Apple Silicon (M1 and later) | `ShopMe-<version>-mac-apple-silicon.dmg` |
| macOS, Intel | `ShopMe-<version>-mac-intel.dmg` |
| Linux (64-bit) | `ShopMe-<version>-linux-x86_64.AppImage` (make it executable, then run it) |

On a Mac, open the Apple menu → **About This Mac**: "Chip Apple M…" means Apple Silicon, "Intel" means Intel. The Intel
build also runs on Apple Silicon, but much slower (Rosetta translation): ShopMe tells you at startup.

## 2. Install and first run

The apps are **not code-signed yet**, so your system will show a warning the first time. This is expected.

**Windows.** Run the installer. If a blue "Windows protected your PC" window appears (SmartScreen), click **More info**, then
**Run anyway**. ShopMe installs for your user only (no administrator rights needed).

**macOS.** Open the `.dmg` and drag ShopMe to Applications. The first time, do not double-click: **right-click (or Control-click)
ShopMe, choose Open, then Open** again. If macOS only offers "Move to Trash", go to **System Settings, Privacy & Security**, scroll
down and click **Open Anyway** next to the ShopMe message. If macOS says the app is "damaged", run
`xattr -cr /Applications/ShopMe.app` in Terminal once.

**Linux.** `chmod +x ShopMe-*.AppImage && ./ShopMe-*.AppImage`.

A small window shows "Starting your store…", then the admin opens. The setup wizard creates your store and owner account.

## 3. Using the app

The **ShopMe** menu has:

- **Open admin**: the back office window (reopens it if you closed it).
- **Open storefront**: your shop, in your normal browser.
- **Open data folder**: shows where everything is stored.
- **Export my store…** / **Import a store…**: save your whole store to a `.shopme` file and load it on a server (or another computer).
- **Quit**.

Closing the admin window quits ShopMe and stops the store.

## 4. Where your data lives

Everything (database, uploaded images, secrets) is in one folder, `data`, inside the app's user folder:

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\ShopMe\data` |
| macOS | `~/Library/Application Support/ShopMe/data` |
| Linux | `~/.config/ShopMe/data` |

Uninstalling the app does not delete this folder.

## 5. Back up

1. Quit ShopMe (the database must not be in use).
2. Copy the whole `data` folder somewhere safe (external drive, cloud storage).

To restore, quit ShopMe and put the copied `data` folder back in place. Back up regularly: it is your only copy.

## 6. Limits

- Your store is **online only while the computer is on and ShopMe is open**, and it is reachable from this computer only
  (`127.0.0.1`). Customers on the internet cannot visit it.
- For a store that is online 24/7 with your own domain and HTTPS, install ShopMe on a server instead:
  see [Install ShopMe](README.md).
- The app has no automatic updates yet: download the new version from Releases and install it over the old one. Your data is kept.

## For maintainers: building and signing

```bash
pnpm install && pnpm turbo run build
pnpm --filter @shopme/desktop dist        # installer for the current OS, in apps/desktop/dist
pnpm --filter @shopme/desktop dist:dir    # unpacked app, fast check
```

Pushing a tag `v*` runs `.github/workflows/release.yml` and attaches the installers to a GitHub Release. Builds are unsigned
unless these repository secrets exist:

| Secret | Purpose |
| --- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Code-signing certificate (base64 `.p12`/`.pfx` or URL) and its password: Windows and macOS. |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS notarization (also needs `CSC_LINK` with a Developer ID Application certificate). |
