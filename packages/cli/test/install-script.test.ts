import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const script = path.join(repoRoot, 'shopme-install.sh');

const baseEnv: Record<string, string> = {
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  HOME: process.env.HOME ?? '/root',
  NO_COLOR: '1',
  SHOPME_OVERRIDE_OS: 'debian',
  SHOPME_OVERRIDE_ARCH: 'x86_64',
  SHOPME_OVERRIDE_PUBLIC_IP: '203.0.113.7',
  SHOPME_OVERRIDE_PUBLIC_IP6: '',
  SHOPME_OVERRIDE_DNS: '203.0.113.7',
  SHOPME_OVERRIDE_FREE_RAM_MB: '8000',
  SHOPME_OVERRIDE_SWAP_MB: '0',
};

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), 'shopme-install-test-'));
}

/** Runs shell code with the script's functions loaded (nothing is executed by loading it). */
function fn(code: string, env: Record<string, string> = {}) {
  const r = spawnSync('bash', ['-c', `source "${script}"; ${code}`], {
    env: { ...baseEnv, SHOPME_SOURCE_ONLY: '1', ...env },
    encoding: 'utf8',
  });
  return { out: r.stdout, err: r.stderr, status: r.status };
}

/** Runs the script itself in dry-run mode: commands are printed, never executed. */
function dry(args: string[], env: Record<string, string> = {}) {
  const dir = tmp();
  const nginxDir = path.join(dir, 'nginx');
  mkdirSync(path.join(nginxDir, 'sites-available'), { recursive: true });
  mkdirSync(path.join(nginxDir, 'sites-enabled'), { recursive: true });
  const r = spawnSync('bash', [script, ...args, '--dir', path.join(dir, 'shopme')], {
    env: { ...baseEnv, SHOPME_DRY_RUN: '1', SHOPME_NGINX_DIR: nginxDir, SHOPME_DNS_CRED_DIR: path.join(dir, 'etc-shopme'), ...env },
    encoding: 'utf8',
    input: '',
  });
  return { out: r.stdout, err: r.stderr, all: `${r.stdout}\n${r.stderr}`, status: r.status, dir, nginxDir };
}

describe('shellcheck', () => {
  const sc = spawnSync('shellcheck', ['--version'], { encoding: 'utf8' });
  // shellcheck takes about 20 s on the 2000-line script on a busy CI runner, far over vitest's 5 s default.
  it.skipIf(sc.status !== 0)('is clean', () => {
    const r = spawnSync('shellcheck', ['-x', script], { encoding: 'utf8' });
    expect(r.stdout).toBe('');
    expect(r.status).toBe(0);
  }, 180_000);
  it('is valid bash and has a bash shebang', () => {
    expect(spawnSync('bash', ['-n', script]).status).toBe(0);
    expect(readFileSync(script, 'utf8').startsWith('#!/usr/bin/env bash')).toBe(true);
  });
});

describe('argument parsing', () => {
  it('reads the command, flags and positionals', () => {
    const r = fn(
      'parse_args install --domain shop.example.com --email=a@b.co --multi-store shops.example.com --dns-provider cloudflare --dns-credentials /root/cf.ini --force -y --add-swap; ' +
        'echo "$CMD|$OPT_DOMAIN|$OPT_EMAIL|$OPT_MULTI|$OPT_DNS_PROVIDER|$OPT_DNS_CREDENTIALS|$OPT_FORCE|$OPT_YES|$OPT_ADD_SWAP"',
    );
    expect(r.out.trim()).toBe('install|shop.example.com|a@b.co|shops.example.com|cloudflare|/root/cf.ini|1|1|1');
  });
  it('handles restore <file>, add-domain <host> and defaults to help', () => {
    expect(fn('parse_args restore /opt/shopme/backups/db-1.sql.gz --yes; echo "$CMD ${POSITIONAL[0]}"').out.trim()).toBe('restore /opt/shopme/backups/db-1.sql.gz');
    expect(fn('parse_args add-domain shop.brand.com; echo "$CMD ${POSITIONAL[0]}"').out.trim()).toBe('add-domain shop.brand.com');
    expect(fn('parse_args; echo "$CMD"').out.trim()).toBe('help');
  });
  it('rejects unknown options and missing values', () => {
    expect(fn('parse_args install --nope').status).not.toBe(0);
    expect(fn('parse_args install --domain').err).toContain('needs a value');
  });
});

describe('validation', () => {
  it.each(['shop.example.com', 'a.b.co', 'my-shop.example.org', 'xn--bcher-kva.example'])('accepts host %s', (h) => {
    expect(fn(`valid_hostname "${h}"`).status).toBe(0);
  });
  it.each(['', 'localhost', 'shop', '*.example.com', 'http://x.com', 'a.com/path', 'a b.com', '-a.com', 'a-.com', 'a.com.', '1.2.3.4', 'a.com;rm -rf /', '$(id).com', 'A.COM', "a.com'x"])('rejects host %j', (h) => {
    const r = spawnSync('bash', ['-c', `source "${script}"; valid_hostname "$1"`, 'x', h], { env: { ...baseEnv, SHOPME_SOURCE_ONLY: '1' } });
    expect(r.status).not.toBe(0);
  });
  it('rejects a newline smuggled into a host', () => {
    const r = spawnSync('bash', ['-c', `source "${script}"; valid_hostname "$1"`, 'x', 'a.com\nb.com'], { env: { ...baseEnv, SHOPME_SOURCE_ONLY: '1' } });
    expect(r.status).not.toBe(0);
  });
  it('validates e-mail, port, provider, version and checksum', () => {
    expect(fn('valid_email you@example.com').status).toBe(0);
    expect(fn('valid_email "you@example.com;id"').status).not.toBe(0);
    expect(fn('valid_email nope').status).not.toBe(0);
    expect(fn('valid_port 3200').status).toBe(0);
    expect(fn('valid_port 80').status).not.toBe(0);
    expect(fn('valid_port abc').status).not.toBe(0);
    expect(fn('valid_dns_provider route53').status).toBe(0);
    expect(fn('valid_dns_provider godaddy').status).not.toBe(0);
    expect(fn('valid_version 1.2.3').status).toBe(0);
    expect(fn('valid_version 1.2').status).not.toBe(0);
    expect(fn(`valid_sha256 ${'a'.repeat(64)}`).status).toBe(0);
    expect(fn('valid_sha256 abc').status).not.toBe(0);
    expect(fn('safe_path /root/cf.ini').status).toBe(0);
    expect(fn('safe_path "/root/a b"').status).not.toBe(0);
    expect(fn('safe_path "/root/$(id)"').status).not.toBe(0);
  });
  it('knows when a wildcard covers a host', () => {
    expect(fn('is_covered_by_wildcard admin.shops.example.com shops.example.com').status).toBe(0);
    expect(fn('is_covered_by_wildcard a.b.shops.example.com shops.example.com').status).not.toBe(0);
    expect(fn('is_covered_by_wildcard admin.example.com shops.example.com').status).not.toBe(0);
  });
});

