/**
 * Endpoint and addressing style of the S3-compatible providers offered in Settings > Backup.
 * `endpoint` may contain `{region}` (replaced by the chosen region) and `{account}` (the provider account id, typed by the merchant).
 */
export interface StoragePreset {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  /** Path-style addressing (`endpoint/bucket/key`) instead of `bucket.endpoint/key`. */
  pathStyle: boolean;
  /** The endpoint carries a placeholder the merchant must fill in. */
  needs?: 'account';
}

export const STORAGE_PRESETS: readonly StoragePreset[] = [
  { id: 'b2', name: 'Backblaze B2', endpoint: 'https://s3.{region}.backblazeb2.com', region: 'us-west-004', pathStyle: false },
  { id: 'scaleway', name: 'Scaleway Object Storage', endpoint: 'https://s3.{region}.scw.cloud', region: 'fr-par', pathStyle: false },
  { id: 'ovh', name: 'OVHcloud Object Storage', endpoint: 'https://s3.{region}.io.cloud.ovh.net', region: 'gra', pathStyle: false },
  { id: 'wasabi', name: 'Wasabi', endpoint: 'https://s3.{region}.wasabisys.com', region: 'eu-central-1', pathStyle: false },
  { id: 'r2', name: 'Cloudflare R2', endpoint: 'https://{account}.r2.cloudflarestorage.com', region: 'auto', pathStyle: false, needs: 'account' },
  { id: 'aws', name: 'Amazon S3', endpoint: 'https://s3.{region}.amazonaws.com', region: 'eu-west-3', pathStyle: false },
  { id: 'custom', name: 'MinIO / custom', endpoint: '', region: 'us-east-1', pathStyle: true },
];

export const presetById = (id: string | null | undefined) => STORAGE_PRESETS.find((p) => p.id === id) ?? null;

/** The endpoint of a preset for a region (`{account}` is left for the merchant). */
export const presetEndpoint = (p: StoragePreset, region: string) => p.endpoint.replace('{region}', region.trim() || p.region);
