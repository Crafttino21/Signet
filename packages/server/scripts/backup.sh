#!/bin/bash
# Backs up the sync server's data volume.
#
# The server writes commits and blobs by writing a temporary file and renaming
# it, so every file in the volume is either complete or not there at all. That
# makes a backup while the container runs safe — no need to stop it and no window
# where a note is half written.
#
# What comes out is exactly as unreadable as the server itself: without the ring
# code it is noise, to a thief and to you alike. Keep the code somewhere else.

set -euo pipefail

VOLUME="server_toolbox-data"
DEST="/var/backups/toolbox-sync"
KEEP_DAYS=14
STAMP="$(date +%Y-%m-%d_%H%M%S)"
ARCHIVE="$DEST/toolbox-sync_$STAMP.tar.gz"

mkdir -p "$DEST"

docker run --rm \
	-v "$VOLUME:/data:ro" \
	-v "$DEST:/backup" \
	alpine \
	tar czf "/backup/$(basename "$ARCHIVE")" -C /data .

# An archive that cannot be read back is not a backup.
if ! tar tzf "$ARCHIVE" >/dev/null 2>&1; then
	echo "Backup $ARCHIVE is not readable, removing it" >&2
	rm -f "$ARCHIVE"
	exit 1
fi

chmod 600 "$ARCHIVE"
find "$DEST" -name 'toolbox-sync_*.tar.gz' -mtime "+$KEEP_DAYS" -delete

echo "$(date -Is) ok $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
