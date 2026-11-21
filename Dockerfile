# syntax=docker/dockerfile:1
# check=error=true

# The pages are built and committed in dist/ (mise run build), so the image only serves them.
FROM docker.io/library/nginx:1.30-alpine

# `kamal shell` opens busybox sh (there's no bash here), which reads $ENV when interactive.
RUN echo "alias ll='ls -lah'" > /etc/profile.d/ll.sh
ENV ENV=/etc/profile.d/ll.sh

COPY config/nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/

# Each page is 70–150 KB of inline script and art: compress once here for gzip_static.
RUN gzip -k -9 /usr/share/nginx/html/*.html