describe('env generation', () => {
  const vars = 'ENVV_DOMAIN=shop.example.com ENVV_PORT=3200 ENVV_PUBLIC_IP=203.0.113.7 ENVV_PG_PASSWORD=PGPASS ENVV_SESSION_SECRET=SESSSECRET ENVV_HTTPS=1';
  it('renders a single-store .env', () => {
    const out = fn(`${vars} render_env`).out;
    expect(out).toContain('APP_URL=https://shop.example.com');
    expect(out).toContain('POSTGRES_PASSWORD=PGPASS');
    expect(out).toContain('SESSION_SECRET=SESSSECRET');
    expect(out).toContain('TRUST_PROXY=true');
    expect(out).toContain('HSTS=true');
    expect(out).toContain('MULTI_STORE=false');
    expect(out).toContain('PUBLIC_IP=203.0.113.7');
  });
  it('renders the multi-store variables', () => {
    const out = fn(`${vars} ENVV_MULTI=shops.example.com ENVV_HOSTS_TOKEN=TOK render_env`).out;
    expect(out).toContain('MULTI_STORE=true');
    expect(out).toContain('STORE_BASE_DOMAIN=shops.example.com');
    expect(out).toContain('ADMIN_HOST=shop.example.com');
    expect(out).toContain('HOSTS_TOKEN=TOK');
  });
  it('the install domain is the stores base domain and the admin host by default', () => {
    const out = fn(`${vars} ENVV_MULTI=shop.example.com render_env`).out;
    expect(out).toContain('STORE_BASE_DOMAIN=shop.example.com');
    expect(out).toContain('ADMIN_HOST=shop.example.com');
  });
  it('uses http and no HSTS without a proxy', () => {
    const out = fn(`${vars} ENVV_HTTPS=0 render_env`).out;
    expect(out).toContain('APP_URL=http://shop.example.com');
    expect(out).toContain('HSTS=false');
  });
  it('generates distinct 64-hex secrets and reads values back', () => {
    const a = fn('gen_secret').out;
    const b = fn('gen_secret').out;
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    const d = tmp();
    writeFileSync(path.join(d, 'e'), 'A=1\nPOSTGRES_PASSWORD=x=y\n');
    expect(fn(`env_get "${d}/e" POSTGRES_PASSWORD`).out).toBe('x=y');
    expect(fn(`env_get "${d}/e" MISSING`).out).toBe('');
  });
  it('writes secret files with mode 600', () => {
    const d = tmp();
    const target = path.join(d, '.env');
    expect(fn(`echo SECRET=1 | write_file "${target}" 600 secret`).status).toBe(0);
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(readFileSync(target, 'utf8')).toBe('SECRET=1\n');
  });
  it('hides secret content in dry-run', () => {
    const r = fn('echo SECRET=topsecret | write_file /x/.env 600 secret', { SHOPME_DRY_RUN: '1' });
    expect(r.out).toContain('[content hidden]');
    expect(r.out).not.toContain('topsecret');
  });
});

describe('nginx rendering', () => {
  it('renders the HTTP site certbot then upgrades', () => {
    const out = fn('render_nginx_site http shop.example.com 3200').out;
    expect(out).toContain('server_name shop.example.com;');
    expect(out).toContain('listen 80;');
    expect(out).toContain('proxy_pass http://127.0.0.1:3200;');
    expect(out).toContain('X-Forwarded-Proto $scheme');
    // A client-sent X-Forwarded-For must never be forwarded (the app trusts the header for rate limits).
    expect(out).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
    expect(out).not.toContain('proxy_add_x_forwarded_for');
    // Store archives are accepted up to 2 GB by the app.
    expect(out).toContain('client_max_body_size 2g;');
    expect(out).toContain('Managed by shopme-install.sh');
    expect(out).not.toContain('443');
  });
  it('renders the TLS site for a wildcard setup', () => {
    const names = fn('nginx_server_names admin.example.com shops.example.com').out;
    expect(names).toBe('admin.example.com shops.example.com *.shops.example.com');
    const out = fn(`render_nginx_site tls "${names}" 3200 /etc/letsencrypt/live/shops.example.com`).out;
    expect(out).toContain('listen 443 ssl http2;');
    expect(out).toContain('ssl_certificate /etc/letsencrypt/live/shops.example.com/fullchain.pem;');
    expect(out).toContain('return 301 https://$host$request_uri;');
    expect(out).toContain('server_name admin.example.com shops.example.com *.shops.example.com;');
  });
  it('does not repeat an admin host the wildcard already covers', () => {
    expect(fn('nginx_server_names admin.shops.example.com shops.example.com').out).toBe('shops.example.com *.shops.example.com');
  });
});

