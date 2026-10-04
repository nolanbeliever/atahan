// Client IP for per-IP limits when the server sits behind a reverse proxy.
//
// Proxies append the address they received a request from to X-Forwarded-For, so the chain reads
// "<client-supplied...>, <real client>, <proxy hops...>". Only the entries appended by our own
// infrastructure are trustworthy. Walking from the right we skip internal addresses (load
// balancers) and at most ONE Cloudflare edge: Render and many other hosts put Cloudflare in front of
// their load balancers, and taking that edge address would make everyone behind the same edge share
// one rate limit. Allowing only one Cloudflare hop stops a request relayed through a Cloudflare Worker
// from reaching the spoofable part of the chain.

import net from 'node:net';

// https://www.cloudflare.com/ips/
const CLOUDFLARE_V4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];
const CLOUDFLARE_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];
const INTERNAL_V4 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '100.64.0.0/10', '169.254.0.0/16'];
const INTERNAL_V6 = ['::1/128', 'fc00::/7', 'fe80::/10'];

function blockList(v4: string[], v6: string[]): net.BlockList {
  const list = new net.BlockList();
  for (const [ranges, type] of [
    [v4, 'ipv4'],
    [v6, 'ipv6'],
  ] as const) {
    for (const cidr of ranges) {
      const [addr, prefix] = cidr.split('/');
      list.addSubnet(addr!, Number(prefix), type);
    }
  }
  return list;
}

const cloudflare = blockList(CLOUDFLARE_V4, CLOUDFLARE_V6);
const internal = blockList(INTERNAL_V4, INTERNAL_V6);

/** Strips the IPv4-mapped IPv6 prefix so "::ffff:1.2.3.4" and "1.2.3.4" are the same client. */
export function normalizeIp(raw: string): string {
  const ip = raw.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return (mapped ? mapped[1]! : ip).slice(0, 64);
}

type Hop = 'internal' | 'cloudflare' | 'other';

function classify(ip: string): Hop {
  const family = net.isIP(ip);
  if (family === 0) return 'other';
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (internal.check(ip, type)) return 'internal';
  if (cloudflare.check(ip, type)) return 'cloudflare';
  return 'other';
}

/**
 * Resolves the client address from X-Forwarded-For. `peer` is the address of the proxy that opened
 * the TCP connection. Use this only when the server is reachable exclusively through that proxy.
 */
export function resolveClientIp(forwardedFor: string | string[] | undefined, peer: string): string {
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : (forwardedFor ?? '');
  const hops = header
    .split(',')
    .map(normalizeIp)
    .filter(Boolean);
  if (hops.length === 0) return normalizeIp(peer);

  let cloudflareSkipped = false;
  for (let i = hops.length - 1; i >= 0; i--) {
    const kind = classify(hops[i]!);
    if (kind === 'internal') continue;
    if (kind === 'cloudflare' && !cloudflareSkipped) {
      cloudflareSkipped = true;
      continue;
    }
    return hops[i]!;
  }
  // Every hop was infrastructure (e.g. testing on a LAN): the left-most is the best guess.
  return hops[0]!;
}
