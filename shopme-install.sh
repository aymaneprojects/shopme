#!/usr/bin/env bash
# shopme-install.sh - install, update, back up and check a ShopMe server with one command.
#
#   sudo ./shopme-install.sh install --domain shop.example.com --email you@example.com
#   sudo ./shopme-install.sh help
#
# Debian/Ubuntu (x86_64 or arm64), run as root. Idempotent. Non-interactive with flags, simple prompts otherwise.
# Documentation: docs/install/quick-install.md
#
# Testing hooks (never needed in production):
#   SHOPME_DRY_RUN=1       print the commands and file writes instead of running them
#   SHOPME_OVERRIDE_*      replace what the script detects (public IP, DNS answers, RAM, swap, web server, health)
#   SHOPME_SOURCE_ONLY=1   load the functions without running anything (used by the test suite)

# shellcheck disable=SC2034
SHOPME_VERSION_SCRIPT="1.0.0"

# Where release bundles are downloaded from for `--version X`. {version} and {arch} (x64 or arm64) are replaced.
# Override it to use a mirror or a private release host.
SHOPME_BUNDLE_URL_TEMPLATE="${SHOPME_BUNDLE_URL_TEMPLATE:-https://github.com/aymaneprojects/shopme/releases/download/v{version}/shopme-server-{version}-{arch}.tar.gz}"
SHOPME_MIN_BUILD_RAM_MB="${SHOPME_MIN_BUILD_RAM_MB:-3072}"
SHOPME_SWAP_MB="${SHOPME_SWAP_MB:-2048}"
SHOPME_DNS_WAIT_SECONDS="${SHOPME_DNS_WAIT_SECONDS:-300}"
SHOPME_HEALTH_TRIES="${SHOPME_HEALTH_TRIES:-60}"
SHOPME_HEALTH_INTERVAL="${SHOPME_HEALTH_INTERVAL:-3}"
SHOPME_BACKUP_KEEP_DAYS="${SHOPME_BACKUP_KEEP_DAYS:-14}"
SHOPME_INSTALL_BIN="${SHOPME_INSTALL_BIN:-/usr/local/sbin/shopme-install.sh}"
SHOPME_NGINX_DIR="${SHOPME_NGINX_DIR:-/etc/nginx}"
SHOPME_CRON_FILE="${SHOPME_CRON_FILE:-/etc/cron.d/shopme-backup}"
SHOPME_DNS_CRED_DIR="${SHOPME_DNS_CRED_DIR:-/etc/shopme}"

# ---------------------------------------------------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------------------------------------------------

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BOLD=$'\033[1m'; C_OFF=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BOLD=""; C_OFF=""
fi

info() { [ "${QUIET:-0}" = 1 ] || printf '%s\n' "$*"; }
step() { [ "${QUIET:-0}" = 1 ] || printf '\n%s==> %s%s\n' "$C_BOLD" "$*" "$C_OFF"; }
warn() { printf '%sWARN%s %s\n' "$C_YELLOW" "$C_OFF" "$*" >&2; }
die() { printf '%sERROR%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; exit 1; }

is_dry() { [ "${SHOPME_DRY_RUN:-0}" = 1 ]; }

# run <command...>: execute, or print it in dry-run mode. Secrets never travel on a command line.
run() {
  if is_dry; then
    printf '+'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

# write_file <path> <mode> <public|secret>  (content on stdin)
# Dry-run prints the content of public files and hides the content of secret ones.
write_file() {
  local path=$1 mode=$2 kind=$3
  if is_dry; then
    printf '+ write %s (mode %s)\n' "$path" "$mode"
    if [ "$kind" = secret ]; then
      cat >/dev/null
      printf '  [content hidden]\n'
    else
      sed 's/^/  | /'
    fi
    return 0
  fi
  local tmp
  tmp="$(umask 077 && mktemp "${path}.XXXXXX")" || die "Cannot write $path"
  cat >"$tmp"
  chmod "$mode" "$tmp"
  mv -f "$tmp" "$path"
}

# ---------------------------------------------------------------------------------------------------------------------
# Defaults and argument parsing
# ---------------------------------------------------------------------------------------------------------------------

reset_options() {
  CMD=""
  POSITIONAL=()
  OPT_DOMAIN=""; OPT_EMAIL=""; OPT_MULTI=""; OPT_BUNDLE=""; OPT_VERSION=""; OPT_SHA256=""
  OPT_DIR="${SHOPME_DIR:-/opt/shopme}"; OPT_PORT="3200"; OPT_SOURCE=""
  OPT_FORCE=0; OPT_YES=0; OPT_ADD_SWAP=0; OPT_JSON=0; OPT_PURGE=0; OPT_NO_PROXY=0; OPT_MANUAL_DNS=0
  OPT_DNS_PROVIDER=""; OPT_DNS_CREDENTIALS=""
  OPT_DB_ONLY=0; OPT_UPLOADS_ONLY=0; QUIET=0
}

usage() {
  cat <<'EOF'
ShopMe installer

Usage: shopme-install.sh <command> [options]

Commands
  install            Install ShopMe (Docker, HTTPS, database, nightly backups).
  update             Back up, replace the app, restart, roll back automatically if it does not become healthy.
  backup             Back up the database and the uploaded files now.
  restore <file>     Restore a database dump (db-*.sql.gz) or a files archive (uploads-*.tar.gz).
  status             Containers, health, disk, memory, certificate.
  doctor             status plus DNS, outgoing port 25, reverse DNS (PTR), public IP and web server config.
  add-domain <host>  Multi-store with nginx: get a certificate for a store's own domain.
  renew              Renew certificates now (re-runs the DNS challenge when --manual-dns was used).
  uninstall          Remove containers, site file and cron job. Data is kept unless --purge.
  help               This text.

Options
  --domain <host>          Public host name of the shop (the admin host in multi-store mode).
  --email <address>        Contact address for the certificate authority.
  --multi-store <base>     Several stores on subdomains of <base> (wildcard DNS needed).
  --bundle <path|https-url> Prebuilt bundle (shopme-server-<version>.tar.gz).
  --version <x.y.z>        Download that release's bundle (see SHOPME_BUNDLE_URL_TEMPLATE).
  --sha256 <hex>           Expected checksum of the bundle.
  --source <dir>           Source checkout to build from (default: this script's folder, when it has a Dockerfile).
  --dir <path>             Installation folder (default /opt/shopme).
  --port <n>               Loopback port of the app (default 3200).
  --dns-provider <name>    cloudflare | ovh | gandi | digitalocean | route53 (wildcard certificate, nginx).
  --dns-credentials <file> API credentials file for that provider (copied to a root-only file, never printed).
  --manual-dns             Wildcard certificate with a TXT record you add by hand (renew every 90 days).
  --no-proxy               Do not set up HTTPS: the app only listens on 127.0.0.1:<port>.
  --add-swap               Add 2 GB of swap when there is none, without asking.
  --force                  Continue despite a DNS mismatch or an existing site name in nginx.
  -y, --yes                Answer yes to every question.
  --json                   status/doctor: machine-readable output.
  --purge                  uninstall: also delete data, backups and volumes.
  --db-only, --uploads-only  backup: only one of the two.
  --quiet                  Less output (used by cron).
  -h, --help               This text.
EOF
}

# parse_args <args...>: fills CMD, POSITIONAL and OPT_*.
parse_args() {
  reset_options
  while [ "$#" -gt 0 ]; do
    case "$1" in
      install|update|backup|restore|status|doctor|add-domain|renew|uninstall|help)
        if [ -z "$CMD" ]; then CMD=$1; else POSITIONAL+=("$1"); fi ;;
      -h|--help) CMD=help ;;
      --domain|--email|--multi-store|--bundle|--version|--sha256|--dir|--port|--source|--dns-provider|--dns-credentials)
        [ "$#" -ge 2 ] || die "Option $1 needs a value"
        case "$1" in
          --domain) OPT_DOMAIN=$2 ;;
          --email) OPT_EMAIL=$2 ;;
          --multi-store) OPT_MULTI=$2 ;;
          --bundle) OPT_BUNDLE=$2 ;;
          --version) OPT_VERSION=$2 ;;
          --sha256) OPT_SHA256=$2 ;;
          --dir) OPT_DIR=$2 ;;
          --port) OPT_PORT=$2 ;;
          --source) OPT_SOURCE=$2 ;;
          --dns-provider) OPT_DNS_PROVIDER=$2 ;;
          --dns-credentials) OPT_DNS_CREDENTIALS=$2 ;;
        esac
        shift ;;
      --domain=*) OPT_DOMAIN=${1#*=} ;;
      --email=*) OPT_EMAIL=${1#*=} ;;
      --multi-store=*) OPT_MULTI=${1#*=} ;;
      --bundle=*) OPT_BUNDLE=${1#*=} ;;
      --version=*) OPT_VERSION=${1#*=} ;;
      --dns-provider=*) OPT_DNS_PROVIDER=${1#*=} ;;
      --dns-credentials=*) OPT_DNS_CREDENTIALS=${1#*=} ;;
      --manual-dns) OPT_MANUAL_DNS=1 ;;
      --no-proxy) OPT_NO_PROXY=1 ;;
      --add-swap) OPT_ADD_SWAP=1 ;;
      --force) OPT_FORCE=1 ;;
      -y|--yes) OPT_YES=1 ;;
      --json) OPT_JSON=1 ;;
      --purge) OPT_PURGE=1 ;;
      --db-only) OPT_DB_ONLY=1 ;;
      --uploads-only) OPT_UPLOADS_ONLY=1 ;;
      --quiet) QUIET=1 ;;
      -*) die "Unknown option: $1 (see: shopme-install.sh help)" ;;
      *) POSITIONAL+=("$1") ;;
    esac
    shift
  done
  [ -n "$CMD" ] || CMD=help
  return 0
}

# ---------------------------------------------------------------------------------------------------------------------
# Validation (pure)
# ---------------------------------------------------------------------------------------------------------------------

# valid_hostname <host>: lowercase DNS name with at least two labels, no wildcard, no IP, no trailing dot.
valid_hostname() {
  local h=$1 re='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
  [ -n "$h" ] && [ "${#h}" -le 253 ] || return 1
  [[ $h =~ $re ]]
}

valid_email() {
  local e=$1 re='^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$'
  [ "${#e}" -le 254 ] || return 1
  [[ $e =~ $re ]]
}

valid_port() {
  local re='^[0-9]{2,5}$'
  [[ $1 =~ $re ]] && [ "$1" -ge 1024 ] && [ "$1" -le 65535 ]
}

valid_dns_provider() {
  case "$1" in cloudflare|ovh|gandi|digitalocean|route53) return 0 ;; *) return 1 ;; esac
}

valid_version() {
  local re='^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$'
  [[ $1 =~ $re ]]
}

valid_sha256() {
  local re='^[0-9a-fA-F]{64}$'
  [[ $1 =~ $re ]]
}

