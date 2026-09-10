#!/usr/bin/env bash
#
# Sets up a Signet sync server on this machine.
#
# Run it on the machine that should hold the notes, from a checkout of this
# repository. It is safe to run again: an existing registration secret is never
# regenerated, and an existing container is rebuilt rather than replaced.
#
#   git clone https://github.com/Crafttino21/Signet.git
#   cd Signet/packages/server
#   ./install.sh
#
# Read it before you run it. It installs Docker if it is missing, writes a
# .env file, and opens a port on this machine — all of which it asks about
# first, and none of which it does quietly.

set -euo pipefail

PORT="${SIGNET_PORT:-8787}"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
die() {
	printf '\033[31mAbgebrochen: %s\033[0m\n' "$1" >&2
	exit 1
}

# Default yes, because every question here has an obvious answer for the case
# this script exists for. Anyone with a reason to say no knows they have one.
ask() {
	local reply
	printf '%s [J/n] ' "$1"
	read -r reply </dev/tty || reply=''
	case "$reply" in
	[nN] | [nN][eE][iI][nN] | [nN][oO]) return 1 ;;
	*) return 0 ;;
	esac
}

sudo_if_needed() {
	if [ "$(id -u)" -eq 0 ]; then
		"$@"
	elif command -v sudo >/dev/null 2>&1; then
		sudo "$@"
	else
		die "Für diesen Schritt werden Root-Rechte gebraucht, und sudo ist nicht da. Führe das Skript als root aus."
	fi
}

# --- 1. Docker ---------------------------------------------------------------

step "Docker"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
	echo "Docker und das Compose-Plugin sind da."
else
	warn "Docker oder das Compose-Plugin fehlt."
	if ! ask "Jetzt installieren?"; then
		die "Ohne Docker kann dieses Skript nichts aufsetzen."
	fi

	if command -v apt-get >/dev/null 2>&1; then
		sudo_if_needed apt-get update
		sudo_if_needed apt-get install -y docker.io docker-compose-plugin
	elif command -v dnf >/dev/null 2>&1; then
		sudo_if_needed dnf install -y docker docker-compose-plugin
		sudo_if_needed systemctl enable --now docker
	elif command -v pacman >/dev/null 2>&1; then
		sudo_if_needed pacman -Sy --noconfirm docker docker-compose
		sudo_if_needed systemctl enable --now docker
	else
		die "Diese Distribution kenne ich nicht. Installiere Docker samt Compose-Plugin von Hand und starte das Skript erneut."
	fi

	command -v docker >/dev/null 2>&1 || die "Docker ist nach der Installation immer noch nicht aufrufbar."
fi

# Docker needs root unless this user is in the docker group. Finding that out
# here beats a permission error three steps later.
if ! docker info >/dev/null 2>&1; then
	if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
		warn "Dieser Benutzer darf Docker nicht direkt ansprechen — die folgenden Befehle laufen über sudo."
		DOCKER="sudo docker"
	else
		die "Docker antwortet nicht. Läuft der Dienst? 'systemctl start docker'"
	fi
else
	DOCKER="docker"
fi

# --- 2. The registration secret ----------------------------------------------

step "Registrierungsschlüssel"

# Both spellings: this project was called Toolbox, and a server set up then has
# the old name in its .env. Generating a second secret beside it would work and
# would silently replace the one written down somewhere.
if [ -f .env ] && grep -qE '^(SIGNET|TOOLBOX)_REGISTRATION_SECRET=..*' .env; then
	SECRET="$(grep -E '^(SIGNET|TOOLBOX)_REGISTRATION_SECRET=' .env | head -n1 | cut -d= -f2-)"
	echo "Vorhandener Schlüssel in .env wird weiterverwendet."
else
	if command -v openssl >/dev/null 2>&1; then
		SECRET="$(openssl rand -hex 32)"
	else
		SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
	fi
	[ -n "$SECRET" ] || die "Konnte keinen Zufallsschlüssel erzeugen."

	# Written with the file created first and locked down before the secret goes
	# in, so it is never briefly world-readable.
	touch .env
	chmod 600 .env
	{
		echo "# Von install.sh erzeugt. Der Schlüssel legt Vaults an — nicht weitergeben."
		echo "SIGNET_REGISTRATION_SECRET=$SECRET"
	} >>.env
	echo "Neuer Schlüssel erzeugt und in .env abgelegt (nur für dich lesbar)."
fi

# --- 3. Reachable from the other devices -------------------------------------

step "Erreichbarkeit"

echo "Der Container lauscht von sich aus nur auf 127.0.0.1, ist also von anderen"
echo "Geräten nicht erreichbar. Für einen Sync-Server im eigenen Netz muss der"
echo "Port geöffnet werden."
echo
warn "Deine Notizen sind verschlüsselt, das Zugriffstoken ist es nicht. Im"
warn "Heimnetz ist das in Ordnung; ins offene Internet gehört ein Reverse Proxy"
warn "mit TLS davor."

if ask "Port $PORT im lokalen Netz öffnen?"; then
	cat >docker-compose.override.yml <<-YAML
		# Von install.sh erzeugt. Nicht in git — die Portfreigabe ist eine
		# Entscheidung pro Maschine.
		#
		# Das !override ist wichtig: ohne es ergänzt Compose die Portliste, statt sie
		# zu ersetzen, und der Container startet nicht, weil er beides binden will.
		services:
		    signet-sync:
		        ports: !override
		            - '0.0.0.0:$PORT:$PORT'
	YAML
	echo "docker-compose.override.yml geschrieben."
	EXPOSED=yes
else
	echo "Bleibt bei 127.0.0.1. Für andere Geräte brauchst du dann einen Reverse Proxy."
	EXPOSED=no
fi

# --- 4. Build and start ------------------------------------------------------

step "Bauen und starten"

$DOCKER compose up -d --build

# --- 5. Wait until it actually answers ---------------------------------------

step "Prüfen"

HEALTH=""
for _ in $(seq 1 30); do
	if HEALTH="$(curl -fsS --max-time 2 "http://127.0.0.1:$PORT/v1/health" 2>/dev/null)"; then
		break
	fi
	HEALTH=""
	sleep 1
done

if [ -z "$HEALTH" ]; then
	warn "Der Server hat nach 30 Sekunden nicht geantwortet. Das Log sagt warum:"
	$DOCKER compose logs --tail 40
	die "Server nicht erreichbar."
fi

echo "Der Server antwortet: $HEALTH"

# --- 6. What to type into the plugin -----------------------------------------

ADDRESS="http://127.0.0.1:$PORT"
if [ "$EXPOSED" = yes ]; then
	# The address the other devices need is the one on the network, not the
	# loopback the check above used.
	IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
	[ -n "${IP:-}" ] && ADDRESS="http://$IP:$PORT"
fi

step "Fertig"
echo
bold "In Obsidian: Signet → Ring erstellen. Dann diese beiden Angaben eintragen."
echo
echo "  Serveradresse:          $ADDRESS"
echo "  Registrierungsschlüssel: $SECRET"
echo
echo "Der Schlüssel wird genau einmal gebraucht, auf dem ersten Gerät. Jedes"
echo "weitere Gerät braucht nur den Beitrittscode, den Obsidian danach anzeigt."
echo
echo "Der Container startet ab jetzt bei jedem Boot mit. Nützliche Befehle:"
echo "  $DOCKER compose logs -f      Log mitlesen"
echo "  $DOCKER compose restart      neu starten"
echo "  $DOCKER compose down         anhalten"
