# Privacy

DermWatch is designed as a local-first desktop and Android application.

## Data processed

DermWatch stores the records entered by the user, including spot names, body
locations, notes, reminder intervals, photos, dates, optional size
measurements, and locally calculated visual features.

## Where data is stored

The installed application stores data in:

```text
Windows: %APPDATA%\DermWatch\data
macOS:   ~/Library/Application Support/DermWatch/data
Android: the app's private data directory
```

The application does not require an account and does not intentionally send
photos or records to an external server, analytics service, advertising
service, or AI provider.

Internal HTTP services bind to the loopback interface (`127.0.0.1`) and are
intended to be accessible only from the same computer. The Android application
stores metadata and images directly in app-private storage and does not request
broad photo-library or external-storage permission.

## Deletion

Individual records can be deleted inside the application. Uninstalling the
application does not automatically delete the data directory, to reduce the
risk of accidental loss. A user can permanently remove all DermWatch data by
deleting the folder shown above after closing the application.

On Android, uninstalling DermWatch removes its private records and photos. The
preview version does not yet provide export or restore, so users should not use
it as their only long-term copy of an important photo history.

## Backups

The current version does not create cloud backups. Users are responsible for
backing up the data directory if they want a separate copy.