# Paths that end up on command lines or in files: a conservative character set.
safe_path() {
  local re='^/[A-Za-z0-9._/@+-]*$'
  [[ $1 =~ $re ]]
}

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# is_covered_by_wildcard <host> <base>: true when host is exactly one label under base (so *.base covers it).
is_covered_by_wildcard() {
  local host=$1 base=$2 rest
  case "$host" in *".$base") ;; *) return 1 ;; esac
  rest=${host%".$base"}
  case "$rest" in ''|*.*) return 1 ;; esac
  return 0
}

# ---------------------------------------------------------------------------------------------------------------------
# Secrets and the .env file (pure except for gen_secret)
# ---------------------------------------------------------------------------------------------------------------------

gen_secret() {
  # 32 random bytes as hex; the value is only ever written to a 600 file.
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# env_get <file> <KEY>: value of KEY in a KEY=VALUE file, empty when missing.
env_get() {
  [ -f "$1" ] || return 0
  local line
  line=$(grep -m1 "^$2=" "$1" 2>/dev/null || true)
  printf '%s' "${line#*=}"
}

# render_env: reads the ENVV_* variables, prints the .env file.
#   ENVV_DOMAIN ENVV_MULTI ENVV_PORT ENVV_PUBLIC_IP ENVV_PG_PASSWORD ENVV_SESSION_SECRET ENVV_HTTPS (1|0)
render_env() {
  local scheme=https
  [ "${ENVV_HTTPS:-1}" = 1 ] || scheme=http
  cat <<EOF
# Generated by shopme-install.sh. Contains secrets: keep mode 600, never commit or share this file.
APP_URL=${scheme}://${ENVV_DOMAIN}
SHOPME_PORT=${ENVV_PORT}
POSTGRES_PASSWORD=${ENVV_PG_PASSWORD}
SESSION_SECRET=${ENVV_SESSION_SECRET}
TRUST_PROXY=true
HSTS=$([ "$scheme" = https ] && echo true || echo false)
LOG_LEVEL=info
PUBLIC_IP=${ENVV_PUBLIC_IP:-}
SMTP_URL=
MAIL_FROM=
EOF
  if [ -n "${ENVV_MULTI:-}" ]; then
    cat <<EOF
MULTI_STORE=true
STORE_BASE_DOMAIN=${ENVV_MULTI}
ADMIN_HOST=${ENVV_DOMAIN}
EOF
  else
    cat <<EOF
MULTI_STORE=false
STORE_BASE_DOMAIN=
ADMIN_HOST=
EOF
  fi
}

# ---------------------------------------------------------------------------------------------------------------------
# Templates (pure): compose file, Caddyfile, nginx site
# ---------------------------------------------------------------------------------------------------------------------

# render_compose <caddy|nginx|none>
render_compose() {
  local proxy=$1
  cat <<'EOF'
# Generated by shopme-install.sh. The app comes from ./app (prebuilt), run by the official Node image.
name: shopme
services:
  shopme:
    image: node:22-slim
    restart: unless-stopped
    working_dir: /app
    command: ["node", "apps/server/dist/main.js"]
    user: "1000:1000"
    mem_limit: 768m
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "127.0.0.1:${SHOPME_PORT:-3200}:3000"
    environment:
      NODE_ENV: production
      NODE_OPTIONS: --max-old-space-size=512
      PORT: "3000"
      HOST: 0.0.0.0
      DATA_DIR: /data
      DATABASE_URL: postgres://shopme:${POSTGRES_PASSWORD}@db:5432/shopme
      APP_URL: ${APP_URL}
      SESSION_SECRET: ${SESSION_SECRET}
      TRUST_PROXY: ${TRUST_PROXY:-true}
      HSTS: ${HSTS:-false}
      LOG_LEVEL: ${LOG_LEVEL:-info}
      PUBLIC_IP: ${PUBLIC_IP:-}
      SMTP_URL: ${SMTP_URL:-}
      MAIL_FROM: ${MAIL_FROM:-}
      MULTI_STORE: ${MULTI_STORE:-false}
      STORE_BASE_DOMAIN: ${STORE_BASE_DOMAIN:-}
      ADMIN_HOST: ${ADMIN_HOST:-}
    volumes:
      - ./app:/app:ro
      - ./data:/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 30s

  db:
    image: postgres:17
    restart: unless-stopped
    mem_limit: 512m
    command: ["postgres", "-c", "shared_buffers=128MB", "-c", "max_connections=60"]
    environment:
      POSTGRES_USER: shopme
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: shopme
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U shopme -d shopme"]
      interval: 5s
      timeout: 5s
      retries: 10
EOF
  if [ "$proxy" = caddy ]; then
    cat <<'EOF'

  caddy:
    image: caddy:2
    restart: unless-stopped
    mem_limit: 128m
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - shopme
EOF
  fi
  printf '\nvolumes:\n  pgdata:\n'
  if [ "$proxy" = caddy ]; then
    printf '  caddy-data:\n  caddy-config:\n'
  fi
}

# render_caddyfile <domain> <email> [multi-base]
render_caddyfile() {
  local domain=$1 email=$2 multi=${3:-}
  printf '# Generated by shopme-install.sh\n{\n\temail %s\n' "$email"
  if [ -n "$multi" ]; then
    printf '\ton_demand_tls {\n\t\task http://shopme:3000/__shopme/tls-ask\n\t}\n'
  fi
  printf '}\n\n%s {\n\tencode zstd gzip\n\treverse_proxy shopme:3000\n}\n' "$domain"
  if [ -n "$multi" ]; then
    # Every other host (stores' permanent hosts and their own domains): certificates only when ShopMe says it serves the host.
    printf '\nhttps:// {\n\ttls {\n\t\ton_demand\n\t}\n\tencode zstd gzip\n\treverse_proxy shopme:3000\n}\n'
    printf '\nhttp:// {\n\tredir https://{host}{uri} permanent\n}\n'
  fi
}

# nginx_proxy_block <port>: the shared location blocks.
nginx_proxy_block() {
  cat <<EOF
    client_max_body_size 64m;

    # Only Caddy-style on-demand TLS needs this; it is not meant for the public.
    location = /__shopme/tls-ask { return 404; }

    location / {
        proxy_pass http://127.0.0.1:$1;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_read_timeout 120s;
    }
EOF
}

# render_nginx_site <http|tls> <server_names> <port> [cert_dir]
# http: port 80 only (certbot --nginx then adds the certificate). tls: port 80 redirects, port 443 serves.
render_nginx_site() {
  local mode=$1 names=$2 port=$3 cert=${4:-}
  printf '# Managed by shopme-install.sh. Only this file is managed; other sites are never touched.\n'
  if [ "$mode" = http ]; then
    printf 'server {\n    listen 80;\n    listen [::]:80;\n    server_name %s;\n\n' "$names"
    nginx_proxy_block "$port"
    printf '}\n'
  else
    # shellcheck disable=SC2016
    printf 'server {\n    listen 80;\n    listen [::]:80;\n    server_name %s;\n    return 301 https://$host$request_uri;\n}\n\n' "$names"
    printf 'server {\n    listen 443 ssl http2;\n    listen [::]:443 ssl http2;\n    server_name %s;\n\n' "$names"
    printf '    ssl_certificate %s/fullchain.pem;\n    ssl_certificate_key %s/privkey.pem;\n' "$cert" "$cert"
    printf '    ssl_protocols TLSv1.2 TLSv1.3;\n    ssl_session_cache shared:shopme_ssl:10m;\n    ssl_session_timeout 1d;\n\n'
    nginx_proxy_block "$port"
    printf '}\n'
  fi
}

# nginx_server_names <domain> [multi-base]: names of the main site, without duplicates.
nginx_server_names() {
  local domain=$1 base=${2:-}
  if [ -z "$base" ]; then printf '%s' "$domain"; return; fi
  if is_covered_by_wildcard "$domain" "$base"; then
    printf '%s *.%s' "$base" "$base"
  else
    printf '%s %s *.%s' "$domain" "$base" "$base"
  fi
}

# certbot_dns_args <provider> <credentials-file>: the plugin flags (no secret in them, only the path).
certbot_dns_args() {
  case "$1" in
    cloudflare) printf '%s\n' --dns-cloudflare --dns-cloudflare-credentials "$2" ;;
    ovh) printf '%s\n' --dns-ovh --dns-ovh-credentials "$2" ;;
    digitalocean) printf '%s\n' --dns-digitalocean --dns-digitalocean-credentials "$2" ;;
    gandi) printf '%s\n' --authenticator dns-gandi --dns-gandi-credentials "$2" ;;
    route53) printf '%s\n' --dns-route53 ;;
    *) return 1 ;;
  esac
}

certbot_dns_packages() {
  case "$1" in
    cloudflare) echo python3-certbot-dns-cloudflare ;;
    ovh) echo python3-certbot-dns-ovh ;;
    digitalocean) echo python3-certbot-dns-digitalocean ;;
    route53) echo python3-certbot-dns-route53 ;;
    gandi) echo "" ;;
  esac
}

# render_bundle_url <template> <version> <arch>
render_bundle_url() {
  local url=$1
  url=${url//\{version\}/$2}
  url=${url//\{arch\}/$3}
  printf '%s' "$url"
}

# ---------------------------------------------------------------------------------------------------------------------
# Decisions (pure)
# ---------------------------------------------------------------------------------------------------------------------

# decide_build <free_ram_mb> <min_mb>: build | refuse
decide_build() { if [ "$1" -ge "$2" ]; then echo build; else echo refuse; fi; }

# decide_after_health <healthy|unhealthy>: keep | rollback
decide_after_health() { if [ "$1" = healthy ]; then echo keep; else echo rollback; fi; }

# classify_webserver <listeners...> : reads "process" names listening on 80/443 (one per argument).
# Echoes nginx | none | other:<name>.  `nginx_installed_active` (yes|no) is the first argument.
classify_webserver() {
  local active=$1 p other="" saw_nginx=0
  shift
  for p in "$@"; do
    case "$p" in
      nginx) saw_nginx=1 ;;
      '') ;;
      *) other=$p ;;
    esac
  done
  if [ -n "$other" ]; then echo "other:$other"
  elif [ "$saw_nginx" = 1 ] || [ "$active" = yes ]; then echo nginx
  else echo none
  fi
}

