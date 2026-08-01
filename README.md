# DermWatch

DermWatch is a private desktop photo journal for monitoring visible changes in
moles and other skin spots over time. Image analysis and storage stay on the
user's computer.

> [!IMPORTANT]
> DermWatch is not a medical device and does not diagnose cancer. A visual
> screen cannot confirm that a mole is benign. New, changing, bleeding, itching,
> or otherwise concerning spots should be assessed by a qualified clinician.

![DermWatch empty journal screen](docs/screenshots/overview.png)

## Install on Windows

1. Open the [latest release](https://github.com/amirmushichge/dermwatch/releases/latest).
2. Download `DermWatch-Setup-0.1.0.exe`.
3. Double-click the installer. DermWatch opens automatically when installation
   finishes.

No Node.js, command line, account, cloud service, or separate database is
required. The installer contains everything the application needs.

Windows may display a SmartScreen warning until DermWatch has a trusted code-
signing certificate. If that happens, verify that the installer was downloaded
from this repository before proceeding.

## What it does

- creates a separate record for each mole or skin spot;
- accepts one or several photos at once;
- checks sharpness, exposure, resolution, and segmentation confidence;
- measures visible asymmetry, border irregularity, color variation, and
  contrast using local image-processing heuristics;
- checks whether follow-up photos likely show the same spot;
- compares visible changes between observations;
- keeps a chronological photo history and reminder interval;
- stores all records locally.

## Privacy

The desktop application binds its internal services to the loopback interface
only. Photos are not uploaded to DermWatch, GitHub, or an external AI provider.

On Windows, records are stored under:

```text
%APPDATA%\DermWatch\data
```

Uninstalling the application does not delete this folder automatically, which
helps prevent accidental loss. See [PRIVACY.md](PRIVACY.md) for details.

## How the analysis works

DermWatch is not an LLM. It uses deterministic browser image processing:

```text
photo -> quality checks -> spot segmentation -> visual feature measurements
      -> identity check -> comparison -> user-facing guidance
```

The thresholds are experimental and have not been clinically validated. See
[DISCLAIMER.md](DISCLAIMER.md).

## Run from source

Requirements: Node.js 22.13 or newer.

```powershell
npm ci
npm run local-api
```

In a second terminal:

```powershell
npm run dev
```

Open `http://localhost:3000`.

## Build the Windows installer

```powershell
npm ci
npm test
npm run desktop:build
```

The installer is written to `release/`.

## Development checks

```powershell
npm run lint
npm test
```

## License

Source code is available under the [MIT License](LICENSE).
