FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-server \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 1001 cielo \
 && useradd -u 1001 -g 1001 -M -d /entrada -s /usr/sbin/nologin cielo \
 && mkdir -p /sftp/cielo/entrada /data/ssh /run/sshd \
 && chown root:root /sftp /sftp/cielo \
 && chmod 755 /sftp /sftp/cielo

COPY sshd_config /etc/ssh/sshd_config.cielo
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod 755 /entrypoint.sh

EXPOSE 2222
ENTRYPOINT ["/entrypoint.sh"]