# bundle_list_ok: reads a tar listing on stdin; fails on absolute paths, '..' or entries outside the known layout.
bundle_list_ok() {
  local line
  while IFS= read -r line; do
    line=${line#./}
    case "$line" in
      ''|.) continue ;;
      /*|..|../*|*/../*|*/..) return 1 ;;
      app|app/*|templates|templates/*|README.md|VERSION|shopme-install.sh) ;;
      *) return 1 ;;
    esac
  done
}

# days_until <date string accepted by date -d> [now_epoch]: whole days from now (negative when past).
days_until() {
  local end now=${2:-$(date +%s)}
  end=$(date -d "$1" +%s 2>/dev/null) || { echo ""; return 1; }
  echo $(( (end - now) / 86400 ))
}

# health_wait <tries> <interval> <probe-command...>: succeeds as soon as the probe does.
health_wait() {
  local tries=$1 interval=$2 i
  shift 2
  for ((i = 1; i <= tries; i++)); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    [ "$i" -lt "$tries" ] && sleep "$interval"
  done
  return 1
}

# json_str <string>: JSON string literal.
json_str() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\t'/\\t}
  s=${s//$'\r'/}
  printf '"%s"' "$s"
}

# ---------------------------------------------------------------------------------------------------------------------
# Checks registry (used by status / doctor)
# ---------------------------------------------------------------------------------------------------------------------

CHK_LEVEL=(); CHK_ID=(); CHK_MSG=(); CHK_FIX=()

# add_check <OK|WARN|FAIL> <id> <message> [fix]
add_check() { CHK_LEVEL+=("$1"); CHK_ID+=("$2"); CHK_MSG+=("$3"); CHK_FIX+=("${4:-}"); }

# emit_checks: prints the registry, returns 1 when any check failed.
emit_checks() {
  local i n=${#CHK_ID[@]} ok=0 warns=0 fails=0
  for ((i = 0; i < n; i++)); do
    case "${CHK_LEVEL[$i]}" in OK) ok=$((ok + 1)) ;; WARN) warns=$((warns + 1)) ;; FAIL) fails=$((fails + 1)) ;; esac
  done
  if [ "$OPT_JSON" = 1 ]; then
    printf '{"ok":%s,"summary":{"ok":%s,"warn":%s,"fail":%s},"checks":[' "$([ "$fails" -eq 0 ] && echo true || echo false)" "$ok" "$warns" "$fails"
    for ((i = 0; i < n; i++)); do
      [ "$i" -gt 0 ] && printf ','
      printf '{"id":%s,"level":%s,"message":%s,"fix":%s}' "$(json_str "${CHK_ID[$i]}")" "$(json_str "${CHK_LEVEL[$i]}")" "$(json_str "${CHK_MSG[$i]}")" "$(json_str "${CHK_FIX[$i]}")"
    done
    printf ']}\n'
  else
    local colour
    for ((i = 0; i < n; i++)); do
      case "${CHK_LEVEL[$i]}" in OK) colour=$C_GREEN ;; WARN) colour=$C_YELLOW ;; *) colour=$C_RED ;; esac
      printf '%s[%-4s]%s %s\n' "$colour" "${CHK_LEVEL[$i]}" "$C_OFF" "${CHK_MSG[$i]}"
      [ -z "${CHK_FIX[$i]}" ] || printf '         Fix: %s\n' "${CHK_FIX[$i]}"
    done
    printf '\n%s OK, %s warning(s), %s failure(s)\n' "$ok" "$warns" "$fails"
  fi
  [ "$fails" -eq 0 ]
}

# ---------------------------------------------------------------------------------------------------------------------
# Detection helpers (overridable for tests)
# ---------------------------------------------------------------------------------------------------------------------

detect_arch() {
  local m=${SHOPME_OVERRIDE_ARCH:-$(uname -m)}
  case "$m" in
    x86_64|amd64) echo x64 ;;
    aarch64|arm64) echo arm64 ;;
    *) echo "unsupported:$m" ;;
  esac
}

detect_os_ok() {
  local ids=${SHOPME_OVERRIDE_OS:-}
  if [ -z "$ids" ] && [ -r /etc/os-release ]; then
    ids=$(. /etc/os-release && echo "${ID:-} ${ID_LIKE:-}")
  fi
  case " $ids " in *" debian "*|*" ubuntu "*) return 0 ;; *) return 1 ;; esac
}

preflight_platform() {
  [ "$(uname -s)" = Linux ] || die "ShopMe's installer runs on Linux (Debian or Ubuntu). This system is $(uname -s)."
  detect_os_ok || die "Only Debian and Ubuntu are supported by this installer. Use the Docker Compose guide (docs/install/README.md) on other systems."
  case "$(detect_arch)" in unsupported:*) die "Unsupported CPU ($(uname -m)). Supported: x86_64 and arm64." ;; esac
  if ! is_dry && [ "$(id -u)" -ne 0 ]; then die "Run as root: sudo $0 $CMD ..."; fi
  return 0
}

mem_available_mb() {
  if [ -n "${SHOPME_OVERRIDE_FREE_RAM_MB:-}" ]; then echo "$SHOPME_OVERRIDE_FREE_RAM_MB"; return; fi
  awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo
}
mem_total_mb() { awk '/^MemTotal:/ {print int($2/1024)}' /proc/meminfo; }
swap_total_mb() {
  if [ -n "${SHOPME_OVERRIDE_SWAP_MB:-}" ]; then echo "$SHOPME_OVERRIDE_SWAP_MB"; return; fi
  awk '/^SwapTotal:/ {print int($2/1024)}' /proc/meminfo
}

public_ip() {
  local fam=$1 url ip re4='^[0-9]{1,3}(\.[0-9]{1,3}){3}$' re6='^[0-9a-fA-F:]+:[0-9a-fA-F:]*$'
  if [ "$fam" = 4 ] && [ -n "${SHOPME_OVERRIDE_PUBLIC_IP:-}" ]; then echo "$SHOPME_OVERRIDE_PUBLIC_IP"; return; fi
  if [ "$fam" = 6 ] && [ "${SHOPME_OVERRIDE_PUBLIC_IP6+set}" = set ]; then echo "$SHOPME_OVERRIDE_PUBLIC_IP6"; return; fi
  for url in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    [ "$fam" = 6 ] && url=${url/api.ipify.org/api6.ipify.org}
    ip=$(curl -"$fam" -fsS --max-time 6 "$url" 2>/dev/null | tr -d '[:space:]' || true)
    if [ "$fam" = 4 ] && [[ $ip =~ $re4 ]]; then echo "$ip"; return; fi
    if [ "$fam" = 6 ] && [[ $ip =~ $re6 ]]; then echo "$ip"; return; fi
  done
  echo ""
}

# resolve_ips <host> <4|6>: addresses, one per line.
resolve_ips() {
  if [ -n "${SHOPME_OVERRIDE_DNS+set}" ]; then
    local ip re6=':'
    for ip in $SHOPME_OVERRIDE_DNS; do
      if [ "$2" = 6 ]; then [[ $ip =~ $re6 ]] && echo "$ip"; else [[ $ip =~ $re6 ]] || echo "$ip"; fi
    done
    return 0
  fi
  if [ "$2" = 4 ]; then getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u
  else getent ahostsv6 "$1" 2>/dev/null | awk '{print $1}' | sort -u; fi
  return 0
}

# dns_status <host> <pub4> <pub6>: ok | missing | mismatch:<ips>
dns_status() {
  local host=$1 pub4=$2 pub6=$3 a aaaa all
  a=$(resolve_ips "$host" 4 | tr '\n' ' ')
  aaaa=$(resolve_ips "$host" 6 | tr '\n' ' ')
  all="$a$aaaa"
  if [ -z "${all// /}" ]; then echo missing; return; fi
  if [ -n "$pub4" ] && [ -n "${a// /}" ]; then
    case " $a" in *" $pub4 "*) ;; *) echo "mismatch:${a% }"; return ;; esac
  elif [ -n "$pub4" ] && [ -z "${a// /}" ]; then
    echo "mismatch:${aaaa% }"; return
  fi
  if [ -n "${aaaa// /}" ]; then
    case " $aaaa" in *" $pub6 "*) ;; *) echo "mismatch:${aaaa% }"; return ;; esac
  fi
  echo ok
}

# detect_webserver: nginx | none | other:<name>
detect_webserver() {
  if [ -n "${SHOPME_OVERRIDE_WEBSERVER:-}" ]; then echo "$SHOPME_OVERRIDE_WEBSERVER"; return; fi
  local procs=() active=no line
  while IFS= read -r line; do procs+=("$line"); done < <(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | sort -u)
  if command -v nginx >/dev/null 2>&1 && systemctl is-active --quiet nginx 2>/dev/null; then active=yes; fi
  classify_webserver "$active" "${procs[@]}"
}

# ---------------------------------------------------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------------------------------------------------

have_tty() { [ -t 0 ] && [ -t 1 ]; }

# confirm <question> [default y|n]
confirm() {
  local q=$1 def=${2:-n} ans
  [ "$OPT_YES" = 1 ] && return 0
  if ! have_tty; then return 1; fi
  if [ "$def" = y ]; then read -r -p "$q [Y/n] " ans || ans=""; case "$ans" in n|N|no|NO) return 1 ;; *) return 0 ;; esac
  else read -r -p "$q [y/N] " ans || ans=""; case "$ans" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac; fi
}

# ask <varname> <prompt> [default]: leaves the variable untouched when it is already set.
ask() {
  local var=$1 prompt=$2 def=${3:-} cur ans
  cur=${!var:-}
  [ -z "$cur" ] || return 0
  if have_tty; then
    if [ -n "$def" ]; then read -r -p "$prompt [$def]: " ans || ans=""; else read -r -p "$prompt: " ans || ans=""; fi
    [ -n "$ans" ] || ans=$def
    printf -v "$var" '%s' "$ans"
  else
    printf -v "$var" '%s' "$def"
  fi
}

# ---------------------------------------------------------------------------------------------------------------------
# State (install.conf)
# ---------------------------------------------------------------------------------------------------------------------

conf_file() { printf '%s/install.conf' "$OPT_DIR"; }
conf_get() { env_get "$(conf_file)" "$1"; }

render_conf() {
  cat <<EOF
DOMAIN=${CONF_DOMAIN}
EMAIL=${CONF_EMAIL}
MULTI_BASE=${CONF_MULTI}
PROXY=${CONF_PROXY}
CERT_NAME=${CONF_CERT_NAME}
DNS_MODE=${CONF_DNS_MODE}
DNS_PROVIDER=${CONF_DNS_PROVIDER}
PORT=${OPT_PORT}
VERSION=${CONF_VERSION}
EOF
}

# dc <docker compose args...>: run in the installation folder.
dc() { docker compose --project-directory "$OPT_DIR" -f "$OPT_DIR/docker-compose.yml" "$@"; }
run_dc() { run docker compose --project-directory "$OPT_DIR" -f "$OPT_DIR/docker-compose.yml" "$@"; }

# ---------------------------------------------------------------------------------------------------------------------
# Install steps
# ---------------------------------------------------------------------------------------------------------------------

apt_install() {
  is_dry || export DEBIAN_FRONTEND=noninteractive
  run apt-get install -y --no-install-recommends "$@"
}

ensure_base_packages() {
  local missing=() c
  for c in curl openssl tar gzip; do command -v "$c" >/dev/null 2>&1 || missing+=("$c"); done
  [ -e /etc/cron.d ] || missing+=(cron)
  if [ "${#missing[@]}" -gt 0 ] || is_dry; then
    run apt-get update -qq
    apt_install ca-certificates "${missing[@]}"
  fi
}

collect_inputs() {
  local saved
  saved=$(conf_get DOMAIN); [ -n "$OPT_DOMAIN" ] || OPT_DOMAIN=$saved
  saved=$(conf_get EMAIL); [ -n "$OPT_EMAIL" ] || OPT_EMAIL=$saved
  saved=$(conf_get MULTI_BASE); [ -n "$OPT_MULTI" ] || OPT_MULTI=$saved
  saved=$(conf_get DNS_PROVIDER)
  if [ -z "$OPT_DNS_PROVIDER" ] && [ "$OPT_MANUAL_DNS" = 0 ] && [ -n "$saved" ] && [ "$saved" != manual ]; then OPT_DNS_PROVIDER=$saved; fi
  if [ -z "$OPT_DOMAIN" ] && ! have_tty; then die "Missing --domain (the host name of your shop, for example shop.example.com)."; fi
  ask OPT_DOMAIN "Domain name of your shop (for example shop.example.com)"
  OPT_DOMAIN=$(lower "$OPT_DOMAIN")
  valid_hostname "$OPT_DOMAIN" || die "'$OPT_DOMAIN' is not a valid host name. Use something like shop.example.com (no http://, no path, no wildcard)."
  if [ "$OPT_NO_PROXY" = 0 ]; then
    if [ -z "$OPT_EMAIL" ] && ! have_tty; then die "Missing --email (used by Let's Encrypt for expiry notices)."; fi
    ask OPT_EMAIL "E-mail address for certificate notices"
    valid_email "$OPT_EMAIL" || die "'$OPT_EMAIL' is not a valid e-mail address."
  else
    OPT_EMAIL=${OPT_EMAIL:-admin@$OPT_DOMAIN}
  fi
  if [ -n "$OPT_MULTI" ]; then
    OPT_MULTI=$(lower "$OPT_MULTI")
    valid_hostname "$OPT_MULTI" || die "'$OPT_MULTI' is not a valid base domain for --multi-store (example: shops.example.com)."
    [ "$OPT_MULTI" != "$OPT_DOMAIN" ] || die "The admin host (--domain) must differ from the stores' base domain (--multi-store)."
  fi
  valid_port "$OPT_PORT" || die "Invalid --port '$OPT_PORT' (1024-65535)."
  if [ -n "$OPT_DNS_PROVIDER" ]; then
    valid_dns_provider "$OPT_DNS_PROVIDER" || die "Unknown --dns-provider '$OPT_DNS_PROVIDER'. Use cloudflare, ovh, gandi, digitalocean or route53."
  fi
  if [ -n "$OPT_DNS_PROVIDER" ] && [ "$OPT_MANUAL_DNS" = 1 ]; then die "Use either --dns-provider or --manual-dns, not both."; fi
  if [ -n "$OPT_BUNDLE" ] && [ -n "$OPT_VERSION" ]; then die "Use either --bundle or --version, not both."; fi
  if [ -n "$OPT_VERSION" ]; then valid_version "$OPT_VERSION" || die "Invalid --version '$OPT_VERSION' (expected x.y.z)."; fi
  if [ -n "$OPT_SHA256" ]; then valid_sha256 "$OPT_SHA256" || die "--sha256 must be 64 hexadecimal characters."; fi
  safe_path "$OPT_DIR" || die "Invalid --dir '$OPT_DIR'."
  if [ -n "$OPT_DNS_CREDENTIALS" ]; then
    safe_path "$OPT_DNS_CREDENTIALS" || die "Invalid --dns-credentials path (letters, digits and . _ / - only)."
  fi
  return 0
}

# Wildcard certificate method for multi-store behind nginx.
collect_wildcard_method() {
  [ -n "$OPT_MULTI" ] || return 0
  [ -z "$OPT_DNS_PROVIDER" ] && [ "$OPT_MANUAL_DNS" = 0 ] || return 0
  if have_tty; then
    info "A wildcard certificate (*.$OPT_MULTI) can only be validated through DNS."
    ask OPT_DNS_PROVIDER "DNS provider (cloudflare, ovh, gandi, digitalocean, route53) or 'manual'" manual
    if [ "$OPT_DNS_PROVIDER" = manual ]; then OPT_DNS_PROVIDER=""; OPT_MANUAL_DNS=1; fi
    valid_dns_provider "$OPT_DNS_PROVIDER" || [ "$OPT_MANUAL_DNS" = 1 ] || die "Unknown DNS provider."
    if [ -n "$OPT_DNS_PROVIDER" ] && [ -z "$OPT_DNS_CREDENTIALS" ]; then
      ask OPT_DNS_CREDENTIALS "Path of the API credentials file (chmod 600)"
      safe_path "$OPT_DNS_CREDENTIALS" || die "Invalid credentials path."
    fi
  else
    die "Multi-store behind nginx needs a wildcard certificate: pass --dns-provider <name> --dns-credentials <file>, or --manual-dns."
  fi
}

check_dns_for_install() {
  local pub4 pub6 st hosts=("$OPT_DOMAIN") h bad=0
  pub4=$(public_ip 4); pub6=$(public_ip 6)
  [ -n "$pub4" ] || warn "Could not detect this server's public IPv4 address; the DNS check is skipped."
  [ -n "$OPT_MULTI" ] && hosts+=("shopme-dns-check.$OPT_MULTI")
  PUBLIC_IPV4=$pub4
  [ -n "$pub4" ] || return 0
  local waited=0
  while :; do
    bad=0
    for h in "${hosts[@]}"; do
      st=$(dns_status "$h" "$pub4" "$pub6")
      case "$st" in
        ok) info "DNS ok: $h points to this server ($pub4)." ;;
        missing) bad=1; warn "DNS: $h has no A/AAAA record. Create an A record to $pub4 at your domain provider." ;;
        mismatch:*) bad=1; warn "DNS: $h points to ${st#mismatch:}, not to this server ($pub4). Fix the A/AAAA record (remove an AAAA that is not this server)." ;;
      esac
    done
    [ "$bad" = 0 ] && return 0
    if [ "$OPT_FORCE" = 1 ]; then warn "Continuing anyway (--force). HTTPS will fail until DNS is right."; return 0; fi
    if is_dry; then warn "Dry run: would wait for DNS (up to ${SHOPME_DNS_WAIT_SECONDS}s) unless --force."; return 0; fi
    if have_tty; then
      local ans
      read -r -p "Press Enter to check again, type 'continue' to go on anyway, or 'abort': " ans || ans=abort
      case "$ans" in continue) return 0 ;; abort) die "Aborted: DNS does not point here yet." ;; esac
    else
      [ "$waited" -lt "$SHOPME_DNS_WAIT_SECONDS" ] || die "DNS still does not point to this server after ${SHOPME_DNS_WAIT_SECONDS}s. Fix the records, or re-run with --force."
      info "Waiting 15 s for DNS..."; sleep 15; waited=$((waited + 15))
    fi
  done
}

maybe_add_swap() {
  local swap
  swap=$(swap_total_mb)
  [ "$swap" -eq 0 ] || return 0
  if [ "$OPT_ADD_SWAP" = 1 ] || confirm "This server has no swap. Add $((SHOPME_SWAP_MB / 1024)) GB of swap to avoid out-of-memory kills?" y; then
    if [ -e /swapfile ] && ! is_dry; then warn "/swapfile already exists; not touching it."; return 0; fi
    step "Adding swap"
    run fallocate -l "${SHOPME_SWAP_MB}M" /swapfile
    run chmod 600 /swapfile
    run mkswap /swapfile
    run swapon /swapfile
    if is_dry || ! grep -q '^/swapfile ' /etc/fstab; then
      if is_dry; then printf '+ append "/swapfile none swap sw 0 0" to /etc/fstab\n'; else printf '/swapfile none swap sw 0 0\n' >>/etc/fstab; fi
    fi
  else
    info "Continuing without swap."
  fi
}

ensure_docker() {
  if [ "${SHOPME_OVERRIDE_DOCKER:-}" != missing ] && command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then return 0; fi
  if is_dry; then
    printf '+ confirm: install Docker with the official script from https://get.docker.com\n'
    run curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    run sh /tmp/get-docker.sh
    return 0
  fi
  info "Docker (with the compose plugin) is not installed."
  confirm "Install it with Docker's official installer (https://get.docker.com)?" y || die "Docker is required (re-run with --yes to let this script install it). Install it (https://docs.docker.com/engine/install/) and run this again."
  local tmp
  tmp=$(mktemp)
  curl -fsSL https://get.docker.com -o "$tmp" || die "Could not download Docker's installer."
  sh "$tmp" || die "Docker's installer failed."
  rm -f "$tmp"
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker compose version >/dev/null 2>&1 || die "Docker is installed but the compose plugin is missing. Install docker-compose-plugin."
}

nginx_site_path() {
  if [ -d "$SHOPME_NGINX_DIR/sites-available" ]; then printf '%s/sites-available/%s.conf' "$SHOPME_NGINX_DIR" "$1"
  else printf '%s/conf.d/%s.conf' "$SHOPME_NGINX_DIR" "$1"; fi
}

nginx_enable_site() {
  local name=$1
  if [ -d "$SHOPME_NGINX_DIR/sites-available" ]; then
    run ln -sf "$SHOPME_NGINX_DIR/sites-available/$name.conf" "$SHOPME_NGINX_DIR/sites-enabled/$name.conf"
  fi
}

# Refuse to overwrite a file we do not manage, and to take over a name another site already serves.
nginx_guard() {
  local path=$1 names=$2 n f esc
  if [ -f "$path" ] && ! grep -q 'Managed by shopme-install.sh' "$path"; then
    die "$path exists and is not managed by this installer. Move it away or choose another --domain."
  fi
  [ "$OPT_FORCE" = 0 ] || return 0
  is_dry && return 0
  for n in $names; do
    esc=${n//./\\.}
    for f in "$SHOPME_NGINX_DIR"/sites-enabled/* "$SHOPME_NGINX_DIR"/conf.d/*.conf; do
      [ -f "$f" ] || continue
      case "$f" in */shopme*.conf) continue ;; esac
      if grep -Eq "^[[:space:]]*server_name[^;]*[[:space:]]${esc}[[:space:];]" "$f"; then
        die "Another nginx site ($f) already serves $n. Nothing was changed. Use --force to add ours anyway."
      fi
    done
  done
}

