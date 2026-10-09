#!/bin/sh
set -eu

if [ -z "${SFTP_PASSWORD:-}" ]; then
  echo "SFTP_PASSWORD ausente" >&2
  exit 1
fi

if [ ! -f /etc/ssh/ssh_host_ed25519_key ]; then
  ssh-keygen -q -t ed25519 -f /etc/ssh/ssh_host_ed25519_key -N ""
fi
if [ ! -f /etc/ssh/ssh_host_rsa_key ]; then
  ssh-keygen -q -t rsa -b 4096 -f /etc/ssh/ssh_host_rsa_key -N ""
fi

mkdir -p /sftp/cielo/entrada /run/sshd
chown root:root /sftp /sftp/cielo
chmod 755 /sftp /sftp/cielo
chown cielo:cielo /sftp/cielo/entrada
chmod 755 /sftp/cielo/entrada

echo "cielo:${SFTP_PASSWORD}" | chpasswd
exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config.cielo