describe('templates', () => {
  it('compose has memory limits, loopback port and no secrets inline', () => {
    const out = fn('render_compose nginx').out;
    expect(out).toContain('mem_limit: 768m');
    expect(out).toContain('mem_limit: 512m');
    expect(out).toContain('"127.0.0.1:${SHOPME_PORT:-3200}:3000"');
    expect(out).toContain('./app:/app:ro');
    expect(out).not.toContain('caddy');
    expect(fn('render_compose caddy').out).toContain('image: caddy:2');
  });
  it('Caddyfile: plain and multi-store with on-demand TLS restricted by the ask endpoint', () => {
    const single = fn('render_caddyfile shop.example.com a@b.co').out;
    expect(single).toContain('shop.example.com {');
    expect(single).not.toContain('on_demand');
    const multi = fn('render_caddyfile admin.example.com a@b.co shops.example.com').out;
    expect(multi).toContain('ask http://shopme:3000/__shopme/tls-ask');
    expect(multi).toContain('on_demand');
  });
  it('certbot DNS plugin flags carry only the credentials path', () => {
    expect(fn('certbot_dns_args cloudflare /etc/shopme/c.ini').out).toBe('--dns-cloudflare\n--dns-cloudflare-credentials\n/etc/shopme/c.ini\n');
    expect(fn('certbot_dns_args route53 /x').out).toBe('--dns-route53\n');
    expect(fn('certbot_dns_args ovh /x').out).toContain('--dns-ovh-credentials');
    expect(fn('certbot_dns_args gandi /x').out).toContain('dns-gandi');
    expect(fn('certbot_dns_args digitalocean /x').out).toContain('--dns-digitalocean-credentials');
  });
  it('renders the release URL from the template', () => {
    expect(fn('render_bundle_url "https://h/v{version}/s-{version}-{arch}.tgz" 1.2.3 arm64').out).toBe('https://h/v1.2.3/s-1.2.3-arm64.tgz');
  });
});

describe('decisions', () => {
  it('health and rollback', () => {
    expect(fn('decide_after_health healthy').out.trim()).toBe('keep');
    expect(fn('decide_after_health unhealthy').out.trim()).toBe('rollback');
  });
  it('build is refused below 3 GB of free RAM', () => {
    expect(fn('decide_build 3072 3072').out.trim()).toBe('build');
    expect(fn('decide_build 2900 3072').out.trim()).toBe('refuse');
  });
  it('classifies the web server on 80/443', () => {
    expect(fn('classify_webserver no').out.trim()).toBe('none');
    expect(fn('classify_webserver no nginx').out.trim()).toBe('nginx');
    expect(fn('classify_webserver yes').out.trim()).toBe('nginx');
    expect(fn('classify_webserver no apache2').out.trim()).toBe('other:apache2');
    expect(fn('classify_webserver yes nginx apache2').out.trim()).toBe('other:apache2');
  });
  it('accepts only the bundle layout', () => {
    expect(fn('printf "app/\\napp/apps/server/dist/main.js\\ntemplates/Caddyfile\\nREADME.md\\nVERSION\\n./shopme-install.sh\\n" | bundle_list_ok').status).toBe(0);
    expect(fn('printf "app/x\\n../evil\\n" | bundle_list_ok').status).not.toBe(0);
    expect(fn('printf "/etc/passwd\\n" | bundle_list_ok').status).not.toBe(0);
    expect(fn('printf "app/../../x\\n" | bundle_list_ok').status).not.toBe(0);
    expect(fn('printf "other/file\\n" | bundle_list_ok').status).not.toBe(0);
  });
  it('compares DNS answers with the public IP', () => {
    expect(fn('dns_status h 203.0.113.7 ""', { SHOPME_OVERRIDE_DNS: '203.0.113.7' }).out.trim()).toBe('ok');
    expect(fn('dns_status h 203.0.113.7 ""', { SHOPME_OVERRIDE_DNS: '198.51.100.1' }).out.trim()).toBe('mismatch:198.51.100.1');
    expect(fn('dns_status h 203.0.113.7 ""', { SHOPME_OVERRIDE_DNS: '' }).out.trim()).toBe('missing');
    expect(fn('dns_status h 203.0.113.7 ""', { SHOPME_OVERRIDE_DNS: '203.0.113.7 2001:db8::1' }).out.trim()).toBe('mismatch:2001:db8::1');
  });
  it('computes certificate days left', () => {
    expect(fn('days_until "Jan 11 00:00:00 2030 GMT" 1893456000').out.trim()).toBe('10');
  });
  it('health_wait retries until the probe succeeds', () => {
    const d = tmp();
    const r = fn(`n=0; probe() { n=$((n+1)); [ "$n" -ge 3 ]; }; health_wait 5 0 probe; echo "rc=$?"; health_wait 2 0 false; echo "rc=$?"`, { TMPDIR: d });
    expect(r.out).toContain('rc=0');
    expect(r.out).toContain('rc=1');
  });
});

describe('status / doctor output', () => {
  it('prints OK/WARN/FAIL lines with the fix, and fails when a check failed', () => {
    const r = fn(
      'OPT_JSON=0; add_check OK a "All good"; add_check WARN b "Careful" "Do this"; add_check FAIL c "Broken" "Fix that"; emit_checks; echo "rc=$?"',
    );
    expect(r.out).toContain('[OK  ] All good');
    expect(r.out).toContain('[WARN] Careful');
    expect(r.out).toContain('Fix: Do this');
    expect(r.out).toContain('[FAIL] Broken');
    expect(r.out).toContain('rc=1');
  });
  it('--json is valid JSON with a summary', () => {
    const r = fn('OPT_JSON=1; add_check OK a "Fine \\"quoted\\""; add_check WARN b "Slow" "Wait"; emit_checks; echo "rc=$?"');
    const json = JSON.parse(r.out.split('\n')[0]!);
    expect(json.ok).toBe(true);
    expect(json.summary).toEqual({ ok: 1, warn: 1, fail: 0 });
    expect(json.checks[0]).toEqual({ id: 'a', level: 'OK', message: 'Fine "quoted"', fix: '' });
    expect(json.checks[1].fix).toBe('Wait');
    expect(r.out).toContain('rc=0');
  });
  it('doctor --json on an empty folder reports the missing installation', () => {
    const d = tmp();
    const r = spawnSync('bash', [script, 'doctor', '--json', '--dir', d], { env: baseEnv, encoding: 'utf8' });
    const json = JSON.parse(r.stdout);
    expect(json.ok).toBe(false);
    expect(json.checks[0].id).toBe('install');
    expect(r.status).toBe(1);
  });
});