nginx_test_reload() {
  if is_dry; then run nginx -t; run systemctl reload nginx; return 0; fi
  nginx -t || die "nginx -t failed: the new site file was left in place for you to inspect; nothing was reloaded. Remove it with: shopme-install.sh uninstall"
  systemctl reload nginx || die "nginx reload failed."
}

ensure_certbot() {
  command -v certbot >/dev/null 2>&1 && ! is_dry && return 0
  run apt-get update -qq
  apt_install certbot python3-certbot-nginx
}

# Copies the user's DNS credentials to a root-only file (content never shown).
install_dns_credentials() {
  CERT_CRED_FILE=""
  [ -n "$OPT_DNS_PROVIDER" ] || return 0
  local src=$OPT_DNS_CREDENTIALS dst="$SHOPME_DNS_CRED_DIR/dns-$OPT_DNS_PROVIDER.ini" pkgs
  [ -n "$src" ] || die "--dns-provider $OPT_DNS_PROVIDER needs --dns-credentials <file> (API credentials, chmod 600)."
  if ! is_dry; then
    [ -f "$src" ] || die "Credentials file '$src' not found."
    [ -r "$src" ] || die "Credentials file '$src' is not readable."
    local perms
    perms=$(stat -c '%a' "$src")
    case "$perms" in *00) ;; *) warn "'$src' is readable by other users (mode $perms). A root-only copy is used; delete or chmod 600 the original." ;; esac
  fi
  run install -d -m 700 "$SHOPME_DNS_CRED_DIR"
  if is_dry; then printf '+ copy %s to %s (mode 600, content not shown)\n' "$src" "$dst"
  else (umask 077 && cp "$src" "$dst" && chmod 600 "$dst"); fi
  CERT_CRED_FILE=$dst
  pkgs=$(certbot_dns_packages "$OPT_DNS_PROVIDER")
  if [ -n "$pkgs" ]; then apt_install "$pkgs"
  else
    apt_install python3-pip
    run pip3 install --break-system-packages certbot-plugin-gandi
  fi
}

