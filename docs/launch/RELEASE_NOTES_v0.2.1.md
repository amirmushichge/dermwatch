# DermWatch v0.2.1

DermWatch v0.2.1 is a safety and release-readiness update for Windows, macOS,
and Android.

## Downloads

- `DermWatch-0.2.1-win-x64.exe` — Windows x64 installer
- `DermWatch-0.2.1-mac-universal.dmg` — Apple Silicon and Intel macOS
- `app-release.apk` — signed Android APK

No Node.js, terminal, account, cloud service, or separate database is required.

## What changed

- added private JSON export and restore, including original photos;
- added Android sharing for portable backups before uninstall or phone changes;
- added packaged-app smoke tests that verify launch and persistence across two
  runs on Windows and macOS;
- refreshed launch visuals and the product screenshot with Manrope-only type;
- removed full stops from display headings;
- made ABCDE meter color intensity visibly increase toward red;
- added deterministic line-ending rules and ignored local release artifacts.

## Platform trust

The Android APK is signed with the project's stable release key. The current
Windows and macOS beta builds are not signed with commercial platform
certificates; Windows SmartScreen or macOS Gatekeeper may show a first-launch
warning. Download installers only from the official GitHub release.

## Important limitation

DermWatch is an experimental visual photo journal, not a medical device or a
skin-cancer diagnosis system. Its image-processing heuristics have not been
clinically validated. Do not delay professional care because of a DermWatch
result.