describe('dry-run: install with nginx present', () => {
  const r = dry(['install', '--domain', 'shop.example.com', '--email', 'you@example.com', '--bundle', '/tmp/shopme-server-1.0.0.tar.gz'], { SHOPME_OVERRIDE_WEBSERVER: 'nginx' });
  it('succeeds and goes through nginx and certbot', () => {
    expect(r.status).toBe(0);
    expect(r.all).toContain('through the existing nginx and certbot');
    expect(r.all).toContain('+ nginx -t');
    expect(r.all).toContain('+ systemctl reload nginx');
    expect(r.all).toContain('+ certbot --nginx -d shop.example.com -m you@example.com');
    expect(r.all).toMatch(/\+ write .*\/sites-available\/shopme\.conf \(mode 644\)/);
    expect(r.all).toMatch(/\+ ln -sf .*sites-available\/shopme\.conf .*sites-enabled\/shopme\.conf/);
  });
  it('never stops nginx, never uses Caddy, never touches other sites', () => {
    expect(r.all).not.toMatch(/systemctl (stop|restart|disable) nginx/);
    expect(r.all).not.toContain('caddy');
    expect(r.all).not.toMatch(/rm .*sites-enabled/);
  });
  it('creates the stack, health wait, backup cron and prints next steps', () => {
    expect(r.all).toContain('up -d');
    expect(r.all).toContain('/healthz');
    expect(r.all).toContain('/etc/cron.d/shopme-backup');
    expect(r.all).toContain('backup --db-only --quiet');
    expect(r.all).toContain('https://shop.example.com/admin');
    expect(r.all).toContain('setup wizard');
    expect(r.all).toContain('Settings > E-mails');
  });
  it('keeps secrets out of the output and writes .env as 600', () => {
    expect(r.all).toMatch(/\+ write .*\/\.env \(mode 600\)\n\s+\[content hidden\]/);
    expect(r.all).not.toMatch(/[0-9a-f]{40,}/);
    expect(r.all).not.toContain('POSTGRES_PASSWORD=');
  });
  it('uses the bundle and does not build', () => {
    expect(r.all).toContain('tar -xzf /tmp/shopme-server-1.0.0.tar.gz');
    expect(r.all).not.toContain('docker build');
  });
});

describe('dry-run: install with nothing on 80/443', () => {
  const r = dry(['install', '--domain', 'shop.example.com', '--email', 'you@example.com', '--bundle', '/tmp/b.tar.gz', '--add-swap', '--yes'], { SHOPME_OVERRIDE_WEBSERVER: 'none' });
  it('runs Caddy in the compose stack with automatic HTTPS', () => {
    expect(r.status).toBe(0);
    expect(r.all).toContain('through Caddy');
    expect(r.all).toMatch(/\+ write .*\/Caddyfile/);
    expect(r.all).toContain('shop.example.com {');
    expect(r.all).toContain('image: caddy:2');
    expect(r.all).not.toContain('certbot');
    expect(r.all).not.toContain('nginx -t');
  });
  it('installs Docker (official script behind the confirmation) and adds swap on request', () => {
    const none = dry(['install', '--domain', 'shop.example.com', '--email', 'you@example.com', '--bundle', '/tmp/b.tar.gz'], { SHOPME_OVERRIDE_WEBSERVER: 'none', SHOPME_OVERRIDE_DOCKER: 'missing' });
    expect(none.all).toMatch(/get\.docker\.com/);
    expect(r.all).toContain('fallocate -l 2048M /swapfile');
    expect(r.all).toContain('swapon /swapfile');
  });
  it('does not add swap without consent, nor when there already is some', () => {
    const noSwap = dry(['install', '--domain', 'shop.example.com', '--email', 'you@example.com', '--bundle', '/tmp/b.tar.gz'], { SHOPME_OVERRIDE_WEBSERVER: 'none' });
    expect(noSwap.all).not.toContain('fallocate');
    const has = dry(['install', '--domain', 'shop.example.com', '--email', 'you@example.com', '--bundle', '/tmp/b.tar.gz', '--add-swap'], { SHOPME_OVERRIDE_WEBSERVER: 'none', SHOPME_OVERRIDE_SWAP_MB: '1024' });
    expect(has.all).not.toContain('fallocate');
  });
  it('builds from source when RAM allows, and refuses below 3 GB with a bundle hint', () => {
    const build = dry(['install', '--domain', 'shop.example.com', '--email', 'you@example.com'], { SHOPME_OVERRIDE_WEBSERVER: 'none' });
    expect(build.status).toBe(0);
    expect(build.all).toContain('docker build -t shopme:local');
    const small = dry(['install', '--domain', 'shop.example.com', '--email', 'you@example.com'], { SHOPME_OVERRIDE_WEBSERVER: 'none', SHOPME_OVERRIDE_FREE_RAM_MB: '2000' });
    expect(small.status).not.toBe(0);
    expect(small.all).toContain('3 GB of free RAM');
    expect(small.all).toContain('--bundle');
    expect(small.all).not.toContain('docker build');
  });
  it('downloads the bundle of a version through the URL template', () => {
    const v = dry(['install', '--domain', 'shop.example.com', '--email', 'you@example.com', '--version', '1.4.0'], {
      SHOPME_OVERRIDE_WEBSERVER: 'none',
      SHOPME_BUNDLE_URL_TEMPLATE: 'https://mirror.example/{version}/shopme-{arch}.tar.gz',
    });
    expect(v.all).toContain('curl -fL --proto =https');
    expect(v.all).toContain('https://mirror.example/1.4.0/shopme-x64.tar.gz');
  });
});