# issue_wildcard_cert: certbot certonly with a DNS plugin, or the manual flow.
issue_wildcard_cert() {
  local names=(-d "$OPT_MULTI" -d "*.$OPT_MULTI") args=() a
  is_covered_by_wildcard "$OPT_DOMAIN" "$OPT_MULTI" || names+=(-d "$OPT_DOMAIN")
  local common=(certbot certonly --cert-name "$CONF_CERT_NAME" -m "$OPT_EMAIL" --agree-tos --no-eff-email --keep-until-expiring --deploy-hook "systemctl reload nginx")
  if [ -n "$OPT_DNS_PROVIDER" ]; then
    while IFS= read -r a; do args+=("$a"); done < <(certbot_dns_args "$OPT_DNS_PROVIDER" "$CERT_CRED_FILE")
    step "Wildcard certificate through $OPT_DNS_PROVIDER DNS (this can take a minute)"
    if [ "$OPT_DNS_PROVIDER" = route53 ] && [ -n "$OPT_DNS_CREDENTIALS" ]; then
      run env "AWS_SHARED_CREDENTIALS_FILE=$CERT_CRED_FILE" "${common[@]}" "${args[@]}" --non-interactive "${names[@]}"
    else
      run "${common[@]}" "${args[@]}" --non-interactive "${names[@]}"
    fi
  else
    step "Wildcard certificate with a manual DNS challenge"
    cat <<EOF
Certbot will now show one or two TXT records to create, step by step:
  1. At your DNS provider, add a TXT record named  _acme-challenge.$OPT_MULTI  with the value certbot prints.
  2. Wait one or two minutes for it to appear, then press Enter in this window.
  3. If certbot shows a second value for the same name, add it as an additional TXT record.
WARNING: Let's Encrypt certificates last 90 days and a manual challenge cannot renew itself.
Every ~60 days run:  sudo shopme-install.sh renew   (doctor warns you when the date approaches).
EOF
    if ! is_dry && ! have_tty; then die "--manual-dns needs an interactive terminal."; fi
    run "${common[@]}" --manual --preferred-challenges dns "${names[@]}"
  fi
}

setup_nginx() {
  local names site cert_dir
  names=$(nginx_server_names "$OPT_DOMAIN" "$OPT_MULTI")
  site=$(nginx_site_path shopme)
  nginx_guard "$site" "$names"
  ensure_certbot
  if [ -n "$OPT_MULTI" ]; then
    install_dns_credentials
    issue_wildcard_cert
    cert_dir="/etc/letsencrypt/live/$CONF_CERT_NAME"
    render_nginx_site tls "$names" "$OPT_PORT" "$cert_dir" | write_file "$site" 644 public
    nginx_enable_site shopme
    nginx_test_reload
  else
    cert_dir="/etc/letsencrypt/live/$OPT_DOMAIN"
    if [ -d "$cert_dir" ] && ! is_dry; then
      render_nginx_site tls "$names" "$OPT_PORT" "$cert_dir" | write_file "$site" 644 public
      nginx_enable_site shopme
      nginx_test_reload
    else
      render_nginx_site http "$names" "$OPT_PORT" | write_file "$site" 644 public
      nginx_enable_site shopme
      nginx_test_reload
      step "HTTPS certificate with certbot"
      run certbot --nginx -d "$OPT_DOMAIN" -m "$OPT_EMAIL" --agree-tos --no-eff-email --non-interactive --redirect
    fi
  fi
}

setup_caddy() {
  render_caddyfile "$OPT_DOMAIN" "$OPT_EMAIL" "$OPT_MULTI" | write_file "$OPT_DIR/Caddyfile" 644 public
}

write_installation_files() {
  local pg session
  run install -d -m 755 "$OPT_DIR"
  run install -d -m 700 "$OPT_DIR/backups"
  run install -d -m 755 -o 1000 -g 1000 "$OPT_DIR/data"
  pg=$(env_get "$OPT_DIR/.env" POSTGRES_PASSWORD); [ -n "$pg" ] || pg=$(gen_secret)
  session=$(env_get "$OPT_DIR/.env" SESSION_SECRET); [ -n "$session" ] || session=$(gen_secret)
  ENVV_DOMAIN=$OPT_DOMAIN ENVV_MULTI=$OPT_MULTI ENVV_PORT=$OPT_PORT ENVV_PUBLIC_IP=${PUBLIC_IPV4:-} \
    ENVV_PG_PASSWORD=$pg ENVV_SESSION_SECRET=$session ENVV_HTTPS=$([ "$OPT_NO_PROXY" = 1 ] && echo 0 || echo 1) \
    render_env | write_file "$OPT_DIR/.env" 600 secret
  unset pg session
  render_compose "$CONF_PROXY" | write_file "$OPT_DIR/docker-compose.yml" 644 public
  [ "$CONF_PROXY" != caddy ] || setup_caddy
}

# ---------------------------------------------------------------------------------------------------------------------
# Getting the app: bundle, release or source build
# ---------------------------------------------------------------------------------------------------------------------

download() {
  local url=$1 dest=$2
  case "$url" in https://*) ;; *) die "Only https:// URLs are accepted for downloads ($url)." ;; esac
  run curl -fL --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 15 -o "$dest" "$url"
}

verify_sha256() {
  local file=$1 want=$2 got
  if is_dry; then printf '+ verify sha256 of %s\n' "$file"; return 0; fi
  got=$(sha256sum "$file" | awk '{print $1}')
  [ "$(lower "$got")" = "$(lower "$want")" ] || die "Checksum mismatch for $file. Expected $want, got $got. The download is corrupt or not the release you asked for."
}

# fetch_bundle <stage-dir>: puts the bundle's app/ under <stage>/app.
fetch_bundle() {
  local stage=$1 src=$OPT_BUNDLE file url sidecar want=$OPT_SHA256 arch
  arch=$(detect_arch)
  if [ -z "$src" ] && [ -n "$OPT_VERSION" ]; then
    src=$(render_bundle_url "$SHOPME_BUNDLE_URL_TEMPLATE" "$OPT_VERSION" "$arch")
  fi
  case "$src" in
    http://*) die "Bundles must be downloaded over https." ;;
    https://*)
      file="$stage/bundle.tar.gz"
      step "Downloading $src"
      download "$src" "$file"
      if [ -z "$want" ] && [ -z "$OPT_BUNDLE" ]; then
        sidecar="$stage/bundle.sha256"
        if is_dry || curl -fsSL --proto '=https' -o "$sidecar" "$src.sha256" 2>/dev/null; then
          want=""
          is_dry || want=$(awk '{print $1}' "$sidecar")
        else
          warn "No checksum file published next to the bundle; integrity is not verified."
        fi
      fi ;;
    *)
      file=$src
      is_dry || [ -f "$file" ] || die "Bundle '$file' not found."
      safe_path "$file" || die "Invalid bundle path (letters, digits and . _ / - only)." ;;
  esac
  [ -z "$want" ] || verify_sha256 "$file" "$want"
  if is_dry; then
    printf '+ check that the archive only holds app/, templates/, README.md, VERSION\n'
  else
    tar -tzf "$file" | bundle_list_ok || die "The bundle contains unexpected or unsafe paths. Refusing to unpack it."
  fi
  run tar -xzf "$file" -C "$stage" --no-same-owner
  is_dry || [ -f "$stage/app/apps/server/dist/main.js" ] || die "The bundle has no app/apps/server/dist/main.js: it is not a ShopMe server bundle."
}

source_dir() {
  if [ -n "$OPT_SOURCE" ]; then printf '%s' "$OPT_SOURCE"; return; fi
  local here
  here=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd) || here=""
  printf '%s' "$here"
}

# preflight_source_build: a source checkout must exist and the server must have the RAM to build it.
preflight_source_build() {
  local src free
  src=$(source_dir)
  if [ -z "$src" ] || { [ ! -f "$src/Dockerfile" ] && ! is_dry; }; then
    die "No source checkout found next to this script and no --bundle given. Download a bundle (shopme-server-<version>.tar.gz) and use --bundle <path|url>, or run this script from a ShopMe checkout."
  fi
  free=$(mem_available_mb)
  if [ "$(decide_build "$free" "$SHOPME_MIN_BUILD_RAM_MB")" = refuse ]; then
    die "Building from source needs about $((SHOPME_MIN_BUILD_RAM_MB / 1024)) GB of free RAM and this server has only ${free} MB. Swap does not help a build. Use a prebuilt bundle instead: --bundle <path|url> (or --version <x.y.z>)."
  fi
}

# build_from_source <stage-dir>
build_from_source() {
  local stage=$1 src
  preflight_source_build
  src=$(source_dir)
  step "Building the image from source (this takes several minutes)"
  run docker build -t shopme:local "$src"
  if is_dry; then
    printf '+ docker create shopme:local, docker cp <container>:/app/. %s/app, docker rm <container>\n' "$stage"
  else
    local cid
    cid=$(docker create shopme:local)
    mkdir -p "$stage/app"
    docker cp "$cid:/app/." "$stage/app" || { docker rm "$cid" >/dev/null; die "Could not copy the built app out of the image."; }
    docker rm "$cid" >/dev/null
  fi
}

