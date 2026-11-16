# Shared SSH settings for reaching a rooted TV. Sourced by scripts/deploy.sh (bash).
#   TELEDASH_TV     TV address, e.g. 192.168.1.50 (required: there is no default)
#   TELEDASH_KEY    SSH key on this computer (default ~/.ssh/teledash_tv)
#   TELEDASH_BATCH=1  never prompt (unattended jobs): fails straight away if the key is not set up
# Without the key, interactive use asks for the TV's root password once per run: the connection
# is kept open for two minutes and reused by every later ssh/scp in the same run.
# To set up the key: ssh-keygen -t ed25519 -f ~/.ssh/teledash_tv, then append the .pub file to
# /home/root/.ssh/authorized_keys on the TV.
if [ -z "${TELEDASH_TV:-}" ]; then
  echo "Set TELEDASH_TV to your TV's address first, e.g.  TELEDASH_TV=192.168.1.50 $0" >&2
  return 2 2>/dev/null || exit 2
fi
TV_HOST="$TELEDASH_TV"
TV_KEY="${TELEDASH_KEY:-$HOME/.ssh/teledash_tv}"
SSH_OPTS=(-o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
if [ -f "$TV_KEY" ]; then SSH_OPTS+=(-i "$TV_KEY" -o IdentitiesOnly=yes); fi
if [ "${TELEDASH_BATCH:-0}" = 1 ]; then
  SSH_OPTS+=(-o BatchMode=yes)
else
  SSH_OPTS+=(-o ControlMaster=auto -o "ControlPath=/tmp/teledash-ssh-%C" -o ControlPersist=120)
fi
tv_ssh() { ssh "${SSH_OPTS[@]}" "root@$TV_HOST" "$@"; }
tv_scp() { scp -O -q "${SSH_OPTS[@]}" "$1" "root@$TV_HOST:$2"; }   # -O: the TV's SSH server has no SFTP