describe('dry-run: multi-store with a DNS provider', () => {
  const args = ['install', '--domain', 'admin.example.com', '--email', 'you@example.com', '--multi-store', 'shops.example.com', '--bundle', '/tmp/b.tar.gz'];
  it('issues the wildcard certificate with the provider plugin and a root-only credentials copy', () => {
    const r = dry([...args, '--dns-provider', 'cloudflare', '--dns-credentials', '/root/cf.ini'], { SHOPME_OVERRIDE_WEBSERVER: 'nginx' });
    expect(r.status).toBe(0);
    expect(r.all).toContain('install -d -m 700');
    expect(r.all).toMatch(/copy \/root\/cf\.ini to .*dns-cloudflare\.ini \(mode 600, content not shown\)/);
    expect(r.all).toContain('python3-certbot-dns-cloudflare');
    expect(r.all).toMatch(/\+ certbot certonly --cert-name shops\.example\.com .*--dns-cloudflare --dns-cloudflare-credentials \S*dns-cloudflare\.ini --non-interactive -d shops\.example\.com -d \\\*\.shops\.example\.com -d admin\.example\.com/);
    expect(r.all).toContain('server_name admin.example.com shops.example.com *.shops.example.com;');
    expect(r.all).toContain('listen 443 ssl http2;');
    expect(r.all).toContain('ssl_certificate /etc/letsencrypt/live/shops.example.com/fullchain.pem;');
    expect(r.all).toContain('MULTI_BASE=shops.example.com');
    expect(r.all).toContain('add-domain <host>');
    expect(r.all).not.toContain('certbot --nginx');
  });
  it('supports route53 and gandi', () => {
    const a = dry([...args, '--dns-provider', 'route53', '--dns-credentials', '/root/aws'], { SHOPME_OVERRIDE_WEBSERVER: 'nginx' });
    expect(a.all).toContain('--dns-route53');
    expect(a.all).toContain('AWS_SHARED_CREDENTIALS_FILE=');
    const g = dry([...args, '--dns-provider', 'gandi', '--dns-credentials', '/root/g.ini'], { SHOPME_OVERRIDE_WEBSERVER: 'nginx' });
    expect(g.all).toContain('certbot-plugin-gandi');
    expect(g.all).toContain('--authenticator dns-gandi');
  });
  it('--manual-dns prints the steps and the 90-day warning', () => {
    const r = dry([...args, '--manual-dns'], { SHOPME_OVERRIDE_WEBSERVER: 'nginx' });
    expect(r.all).toContain('_acme-challenge.shops.example.com');
    expect(r.all).toContain('90 days');
    expect(r.all).toContain('--manual --preferred-challenges dns');
    expect(r.all).toContain('DNS_MODE=manual');
  });
  it('with Caddy uses on-demand TLS restricted by the ask endpoint', () => {
    const r = dry(args, { SHOPME_OVERRIDE_WEBSERVER: 'none' });
    expect(r.status).toBe(0);
    expect(r.all).toContain('ask http://shopme:3000/__shopme/tls-ask');
    expect(r.all).toContain('on_demand');
    expect(r.all).toContain('STORE_BASE_DOMAIN');
  });
  it('rejects credentials without a provider file and conflicting methods', () => {
    expect(dry([...args, '--dns-provider', 'cloudflare'], { SHOPME_OVERRIDE_WEBSERVER: 'nginx' }).all).toContain('needs --dns-credentials');
    expect(dry([...args, '--dns-provider', 'cloudflare', '--manual-dns'], { SHOPME_OVERRIDE_WEBSERVER: 'nginx' }).status).not.toBe(0);
    expect(dry([...args, '--dns-provider', 'godaddy'], { SHOPME_OVERRIDE_WEBSERVER: 'nginx' }).all).toContain('Unknown --dns-provider');
  });
  it('add-domain uses an individual certificate (nginx) and nothing for Caddy', () => {
    const d = tmp();
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, 'install.conf'), 'DOMAIN=admin.example.com\nEMAIL=you@example.com\nMULTI_BASE=shops.example.com\nPROXY=nginx\nCERT_NAME=shops.example.com\nDNS_MODE=provider\nPORT=3200\nVERSION=1.0.0\n');
    const nginxDir = path.join(d, 'nginx');
    mkdirSync(path.join(nginxDir, 'sites-available'), { recursive: true });
    const r = spawnSync('bash', [script, 'add-domain', 'Shop.Brand.com', '--dir', d], {
      env: { ...baseEnv, SHOPME_DRY_RUN: '1', SHOPME_NGINX_DIR: nginxDir },
      encoding: 'utf8',
      input: '',
    });
    expect(r.stdout).toContain('/__shopme/tls-ask?domain=shop.brand.com');
    expect(r.stdout).toContain('certbot --nginx -d shop.brand.com');
    expect(r.stdout).toContain('shopme-domain-shop.brand.com.conf');
    writeFileSync(path.join(d, 'install.conf'), 'DOMAIN=admin.example.com\nMULTI_BASE=shops.example.com\nPROXY=caddy\nPORT=3200\n');
    const c = spawnSync('bash', [script, 'add-domain', 'shop.brand.com', '--dir', d], { env: { ...baseEnv, SHOPME_DRY_RUN: '1' }, encoding: 'utf8', input: '' });
    expect(c.stdout).toContain('Caddy gets a certificate');
    expect(c.stdout).not.toContain('certbot');
    const bad = spawnSync('bash', [script, 'add-domain', 'x;rm -rf', '--dir', d], { env: { ...baseEnv, SHOPME_DRY_RUN: '1' }, encoding: 'utf8', input: '' });
    expect(bad.status).not.toBe(0);
  });
});