# acquire_app <stage-dir>: bundle, release or source.
acquire_app() {
  local stage=$1
  if [ -n "$OPT_BUNDLE" ] || [ -n "$OPT_VERSION" ]; then fetch_bundle "$stage"; else build_from_source "$stage"; fi
  CONF_VERSION=unknown
  if [ -f "$stage/VERSION" ]; then CONF_VERSION=$(head -n1 "$stage/VERSION" | tr -cd '0-9A-Za-z._-'); elif [ -n "$OPT_VERSION" ]; then CONF_VERSION=$OPT_VERSION; elif is_dry; then CONF_VERSION=dry-run; else CONF_VERSION=source; fi
}

new_stage() {
  if is_dry; then printf '%s/.stage-dry' "$OPT_DIR"; return; fi
  mkdir -p "$OPT_DIR" && mktemp -d "$OPT_DIR/.stage-XXXXXX"
}

# ---------------------------------------------------------------------------------------------------------------------
# Health, backups
# ---------------------------------------------------------------------------------------------------------------------

probe_health() {
  if is_dry; then [ "${SHOPME_OVERRIDE_HEALTH:-ok}" = ok ]; return; fi
  curl -fsS --max-time 5 "http://127.0.0.1:${OPT_PORT}/healthz"
}

# wait_healthy: prints progress, returns 0 when /healthz answers.
wait_healthy() {
  info "Waiting for the app to answer on /healthz..."
  if is_dry; then
    printf '+ wait for http://127.0.0.1:%s/healthz (up to %ss)\n' "$OPT_PORT" "$((SHOPME_HEALTH_TRIES * SHOPME_HEALTH_INTERVAL))"
    probe_health
    return
  fi
  health_wait "$SHOPME_HEALTH_TRIES" "$SHOPME_HEALTH_INTERVAL" probe_health
}

timestamp() { date +%Y%m%d-%H%M%S; }

backup_db() {
  local out
  out="$OPT_DIR/backups/db-$(timestamp).sql.gz"
  if is_dry; then
    printf '+ docker compose exec -T db pg_dump -U shopme shopme | gzip > %s\n' "$out"
    printf '+ find %s/backups -name "db-*.sql.gz" -mtime +%s -delete\n' "$OPT_DIR" "$SHOPME_BACKUP_KEEP_DAYS"
    LAST_DB_BACKUP=$out
    return 0
  fi
  (
    umask 077
    dc exec -T db pg_dump -U shopme --no-owner shopme | gzip >"$out.part"
  ) || { rm -f "$out.part"; die "Database backup failed. Is the stack running? (shopme-install.sh doctor)"; }
  mv "$out.part" "$out"
  find "$OPT_DIR/backups" -maxdepth 1 -name 'db-*.sql.gz' -mtime "+$SHOPME_BACKUP_KEEP_DAYS" -delete
  LAST_DB_BACKUP=$out
  info "Database saved: $out"
}

backup_uploads() {
  local out
  out="$OPT_DIR/backups/uploads-$(timestamp).tar.gz"
  if is_dry; then
    printf '+ tar -czf %s -C %s data\n' "$out" "$OPT_DIR"
    printf '+ keep the 5 most recent uploads-*.tar.gz\n'
    return 0
  fi
  [ -d "$OPT_DIR/data" ] || return 0
  (umask 077 && tar -czf "$out" -C "$OPT_DIR" data) || die "Files backup failed."
  # shellcheck disable=SC2012
  { ls -1t "$OPT_DIR"/backups/uploads-*.tar.gz 2>/dev/null || true; } | tail -n +6 | while IFS= read -r old; do rm -f "$old"; done
  info "Files saved: $out"
}

render_cron() {
  cat <<EOF
# ShopMe backups (managed by shopme-install.sh). Database every night, uploaded files every Sunday.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 3 * * * root $SHOPME_INSTALL_BIN backup --db-only --quiet --dir $OPT_DIR
50 3 * * 0 root $SHOPME_INSTALL_BIN backup --uploads-only --quiet --dir $OPT_DIR
EOF
}

setup_backup_cron() {
  render_cron | write_file "$SHOPME_CRON_FILE" 644 public
}

install_self() {
  local self=${BASH_SOURCE[0]}
  if is_dry; then printf '+ install -m 755 %s %s\n' "$(basename "$self")" "$SHOPME_INSTALL_BIN"; return 0; fi
  if [ -f "$self" ] && [ "$(readlink -f "$self")" != "$(readlink -f "$SHOPME_INSTALL_BIN")" ]; then
    install -m 755 "$self" "$SHOPME_INSTALL_BIN"
  elif [ ! -x "$SHOPME_INSTALL_BIN" ]; then
    warn "The script was piped in and could not be copied to $SHOPME_INSTALL_BIN; the backup cron job needs that copy. Save the script to a file and re-run install."
  fi
}

# ---------------------------------------------------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------------------------------------------------

require_installed() {
  is_dry && return 0
  safe_path "$OPT_DIR" || die "Invalid --dir '$OPT_DIR'."
  if [ ! -f "$OPT_DIR/docker-compose.yml" ] || [ ! -f "$(conf_file)" ]; then
    die "No ShopMe installation found in $OPT_DIR. Run: shopme-install.sh install"
  fi
}

load_conf() {
  CONF_DOMAIN=$(conf_get DOMAIN); CONF_EMAIL=$(conf_get EMAIL); CONF_MULTI=$(conf_get MULTI_BASE)
  CONF_PROXY=$(conf_get PROXY); CONF_CERT_NAME=$(conf_get CERT_NAME); CONF_DNS_MODE=$(conf_get DNS_MODE)
  CONF_DNS_PROVIDER=$(conf_get DNS_PROVIDER); CONF_VERSION=$(conf_get VERSION)
  local p; p=$(conf_get PORT); [ -z "$p" ] || OPT_PORT=$p
  if is_dry; then
    [ -n "$CONF_DOMAIN" ] || CONF_DOMAIN=${OPT_DOMAIN:-shop.example.com}
    [ -n "$CONF_PROXY" ] || CONF_PROXY=${SHOPME_OVERRIDE_PROXY:-nginx}
  fi
  return 0
}

cmd_install() {
  preflight_platform
  collect_inputs
  CONF_DOMAIN=$OPT_DOMAIN; CONF_EMAIL=$OPT_EMAIL; CONF_MULTI=$OPT_MULTI
  CONF_DNS_PROVIDER=${OPT_DNS_PROVIDER}; CONF_DNS_MODE=none
  CONF_CERT_NAME=$OPT_DOMAIN

  step "Checking this server"
  local ws
  ws=$(detect_webserver)
  case "$ws" in
    other:*) if [ "$OPT_NO_PROXY" = 0 ]; then die "Another web server (${ws#other:}) already uses port 80/443. Nothing was changed. ShopMe can share the server with nginx only: either switch that server to nginx, or install with --no-proxy and point your proxy to 127.0.0.1:$OPT_PORT."; fi ;;
  esac
  if [ "$OPT_NO_PROXY" = 1 ]; then CONF_PROXY=none
  elif [ "$ws" = nginx ]; then CONF_PROXY=nginx
  else CONF_PROXY=caddy; fi
  info "Domain: $OPT_DOMAIN${OPT_MULTI:+  (multi-store, stores on *.$OPT_MULTI)}"
  case "$CONF_PROXY" in
    nginx) info "HTTPS: through the existing nginx and certbot." ;;
    caddy) info "HTTPS: through Caddy (automatic certificates, in the compose stack)." ;;
    *) info "HTTPS: not configured (--no-proxy)." ;;
  esac

  if [ "$CONF_PROXY" = nginx ] && [ -n "$OPT_MULTI" ]; then
    collect_wildcard_method
    CONF_CERT_NAME=$OPT_MULTI
    if [ -n "$OPT_DNS_PROVIDER" ]; then CONF_DNS_MODE=provider; CONF_DNS_PROVIDER=$OPT_DNS_PROVIDER; else CONF_DNS_MODE=manual; CONF_DNS_PROVIDER=manual; fi
  fi
  if [ "$CONF_PROXY" = caddy ] && [ "$(command -v nginx || true)" != "" ] && ! is_dry; then
    warn "nginx is installed but not running. Caddy will take ports 80/443; run 'systemctl disable nginx' so it does not start at boot and conflict."
  fi
  if [ "$CONF_PROXY" != none ]; then check_dns_for_install; fi
  if [ -z "$OPT_BUNDLE" ] && [ -z "$OPT_VERSION" ] && [ ! -f "$OPT_DIR/app/apps/server/dist/main.js" ]; then
    preflight_source_build
  fi

  step "Preparing the system"
  ensure_base_packages
  maybe_add_swap
  ensure_docker

  step "Creating $OPT_DIR"
  local stage
  stage=$(new_stage)
  if [ -f "$OPT_DIR/app/apps/server/dist/main.js" ] && [ -z "$OPT_BUNDLE" ] && [ -z "$OPT_VERSION" ]; then
    info "An app is already in $OPT_DIR/app; keeping it (use 'update' to change the version)."
    CONF_VERSION=$(conf_get VERSION)
  else
    acquire_app "$stage"
  fi
  write_installation_files
  if [ -d "$stage/app" ] || is_dry; then
    run rm -rf "$OPT_DIR/app.prev"
    [ -d "$OPT_DIR/app" ] && ! is_dry && mv "$OPT_DIR/app" "$OPT_DIR/app.prev"
    run mv "$stage/app" "$OPT_DIR/app"
  fi
  render_conf | write_file "$(conf_file)" 600 public
  run rm -rf "$stage"

  step "Starting ShopMe"
  run_dc pull --quiet
  run_dc up -d
  if ! wait_healthy; then
    is_dry || { dc logs --tail 40 shopme 2>&1 | sed 's/^/    /' >&2; }
    die "ShopMe did not become healthy. Check the log above, then run: shopme-install.sh doctor"
  fi

  case "$CONF_PROXY" in
    nginx) step "Configuring nginx and HTTPS"; setup_nginx ;;
    caddy) step "HTTPS through Caddy"; info "Caddy asks Let's Encrypt for the certificate when the first visitor arrives; this takes about a minute." ;;
    none) info "No reverse proxy configured: the app listens on 127.0.0.1:$OPT_PORT." ;;
  esac

  step "Backups"
  install_self
  setup_backup_cron
  info "Database dump every night at 03:30 (kept $SHOPME_BACKUP_KEEP_DAYS days), uploaded files every Sunday. Folder: $OPT_DIR/backups"

  print_next_steps
}

