import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/** A tiny software WebAuthn authenticator (ES256, "none" attestation, user verified) for tests. */

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const sha = (v: Uint8Array | string) => createHash('sha256').update(v).digest();

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
}
type Cbor = number | string | Uint8Array | Map<number | string, Cbor>;
function cbor(v: Cbor): Buffer {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  return Buffer.concat([head(2, v.length), Buffer.from(v)]);
}

export class SoftAuthenticator {
  readonly credentialId = randomBytes(32);
  private key: { privateKey: KeyObject; publicKey: KeyObject } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  counter = 0;

  private coseKey(): Buffer {
    const jwk = this.key.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    return cbor(new Map<number, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  }
  private clientData(type: string, challenge: string, origin: string) { return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false })); }

  /** The JSON a browser sends after `navigator.credentials.create`. */
  register(options: { challenge: string; rp: { id?: string } }, origin: string, rpId = options.rp.id ?? 'localhost') {
    const attested = Buffer.concat([Buffer.alloc(16), Buffer.from([this.credentialId.length >> 8, this.credentialId.length & 255]), this.credentialId, this.coseKey()]);
    const counter = Buffer.alloc(4);
    const authData = Buffer.concat([sha(rpId), Buffer.from([0x45]), counter, attested]);
    const attestationObject = cbor(new Map<string, Cbor>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    return {
      id: b64u(this.credentialId), rawId: b64u(this.credentialId), type: 'public-key' as const, clientExtensionResults: {}, authenticatorAttachment: 'platform' as const,
      response: { clientDataJSON: b64u(this.clientData('webauthn.create', options.challenge, origin)), attestationObject: b64u(attestationObject), transports: ['internal' as const] },
    };
  }

  /** The JSON a browser sends after `navigator.credentials.get`. */
  authenticate(options: { challenge: string; rpId?: string }, origin: string, rpId = options.rpId ?? 'localhost') {
    this.counter += 1;
    const c = Buffer.alloc(4); c.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha(rpId), Buffer.from([0x05]), c]);
    const clientDataJSON = this.clientData('webauthn.get', options.challenge, origin);
    const signature = sign('sha256', Buffer.concat([authData, sha(clientDataJSON)]), this.key.privateKey);
    return {
      id: b64u(this.credentialId), rawId: b64u(this.credentialId), type: 'public-key' as const, clientExtensionResults: {}, authenticatorAttachment: 'platform' as const,
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: b64u(Buffer.from('user')) },
    };
  }
}