describe('dry-run: update with rollback', () => {
  function setup() {
    const d = tmp();
    writeFileSync(path.join(d, 'install.conf'), 'DOMAIN=shop.example.com\nPROXY=nginx\nPORT=3200\nVERSION=1.0.0\n');
    writeFileSync(path.join(d, 'docker-compose.yml'), 'name: shopme\n');
    return d;
  }
  const run = (d: string, env: Record<string, string>) =>
    spawnSync('bash', [script, 'update', '--bundle', '/tmp/new.tar.gz', '--dir', d], { env: { ...baseEnv, SHOPME_DRY_RUN: '1', ...env }, encoding: 'utf8', input: '' });

  it('backs up, swaps app/, recreates only the shopme container and keeps the new version when healthy', () => {
    const r = run(setup(), { SHOPME_OVERRIDE_HEALTH: 'ok' });
    expect(r.status).toBe(0);
    const out = r.stdout + r.stderr;
    expect(out.indexOf('pg_dump')).toBeGreaterThan(-1);
    expect(out.indexOf('pg_dump')).toBeLessThan(out.indexOf('mv ') );
    expect(out).toMatch(/mv \S+\/app \S+\/app\.prev/);
    expect(out).toContain('up -d --force-recreate --no-deps shopme');
    expect(out).not.toContain('Rolling back');
  });
  it('rolls back to the previous app/ when health fails, and exits non-zero', () => {
    const r = run(setup(), { SHOPME_OVERRIDE_HEALTH: 'fail', SHOPME_OVERRIDE_HEALTH_AFTER_ROLLBACK: 'ok' });
    const out = r.stdout + r.stderr;
    expect(r.status).toBe(1);
    expect(out).toContain('Rolling back');
    expect(out).toMatch(/mv \S+\/app \S+\/app\.failed/);
    expect(out).toMatch(/mv \S+\/app\.prev \S+\/app\n/);
    expect(out.match(/force-recreate --no-deps shopme/g)).toHaveLength(2);
    expect(out).toContain('Rolled back: the previous version is running again');
    expect(out).toContain('restore');
  });
  it('requires an installation', () => {
    const r = spawnSync('bash', [script, 'update', '--bundle', '/tmp/x.tar.gz', '--dir', tmp()], { env: { ...baseEnv, SHOPME_OVERRIDE_HEALTH: 'ok', SHOPME_DRY_RUN: '0' }, encoding: 'utf8', input: '' });
    expect(r.status).not.toBe(0);
  });
});