print_next_steps() {
  local url="https://$OPT_DOMAIN/admin"
  [ "$CONF_PROXY" != none ] || url="http://127.0.0.1:$OPT_PORT/admin"
  cat <<EOF

ShopMe is installed.

  Admin:  $url

Next steps
  1. Open the admin address now and finish the setup wizard. The first visitor creates the owner account,
     so do it right away.
  2. Open Settings > E-mails and add the 3 DNS lines it shows (SPF, DKIM, DMARC) at your domain provider.
     Without them, order and password e-mails may land in spam.
  3. Check the server any time:  sudo shopme-install.sh doctor
EOF
  if [ -n "$OPT_MULTI" ]; then
    cat <<EOF
  4. Stores answer on <handle>.$OPT_MULTI (wildcard DNS: create an A record for *.$OPT_MULTI to this server).
     A store's own domain: add it in Settings > Domains, then run:  sudo shopme-install.sh add-domain <host>
EOF
  fi
}

cmd_update() {
  preflight_platform
  require_installed
  safe_path "$OPT_DIR" || die "Invalid --dir."
  load_conf
  [ -z "$OPT_BUNDLE" ] || [ -z "$OPT_VERSION" ] || die "Use either --bundle or --version, not both."
  [ -z "$OPT_VERSION" ] || valid_version "$OPT_VERSION" || die "Invalid --version."
  [ -z "$OPT_SHA256" ] || valid_sha256 "$OPT_SHA256" || die "--sha256 must be 64 hexadecimal characters."

  step "Backing up before the update"
  backup_db
  backup_uploads

  step "Getting the new version"
  local stage
  stage=$(new_stage)
  acquire_app "$stage"

  step "Replacing the app"
  run rm -rf "$OPT_DIR/app.prev"
  run mv "$OPT_DIR/app" "$OPT_DIR/app.prev"
  run mv "$stage/app" "$OPT_DIR/app"
  run rm -rf "$stage"
  run_dc up -d --force-recreate --no-deps shopme

  local healthy=unhealthy
  wait_healthy && healthy=healthy
  if [ "$(decide_after_health "$healthy")" = keep ]; then
    CONF_VERSION=${CONF_VERSION:-unknown}
    render_conf | write_file "$(conf_file)" 600 public
    info "Updated to $CONF_VERSION. The previous app is kept in $OPT_DIR/app.prev until the next update."
    return 0
  fi

  warn "The new version did not become healthy. Rolling back to the previous app."
  is_dry || { dc logs --tail 30 shopme 2>&1 | sed 's/^/    /' >&2; }
  run rm -rf "$OPT_DIR/app.failed"
  run mv "$OPT_DIR/app" "$OPT_DIR/app.failed"
  run mv "$OPT_DIR/app.prev" "$OPT_DIR/app"
  run_dc up -d --force-recreate --no-deps shopme
  SHOPME_OVERRIDE_HEALTH=${SHOPME_OVERRIDE_HEALTH_AFTER_ROLLBACK:-ok}
  if wait_healthy; then
    warn "Rolled back: the previous version is running again. The failed app is in $OPT_DIR/app.failed."
  else
    warn "The previous version is not healthy either. Run: shopme-install.sh doctor"
  fi
  warn "If the new version changed the database, restore the backup taken before the update: shopme-install.sh restore ${LAST_DB_BACKUP:-<file>}"
  return 1
}

cmd_backup() {
  require_installed
  load_conf
  if [ "$OPT_UPLOADS_ONLY" = 0 ]; then backup_db; fi
  if [ "$OPT_DB_ONLY" = 0 ]; then backup_uploads; fi
  return 0
}

cmd_restore() {
  preflight_platform
  require_installed
  load_conf
  local file=${POSITIONAL[0]:-}
  [ -n "$file" ] || die "Usage: shopme-install.sh restore <backup file>"
  safe_path "$file" || die "Invalid file path (letters, digits and . _ / - only; give an absolute path)."
  is_dry || [ -f "$file" ] || die "Backup '$file' not found."
  local kind
  case "$(basename "$file")" in
    db-*.sql.gz) kind=db ;;
    uploads-*.tar.gz) kind=files ;;
    *) die "Unknown backup type. Expected db-*.sql.gz or uploads-*.tar.gz." ;;
  esac
  local label="database"
  [ "$kind" = db ] || label="uploaded files"
  confirm "Restore $(basename "$file")? This replaces the current $label. A safety backup is taken first." n || die "Not confirmed (use --yes to skip the question)."
  step "Safety backup"
  if [ "$kind" = db ]; then backup_db; else backup_uploads; fi
  if [ "$kind" = db ]; then
    run_dc stop shopme
    run_dc exec -T db psql -U shopme -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS shopme WITH (FORCE)" -c "CREATE DATABASE shopme OWNER shopme"
    if is_dry; then printf '+ gunzip -c %s | docker compose exec -T db psql -U shopme -d shopme -v ON_ERROR_STOP=1\n' "$file"
    else gunzip -c "$file" | dc exec -T db psql -U shopme -d shopme -v ON_ERROR_STOP=1 -q >/dev/null || die "Restore failed. The safety backup is $LAST_DB_BACKUP."; fi
    run_dc start shopme
  else
    run_dc stop shopme
    run mv "$OPT_DIR/data" "$OPT_DIR/data.before-restore-$(timestamp)"
    run tar -xzf "$file" -C "$OPT_DIR"
    run chown -R 1000:1000 "$OPT_DIR/data"
    run_dc start shopme
  fi
  wait_healthy || die "Restored, but the app is not healthy. Run: shopme-install.sh doctor"
  info "Restore done."
}

# ---- doctor / status ------------------------------------------------------------------------------------------------

container_state() {
  local svc=$1 cid
  cid=$(dc ps -q "$svc" 2>/dev/null | head -n1)
  [ -n "$cid" ] || { echo "absent"; return; }
  docker inspect -f '{{.State.Status}}{{if .State.Health}} {{.State.Health.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown
}

check_containers() {
  command -v docker >/dev/null 2>&1 || { add_check FAIL docker "Docker is not installed." "Run: shopme-install.sh install"; return; }
  docker info >/dev/null 2>&1 || { add_check FAIL docker "The Docker service is not running." "Run: systemctl start docker"; return; }
  local svc st services=(shopme db)
  [ "$CONF_PROXY" != caddy ] || services+=(caddy)
  for svc in "${services[@]}"; do
    st=$(container_state "$svc")
    case "$st" in
      "running healthy"|"running") add_check OK "container-$svc" "Container $svc is running${st#running}." ;;
      "running starting") add_check WARN "container-$svc" "Container $svc is still starting." "Wait a minute and run doctor again." ;;
      absent) add_check FAIL "container-$svc" "Container $svc does not exist." "Run: cd $OPT_DIR && docker compose up -d" ;;
      *) add_check FAIL "container-$svc" "Container $svc is $st." "See the log: docker compose -f $OPT_DIR/docker-compose.yml logs --tail 50 $svc" ;;
    esac
  done
  if probe_health >/dev/null 2>&1; then add_check OK health "The app answers on /healthz."
  else add_check FAIL health "The app does not answer on http://127.0.0.1:$OPT_PORT/healthz." "Look at the log: docker compose -f $OPT_DIR/docker-compose.yml logs --tail 50 shopme"; fi
}

check_resources() {
  local avail_mb free_ram swap total
  avail_mb=$(df -Pm "$OPT_DIR" 2>/dev/null | awk 'NR==2 {print $4}')
  avail_mb=${avail_mb:-0}
  if [ "$avail_mb" -lt 500 ]; then add_check FAIL disk "Only ${avail_mb} MB of disk left." "Free space: delete old files in $OPT_DIR/backups, run 'docker system prune', or enlarge the disk."
  elif [ "$avail_mb" -lt 2048 ]; then add_check WARN disk "${avail_mb} MB of disk left." "Free some space before it runs out (old backups, 'docker system prune')."
  else add_check OK disk "Disk: $((avail_mb / 1024)) GB free."; fi
  free_ram=$(mem_available_mb); total=$(mem_total_mb); swap=$(swap_total_mb)
  if [ "$free_ram" -lt 150 ]; then add_check FAIL ram "Memory: only ${free_ram} MB available of ${total} MB." "Add swap (shopme-install.sh install --add-swap) or a bigger server."
  elif [ "$free_ram" -lt 300 ]; then add_check WARN ram "Memory: ${free_ram} MB available of ${total} MB." "Close other services or choose a bigger server."
  else add_check OK ram "Memory: ${free_ram} MB available of ${total} MB."; fi
  if [ "$swap" -eq 0 ]; then
    if [ "$total" -lt 2048 ]; then add_check WARN swap "No swap on a small server." "Add 2 GB: shopme-install.sh install --add-swap (safe to re-run)."
    else add_check OK swap "No swap (enough memory)."; fi
  else add_check OK swap "Swap: ${swap} MB."; fi
}

cert_end_date() {
  if [ -n "${SHOPME_OVERRIDE_CERT_END:-}" ]; then echo "$SHOPME_OVERRIDE_CERT_END"; return; fi
  local host=$1 out
  out=$(echo | timeout 8 openssl s_client -connect "127.0.0.1:443" -servername "$host" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null || true)
  echo "${out#notAfter=}"
}

check_cert() {
  [ "$CONF_PROXY" != none ] || return 0
  local end days
  end=$(cert_end_date "$CONF_DOMAIN")
  if [ -z "$end" ]; then add_check FAIL certificate "No HTTPS certificate is served for $CONF_DOMAIN." "Check DNS, ports 80/443 and the proxy; for nginx run: certbot --nginx -d $CONF_DOMAIN. For Caddy: docker compose logs caddy."; return; fi
  days=$(days_until "$end") || { add_check WARN certificate "Could not read the certificate date ($end)."; return; }
  local fix="Run: shopme-install.sh renew (certbot renews by itself every day; check 'systemctl list-timers | grep certbot')."
  [ "$CONF_DNS_MODE" != manual ] || fix="Manual DNS certificate: run 'sudo shopme-install.sh renew' and add the TXT record again."
  if [ "$days" -lt 3 ]; then add_check FAIL certificate "The certificate expires in $days day(s)." "$fix"
  elif [ "$days" -lt 14 ]; then add_check WARN certificate "The certificate expires in $days days." "$fix"
  else add_check OK certificate "Certificate valid for $days more days."; fi
}

check_dns() {
  local pub4 pub6 st h hosts=("$CONF_DOMAIN")
  pub4=$(public_ip 4); pub6=$(public_ip 6)
  if [ -z "$pub4" ]; then add_check WARN public-ip "Could not detect the server's public IP address." "Check that the server can reach the Internet (curl https://api.ipify.org)."; else add_check OK public-ip "Public IP: $pub4${pub6:+ / $pub6}."; fi
  [ -z "$CONF_MULTI" ] || hosts+=("shopme-dns-check.$CONF_MULTI")
  [ -n "$pub4" ] || return 0
  for h in "${hosts[@]}"; do
    st=$(dns_status "$h" "$pub4" "$pub6")
    case "$st" in
      ok) add_check OK "dns-$h" "DNS: $h points to this server." ;;
      missing) add_check FAIL "dns-$h" "DNS: $h has no A/AAAA record." "At your domain provider, create an A record for ${h/shopme-dns-check/*} pointing to $pub4." ;;
      mismatch:*) add_check FAIL "dns-$h" "DNS: $h points to ${st#mismatch:}, not to this server ($pub4)." "Edit the A record to $pub4 and remove any AAAA record that is not this server." ;;
    esac
  done
}

