#!/bin/bash
# Usuário/senha dos secrets, inbox no volume e host keys estáveis.
# IP allowlist no sshd não funciona atrás do Fly Proxy (origem vira o edge);
# a defesa é senha forte. O IP da Cielo (54.232.53.112) vai nas Observações do formulário.
set -Eeo pipefail

log() { echo "[cielo-sftp] $*" >&2; }

USER_NAME="${SFTP_USER:-cielo}"
PASS="${SFTP_PASSWORD:-}"

if [ -z "$PASS" ]; then
  log "FATAL: defina SFTP_PASSWORD (fly secrets set)."
  exit 1
fi
if [[ "$PASS" == *:* ]]; then
  log "FATAL: SFTP_PASSWORD não pode conter ':' (formato users.conf do atmoz)."
  exit 1
fi

mkdir -p /data/inbox /data/ssh
chmod 755 /data /data/inbox

# Host keys no volume — fingerprint estável entre deploys.
if [ -f /data/ssh/ssh_host_ed25519_key ]; then
  cp -a /data/ssh/ssh_host_ed25519_key /etc/ssh/ssh_host_ed25519_key
  cp -a /data/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null || true
else
  ssh-keygen -t ed25519 -f /etc/ssh/ssh_host_ed25519_key -N ''
  cp -a /etc/ssh/ssh_host_ed25519_key /etc/ssh/ssh_host_ed25519_key.pub /data/ssh/
fi

if [ -f /data/ssh/ssh_host_rsa_key ]; then
  cp -a /data/ssh/ssh_host_rsa_key /etc/ssh/ssh_host_rsa_key
  cp -a /data/ssh/ssh_host_rsa_key.pub /etc/ssh/ssh_host_rsa_key.pub 2>/dev/null || true
else
  ssh-keygen -t rsa -b 4096 -f /etc/ssh/ssh_host_rsa_key -N ''
  cp -a /etc/ssh/ssh_host_rsa_key /etc/ssh/ssh_host_rsa_key.pub /data/ssh/
fi
chmod 600 /etc/ssh/ssh_host_ed25519_key /etc/ssh/ssh_host_rsa_key

mkdir -p /etc/sftp
printf '%s\n' "${USER_NAME}:${PASS}:1001:100:inbox" > /etc/sftp/users.conf
chmod 600 /etc/sftp/users.conf

# Bind do volume em /home/<user>/inbox (symlink quebra no chroot do SFTP).
mkdir -p /etc/sftp.d
cat > /etc/sftp.d/10-bind-inbox <<EOF
#!/bin/bash
set -e
HOME_DIR="/home/${USER_NAME}"
TARGET="\$HOME_DIR/inbox"
mkdir -p "\$HOME_DIR" /data/inbox
if ! mountpoint -q "\$TARGET" 2>/dev/null; then
  rm -rf "\$TARGET"
  mkdir -p "\$TARGET"
  mount --bind /data/inbox "\$TARGET"
fi
chown -R 1001:100 /data/inbox
chmod 755 /data/inbox
EOF
chmod +x /etc/sftp.d/10-bind-inbox

log "user=${USER_NAME} dir=inbox volume=/data/inbox"
exec /entrypoint