describe('dry-run: other commands and refusals', () => {
  it('backup prints the dump with 14-day retention and the files archive', () => {
    const d = tmp();
    writeFileSync(path.join(d, 'install.conf'), 'DOMAIN=shop.example.com\nPROXY=nginx\nPORT=3200\n');
    const r = spawnSync('bash', [script, 'backup', '--dir', d], { env: { ...baseEnv, SHOPME_DRY_RUN: '1' }, encoding: 'utf8', input: '' });
    expect(r.stdout).toContain('pg_dump -U shopme');
    expect(r.stdout).toContain('-mtime +14 -delete');
    expect(r.stdout).toContain('uploads-');
  });
  it('restore asks for a known file type', () => {
    const d = tmp();
    writeFileSync(path.join(d, 'install.conf'), 'DOMAIN=shop.example.com\nPROXY=nginx\nPORT=3200\n');
    const bad = spawnSync('bash', [script, 'restore', '/tmp/whatever.zip', '--yes', '--dir', d], { env: { ...baseEnv, SHOPME_DRY_RUN: '1' }, encoding: 'utf8', input: '' });
    expect(bad.status).not.toBe(0);
    const ok = spawnSync('bash', [script, 'restore', '/tmp/db-20260101-000000.sql.gz', '--yes', '--dir', d], { env: { ...baseEnv, SHOPME_DRY_RUN: '1' }, encoding: 'utf8', input: '' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('DROP\\ DATABASE\\ IF\\ EXISTS\\ shopme');
    expect(ok.stdout).toContain('psql -U shopme -d shopme');
  });
  it('uninstall keeps data unless --purge', () => {
    const d = tmp();
    writeFileSync(path.join(d, 'install.conf'), 'DOMAIN=shop.example.com\nPROXY=caddy\nPORT=3200\n');
    writeFileSync(path.join(d, 'docker-compose.yml'), 'name: shopme\n');
    const keep = spawnSync('bash', [script, 'uninstall', '--yes', '--dir', d], { env: { ...baseEnv, SHOPME_DRY_RUN: '1' }, encoding: 'utf8', input: '' });
    expect(keep.stdout).toMatch(/down --remove-orphans/);
    expect(keep.stdout).not.toContain('down -v');
    expect(keep.stdout).not.toContain('rm -rf ' + d);
    const purge = spawnSync('bash', [script, 'uninstall', '--yes', '--purge', '--dir', d], { env: { ...baseEnv, SHOPME_DRY_RUN: '1' }, encoding: 'utf8', input: '' });
    expect(purge.stdout).toContain('down -v');
    expect(purge.stdout).toContain('rm -rf ' + d);
  });
  it.each([
    [['install', '--domain', 'Not A Domain', '--email', 'a@b.co'], 'not a valid host name'],
    [['install', '--domain', 'shop.example.com;id', '--email', 'a@b.co'], 'not a valid host name'],
    [['install', '--domain', 'shop.example.com', '--email', 'bad'], 'not a valid e-mail'],
    [['install', '--domain', 'shop.example.com', '--email', 'a@b.co', '--bundle', 'http://x/b.tar.gz'], 'https'],
    [['install', '--domain', 'shop.example.com', '--email', 'a@b.co', '--bundle', '/tmp/b', '--version', '1.0.0'], 'either --bundle or --version'],
    [['install', '--email', 'a@b.co'], 'Missing --domain'],
    [['install', '--domain', 'shop.example.com'], 'Missing --email'],
    [['install', '--domain', 'a.example.com', '--email', 'a@b.co', '--multi-store', 'b.example.com', '--single-store', '--bundle', '/tmp/b'], 'either --single-store or --multi-store'],
  ])('refuses %j', (args, message) => {
    const r = dry(args as string[], { SHOPME_OVERRIDE_WEBSERVER: 'none' });
    expect(r.status).not.toBe(0);
    expect(r.all).toContain(message);
  });
  it('refuses another web server on 80/443 without touching anything', () => {
    const r = dry(['install', '--domain', 'shop.example.com', '--email', 'a@b.co', '--bundle', '/tmp/b'], { SHOPME_OVERRIDE_WEBSERVER: 'other:apache2' });
    expect(r.status).not.toBe(0);
    expect(r.all).toContain('apache2');
    expect(r.all).toContain('--no-proxy');
    expect(r.out).not.toContain('+ ');
  });
  it('refuses unsupported systems and CPUs clearly', () => {
    const os = dry(['install', '--domain', 'shop.example.com', '--email', 'a@b.co'], { SHOPME_OVERRIDE_OS: 'centos rhel' });
    expect(os.all).toContain('Debian and Ubuntu');
    const cpu = dry(['install', '--domain', 'shop.example.com', '--email', 'a@b.co'], { SHOPME_OVERRIDE_ARCH: 'riscv64' });
    expect(cpu.all).toContain('Unsupported CPU');
  });
  it('arm64 is accepted and downloads the arm64 bundle', () => {
    const r = dry(['install', '--domain', 'shop.example.com', '--email', 'a@b.co', '--version', '1.0.0'], { SHOPME_OVERRIDE_ARCH: 'aarch64', SHOPME_OVERRIDE_WEBSERVER: 'none' });
    expect(r.status).toBe(0);
    expect(r.all).toContain('-arm64.tar.gz');
  });
  it('waits for DNS, or continues with --force', () => {
    const mismatch = { SHOPME_OVERRIDE_WEBSERVER: 'none', SHOPME_OVERRIDE_DNS: '198.51.100.9' };
    const base = ['install', '--domain', 'shop.example.com', '--email', 'a@b.co', '--bundle', '/tmp/b'];
    const warn = dry(base, mismatch);
    expect(warn.all).toContain('points to 198.51.100.9, not to this server (203.0.113.7)');
    expect(warn.all).toContain('would wait for DNS');
    expect(dry([...base, '--force'], mismatch).all).toContain('Continuing anyway (--force)');
  });
  it('help lists every command', () => {
    const r = spawnSync('bash', [script, 'help'], { env: baseEnv, encoding: 'utf8' });
    for (const c of ['install', 'update', 'backup', 'restore', 'status', 'doctor', 'add-domain', 'uninstall', '--dns-provider', '--manual-dns', '--add-swap', '--bundle', '--json']) {
      expect(r.stdout).toContain(c);
    }
  });
});

describe('bundle builder', () => {
  it('validates its options before doing anything', () => {
    const bad = spawnSync('node', [path.join(repoRoot, 'scripts/make-server-bundle.mjs'), '--arch', 'sparc'], { encoding: 'utf8' });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain('--arch must be x64 or arm64');
    const ver = spawnSync('node', [path.join(repoRoot, 'scripts/make-server-bundle.mjs'), '--version', 'not-a-version'], { encoding: 'utf8' });
    expect(ver.status).not.toBe(0);
    expect(existsSync(path.join(repoRoot, 'deploy/server/docker-compose.yml'))).toBe(true);
  });
});

describe('dry-run: multi-store is the default', () => {
  const base = ['install', '--domain', 'boutique.fr', '--email', 'me@boutique.fr', '--bundle', '/tmp/b.tar.gz'];

  it('nginx: one domain, no wildcard certificate, a sync-certs timer', () => {
    const r = dry(base, { SHOPME_OVERRIDE_WEBSERVER: 'nginx', SHOPME_OVERRIDE_INIT: 'systemd' });
    expect(r.status, r.all).toBe(0);
    expect(r.all).toContain('MODE=multi');
    expect(r.all).toContain('MULTI_BASE=boutique.fr');
    expect(r.all).toContain('DNS_MODE=sync');
    expect(r.all).toContain('MULTI_STORE: ${MULTI_STORE:-true}');
    // the main site is served for the admin domain only; stores get their own certificate later
    expect(r.all).toContain('server_name boutique.fr;');
    expect(r.all).not.toContain('*.boutique.fr;');
    expect(r.all).toMatch(/\+ certbot --nginx -d boutique\.fr /);
    expect(r.all).not.toContain('certbot certonly');
    expect(r.all).toContain('location = /__shopme/hosts { return 404; }');
    // the sync job
    expect(r.all).toContain('shopme-sync-certs.timer');
    expect(r.all).toContain('OnUnitActiveSec=1min');
    expect(r.all).toMatch(/ExecStart=\S+ sync-certs --quiet --dir /);
    expect(r.all).toContain('systemctl enable --now shopme-sync-certs.timer');
    // next steps: the single extra DNS record
    expect(r.all).toContain('*.boutique.fr  A  203.0.113.7');
    expect(r.all).toContain('your first store is served on boutique.fr itself');
    expect(r.all).toContain('MULTI_STORE=false');
  });

  it('nginx without systemd falls back to a cron job', () => {
    const r = dry(base, { SHOPME_OVERRIDE_WEBSERVER: 'nginx', SHOPME_OVERRIDE_INIT: 'cron' });
    expect(r.all).toContain('* * * * * root');
    expect(r.all).toContain('sync-certs --quiet');
    expect(r.all).not.toContain('enable --now shopme-sync-certs.timer');
  });

  it('checks the wildcard A record', () => {
    const r = dry(base, { SHOPME_OVERRIDE_WEBSERVER: 'nginx', SHOPME_OVERRIDE_DNS: '' });
    expect(r.all).toContain('DNS: boutique.fr has no A/AAAA record');
    expect(r.all).toContain('DNS: *.boutique.fr has no A/AAAA record');
    const ok = dry(base, { SHOPME_OVERRIDE_WEBSERVER: 'nginx' });
    expect(ok.all).toContain('DNS ok: shopme-dns-check.boutique.fr');
  });

  it('Caddy: on-demand TLS for every store, nothing to sync', () => {
    const r = dry(base, { SHOPME_OVERRIDE_WEBSERVER: 'none' });
    expect(r.status, r.all).toBe(0);
    expect(r.all).toContain('MODE=multi');
    expect(r.all).toContain('ask http://shopme:3000/__shopme/tls-ask');
    expect(r.all).toContain('on_demand');
    expect(r.all).toContain('MULTI_STORE: ${MULTI_STORE:-true}');
    expect(r.all).not.toContain('shopme-sync-certs');
    expect(r.all).toContain('Caddy gets each store');
  });

  it('--single-store opts out: MULTI_STORE=false, no wildcard record, no sync job', () => {
    const r = dry([...base, '--single-store'], { SHOPME_OVERRIDE_WEBSERVER: 'nginx' });
    expect(r.status, r.all).toBe(0);
    expect(r.all).toContain('MODE=single');
    expect(r.all).toContain('(single store)');
    expect(r.all).not.toContain('shopme-sync-certs');
    expect(r.all).not.toContain('shopme-dns-check');
    expect(r.all).not.toContain('*.boutique.fr');
  });

  it('--dns-provider and --manual-dns still give one wildcard certificate', () => {
    const r = dry([...base, '--dns-provider', 'cloudflare', '--dns-credentials', '/root/cf.ini'], { SHOPME_OVERRIDE_WEBSERVER: 'nginx' });
    expect(r.all).toContain('DNS_MODE=provider');
    expect(r.all).toMatch(/certbot certonly --cert-name boutique\.fr .*-d boutique\.fr -d \\\*\.boutique\.fr/);
    expect(r.all).not.toContain('shopme-sync-certs');
    expect(dry([...base, '--manual-dns'], { SHOPME_OVERRIDE_WEBSERVER: 'nginx' }).all).toContain('DNS_MODE=manual');
  });

  it('an install made as a single store before this default stays single', () => {
    const d = tmp();
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, 'install.conf'), 'DOMAIN=boutique.fr\nEMAIL=me@boutique.fr\nMULTI_BASE=\nPROXY=nginx\nPORT=3200\n');
    const r = spawnSync('bash', [script, ...base, '--dir', d], {
      env: { ...baseEnv, SHOPME_DRY_RUN: '1', SHOPME_OVERRIDE_WEBSERVER: 'nginx', SHOPME_NGINX_DIR: path.join(d, 'nginx') }, encoding: 'utf8', input: '',
    });
    expect(r.stdout).toContain('MODE=single');
  });
});