can_connect() { timeout "${3:-5}" bash -c "exec 3<>/dev/tcp/$1/$2" 2>/dev/null; }

check_mail() {
  local ok=0 h
  if [ -n "${SHOPME_OVERRIDE_PORT25+set}" ]; then [ "$SHOPME_OVERRIDE_PORT25" = open ] && ok=1
  else
    for h in gmail-smtp-in.l.google.com outlook-com.olc.protection.outlook.com; do can_connect "$h" 25 && { ok=1; break; }; done
  fi
  if [ "$ok" = 1 ]; then add_check OK port25 "Outgoing port 25 is open (e-mail can leave this server directly)."
  else add_check WARN port25 "Outgoing port 25 is blocked." "Ask your hosting provider to open it, or use an SMTP relay in Settings > E-mails > Advanced options."; fi
  local pub4 ptr back
  pub4=$(public_ip 4)
  [ -n "$pub4" ] || return 0
  if [ -n "${SHOPME_OVERRIDE_PTR+set}" ]; then ptr=$SHOPME_OVERRIDE_PTR; else ptr=$(getent hosts "$pub4" 2>/dev/null | awk '{print $2}' | head -n1); fi
  if [ -z "$ptr" ]; then add_check WARN ptr "No reverse DNS (PTR) for $pub4." "In your hosting provider's panel set the reverse DNS of $pub4 to a name you own, such as mail.$CONF_DOMAIN (and point that name to $pub4)."
  else
    back=$(resolve_ips "$ptr" 4 | tr '\n' ' ')
    case " $back" in
      *" $pub4 "*) add_check OK ptr "Reverse DNS: $pub4 is $ptr, and it resolves back to the same address." ;;
      *) add_check WARN ptr "Reverse DNS: $pub4 is $ptr, which does not resolve back to $pub4." "Create an A record for $ptr pointing to $pub4, or choose a PTR name you control." ;;
    esac
  fi
}

check_nginx_config() {
  [ "$CONF_PROXY" = nginx ] || return 0
  local out
  if out=$(nginx -t 2>&1); then add_check OK nginx "nginx configuration test passed."
  else add_check FAIL nginx "nginx -t reports a problem: $(printf '%s' "$out" | tail -n1)" "Fix the file named in the message; ours is $(nginx_site_path shopme). Never reload until nginx -t passes."; fi
}

check_backups() {
  local latest age_h
  # shellcheck disable=SC2012
  latest=$(ls -1t "$OPT_DIR"/backups/db-*.sql.gz 2>/dev/null | head -n1 || true)
  if [ -z "$latest" ]; then add_check WARN backup "No database backup found yet." "Run: shopme-install.sh backup"; return; fi
  age_h=$(( ($(date +%s) - $(stat -c %Y "$latest")) / 3600 ))
  if [ "$age_h" -gt 36 ]; then add_check WARN backup "The last database backup is $age_h hours old." "Check the cron job ($SHOPME_CRON_FILE) or run: shopme-install.sh backup"
  else add_check OK backup "Last database backup: ${age_h} h ago."; fi
  [ -f "$SHOPME_CRON_FILE" ] || add_check WARN cron "The nightly backup job is missing." "Run: shopme-install.sh install (safe to re-run)."
}

cmd_doctor() {
  local full=$1
  QUIET=0
  [ "$(uname -s)" = Linux ] || die "doctor runs on the server (Linux)."
  [ -f "$(conf_file)" ] || { add_check FAIL install "No ShopMe installation found in $OPT_DIR." "Run: shopme-install.sh install"; emit_checks; return; }
  load_conf
  [ "$OPT_JSON" = 1 ] || printf 'ShopMe %s at %s (%s)\n\n' "${CONF_VERSION:-unknown}" "$CONF_DOMAIN" "$CONF_PROXY"
  check_containers
  check_resources
  check_cert
  if [ "$full" = 1 ]; then
    check_dns
    check_mail
    check_nginx_config
    check_backups
  fi
  emit_checks
}

# ---- add-domain, renew, uninstall --------------------------------------------------------------------------------------

cmd_add_domain() {
  preflight_platform
  require_installed
  load_conf
  local host=${POSITIONAL[0]:-}
  [ -n "$host" ] || die "Usage: shopme-install.sh add-domain <host>"
  host=$(lower "$host")
  valid_hostname "$host" || die "'$host' is not a valid host name."
  [ -n "$CONF_MULTI" ] || die "add-domain is for multi-store installations."
  if [ "$CONF_PROXY" = caddy ]; then
    info "Nothing to do: Caddy gets a certificate for $host by itself the first time it is visited, as soon as ShopMe confirms it serves that host."
    info "Point the DNS A record of $host to this server, and verify the domain in Settings > Domains."
    return 0
  fi
  [ "$CONF_PROXY" = nginx ] || die "This installation has no proxy managed by the installer."
  local ask
  if is_dry; then printf '+ curl -fsS "http://127.0.0.1:%s/__shopme/tls-ask?domain=%s" (must answer 200)\n' "$OPT_PORT" "$host"
  else
    ask=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -G --data-urlencode "domain=$host" "http://127.0.0.1:$OPT_PORT/__shopme/tls-ask" || true)
    [ "$ask" = 200 ] || die "ShopMe does not serve $host yet (answer $ask). Add the domain in the admin (Settings > Domains) and verify it first."
    local pub4
    pub4=$(public_ip 4)
    if [ -n "$pub4" ] && [ "$(dns_status "$host" "$pub4" "$(public_ip 6)")" != ok ] && [ "$OPT_FORCE" = 0 ]; then
      die "DNS for $host does not point to this server ($pub4) yet. Fix it, or use --force."
    fi
  fi
  local site name="shopme-domain-$host"
  site=$(nginx_site_path "$name")
  nginx_guard "$site" "$host"
  ensure_certbot
  if [ -d "/etc/letsencrypt/live/$host" ] && ! is_dry; then
    render_nginx_site tls "$host" "$OPT_PORT" "/etc/letsencrypt/live/$host" | write_file "$site" 644 public
    nginx_enable_site "$name"
    nginx_test_reload
  else
    render_nginx_site http "$host" "$OPT_PORT" | write_file "$site" 644 public
    nginx_enable_site "$name"
    nginx_test_reload
    run certbot --nginx -d "$host" -m "${CONF_EMAIL:-admin@$host}" --agree-tos --no-eff-email --non-interactive --redirect
  fi
  info "$host is served over HTTPS."
}

cmd_renew() {
  preflight_platform
  load_conf
  [ "$CONF_PROXY" = nginx ] || die "Certificates are managed by Caddy (automatic) or not at all in this installation."
  if [ "$CONF_DNS_MODE" = manual ]; then
    OPT_MULTI=${CONF_MULTI}; OPT_EMAIL=${CONF_EMAIL}; OPT_DOMAIN=${CONF_DOMAIN}; OPT_DNS_PROVIDER=""
    # --keep-until-expiring is dropped so the challenge runs now.
    local extra=()
    is_covered_by_wildcard "$OPT_DOMAIN" "$OPT_MULTI" || extra=(-d "$OPT_DOMAIN")
    step "Renewing the wildcard certificate (manual DNS)"
    is_dry || have_tty || die "A manual renewal needs an interactive terminal."
    run certbot certonly --cert-name "$CONF_CERT_NAME" -m "$OPT_EMAIL" --agree-tos --manual --preferred-challenges dns \
      --deploy-hook "systemctl reload nginx" -d "$OPT_MULTI" -d "*.$OPT_MULTI" "${extra[@]}"
  else
    run certbot renew
  fi
  nginx_test_reload
}

cmd_uninstall() {
  preflight_platform
  load_conf
  confirm "Remove ShopMe's containers, nginx site and cron job from this server? $([ "$OPT_PURGE" = 1 ] && echo 'ALL DATA, BACKUPS AND VOLUMES WILL BE DELETED.' || echo 'Your data and backups are kept.')" n || die "Not confirmed (use --yes to skip the question)."
  if [ -f "$OPT_DIR/docker-compose.yml" ] || is_dry; then
    if [ "$OPT_PURGE" = 1 ]; then run_dc down -v --remove-orphans; else run_dc down --remove-orphans; fi
  fi
  run rm -f "$SHOPME_CRON_FILE"
  local f removed=0
  for f in "$SHOPME_NGINX_DIR"/sites-enabled/shopme.conf "$SHOPME_NGINX_DIR"/sites-enabled/shopme-domain-*.conf \
           "$SHOPME_NGINX_DIR"/sites-available/shopme.conf "$SHOPME_NGINX_DIR"/sites-available/shopme-domain-*.conf \
           "$SHOPME_NGINX_DIR"/conf.d/shopme.conf "$SHOPME_NGINX_DIR"/conf.d/shopme-domain-*.conf; do
    if [ -e "$f" ] || [ -L "$f" ]; then
      if is_dry || [ -L "$f" ] || grep -q 'Managed by shopme-install.sh' "$f"; then run rm -f "$f"; removed=1; fi
    fi
  done
  if [ "$CONF_PROXY" = nginx ] && { [ "$removed" = 1 ] || is_dry; }; then nginx_test_reload; fi
  if [ "$OPT_PURGE" = 1 ]; then
    run rm -rf "$SHOPME_DNS_CRED_DIR"
    run rm -rf "$OPT_DIR"
    info "ShopMe and all its data were removed. Certificates stay in /etc/letsencrypt (certbot delete --cert-name <name> removes them)."
  else
    info "ShopMe is stopped and removed. Data, backups and the database volume are kept in $OPT_DIR and Docker. Install again to bring it back, or use --purge to delete everything."
  fi
}

# ---------------------------------------------------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------------------------------------------------

main() {
  set -Eeuo pipefail
  umask 022
  parse_args "$@"
  case "$CMD" in
    help) usage ;;
    install) cmd_install ;;
    update) cmd_update ;;
    backup) cmd_backup ;;
    restore) cmd_restore ;;
    status) cmd_doctor 0 ;;
    doctor) cmd_doctor 1 ;;
    add-domain) cmd_add_domain ;;
    renew) cmd_renew ;;
    uninstall) cmd_uninstall ;;
  esac
}

if [ "${SHOPME_SOURCE_ONLY:-0}" != 1 ] && { [ -z "${BASH_SOURCE[0]:-}" ] || [ "${BASH_SOURCE[0]}" = "$0" ]; }; then
  main "$@"
fi
