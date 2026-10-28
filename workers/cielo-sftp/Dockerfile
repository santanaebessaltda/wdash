# Dropbox SFTP para a Cielo (Extrato Eletrônico, fluxo PUT).
FROM atmoz/sftp:alpine

COPY entrypoint.sh /entrypoint-wrap.sh
RUN chmod +x /entrypoint-wrap.sh

ENTRYPOINT ["/entrypoint-wrap.sh"]