describe('sync-certs', () => {
  const confDir = (mode = 'sync') => {
    const d = tmp();
    mkdirSync(path.join(d, 'nginx', 'sites-available'), { recursive: true });
    writeFileSync(path.join(d, 'install.conf'), `DOMAIN=boutique.fr\nEMAIL=me@boutique.fr\nMODE=multi\nMULTI_BASE=boutique.fr\nPROXY=nginx\nDNS_MODE=${mode}\nPORT=3200\n`);
    return d;
  };
  const sync = (d: string, env: Record<string, string> = {}) => spawnSync('bash', [script, 'sync-certs', '--dir', d], {
    env: { ...baseEnv, SHOPME_DRY_RUN: '1', SHOPME_NGINX_DIR: path.join(d, 'nginx'), SHOPME_STATE_DIR: path.join(d, 'state'), SHOPME_LETSENCRYPT_DIR: path.join(d, 'le'), ...env }, encoding: 'utf8', input: '',
  });

  it('gets a certificate for each host that has none, with certbot --nginx and one reload', () => {
    const d = confDir();
    mkdirSync(path.join(d, 'le', 'live', 'boutique.fr'), { recursive: true });
    writeFileSync(path.join(d, 'le', 'live', 'boutique.fr', 'fullchain.pem'), 'x');
    const r = sync(d, { SHOPME_OVERRIDE_HOSTS: 'boutique.fr shop-a.boutique.fr custom.example.org' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('/__shopme/hosts');
    expect(r.stdout).not.toContain('certbot --nginx -d boutique.fr');
    expect(r.stdout).toContain('certbot --nginx -d shop-a.boutique.fr');
    expect(r.stdout).toContain('certbot --nginx -d custom.example.org');
    expect(r.stdout).toContain('shopme-domain-shop-a.boutique.fr.conf');
    expect(r.stdout.match(/\+ systemctl reload nginx/g)).toHaveLength(1);
  });

  it('ignores invalid and local host names', () => {
    const r = sync(confDir(), { SHOPME_OVERRIDE_HOSTS: 'localhost x.localhost bad_host;id good.example.org' });
    expect(r.stdout).toContain('certbot --nginx -d good.example.org');
    expect(r.stdout).not.toContain('bad_host');
    expect(r.stdout).not.toContain('x.localhost');
  });

  it('does nothing with a wildcard certificate or Caddy', () => {
    expect(sync(confDir('provider'), { SHOPME_OVERRIDE_HOSTS: 'a.boutique.fr' }).stdout).toContain('Nothing to do');
    const d = confDir();
    writeFileSync(path.join(d, 'install.conf'), 'DOMAIN=boutique.fr\nMODE=multi\nMULTI_BASE=boutique.fr\nPROXY=caddy\nPORT=3200\n');
    expect(sync(d, { SHOPME_OVERRIDE_HOSTS: 'a.boutique.fr' }).stdout).toContain('Nothing to do');
  });

  it('caps the certificates per run', () => {
    const r = sync(confDir(), { SHOPME_OVERRIDE_HOSTS: 'a.boutique.fr b.boutique.fr c.boutique.fr', SHOPME_SYNC_MAX_PER_RUN: '2' });
    expect(r.stdout.match(/\+ certbot --nginx/g)).toHaveLength(2);
    expect(r.stdout).toContain('limit of 2 certificates per run');
  });

  it('waits when DNS does not point here yet, instead of calling certbot', () => {
    const r = sync(confDir(), { SHOPME_OVERRIDE_HOSTS: 'a.boutique.fr', SHOPME_OVERRIDE_DNS: '198.51.100.9' });
    expect(r.stdout).not.toContain('certbot --nginx');
    expect(r.stdout).toContain('DNS is not pointing to this server yet');
  });

  it('reads the host list from the endpoint JSON and backs off exponentially up to 6 hours', () => {
    expect(fn(`printf '%s' '{"hosts":["boutique.fr","a.boutique.fr"]}' | hosts_from_json`).out).toBe('boutique.fr\na.boutique.fr');
    expect(fn(`printf '%s' '{"hosts":[]}' | hosts_from_json`).out).toBe('');
    expect(fn('for n in 1 2 3 4 5 6 7 20; do sync_backoff_seconds $n; done').out.split('\n').filter(Boolean)).toEqual(['300', '600', '1200', '2400', '4800', '9600', '19200', '21600']);
  });

  it('the token never appears on a command line', () => {
    const src = readFileSync(script, 'utf8');
    expect(src).toContain('curl -fsS --max-time 10 -K -');
    expect(src).not.toMatch(/curl[^\n]*Bearer \$/);
  });
});
