export const flags = {
  // CORS are set to allow any origin
  CORS_ALLOWED: 'cors-allowed',

  // the stream is locked on IP, so only works if
  // request maker is same as player (not compatible with proxies)
  IP_LOCKED: 'ip-locked',

  // The source/embed is blocking cloudflare ip's
  // This flag is not compatible with a proxy hosted on cloudflare
  CF_BLOCKED: 'cf-blocked',

  // Streams and sources with this flag wont be proxied
  // And will be exclusive to the extension
  PROXY_BLOCKED: 'proxy-blocked',
} as const;

export type Flags = (typeof flags)[keyof typeof flags];

export const targets = {
  // browser with CORS restrictions
  BROWSER: 'browser',

  // browser, but no CORS restrictions through a browser extension
  BROWSER_EXTENSION: 'browser-extension',

  // native app, so no restrictions in what can be played
  NATIVE: 'native',

  // any target, no target restrictions
  ANY: 'any',
} as const;

export type Targets = (typeof targets)[keyof typeof targets];

export type FeatureMap = {
  requires: Flags[];
  disallowed: Flags[];
};

export const targetToFeatures: Record<Targets, FeatureMap> = {
  browser: {
    requires: [flags.CORS_ALLOWED],
    disallowed: [],
  },
  'browser-extension': {
    requires: [],
    disallowed: [],
  },
  native: {
    requires: [],
    disallowed: [],
  },
  any: {
    requires: [],
    disallowed: [],
  },
};

export function getTargetFeatures(
  target: Targets,
  consistentIpForRequests: boolean,
  proxyStreams?: boolean,
): FeatureMap {
  const base = targetToFeatures[target] || targetToFeatures.any;
  const features: FeatureMap = {
    requires: [...base.requires],
    disallowed: [...base.disallowed],
  };
  if (!consistentIpForRequests && !features.disallowed.includes(flags.IP_LOCKED)) {
    features.disallowed.push(flags.IP_LOCKED);
  }
  if (proxyStreams && !features.disallowed.includes(flags.PROXY_BLOCKED)) {
    features.disallowed.push(flags.PROXY_BLOCKED);
  }
  return features;
}

export function flagsAllowedInFeatures(features: FeatureMap, inputFlags?: Flags[]): boolean {
  const flagsList = inputFlags || [];
  const hasAllFlags = features.requires.every((v) => flagsList.includes(v));
  if (!hasAllFlags) return false;
  const hasDisallowedFlag = features.disallowed.some((v) => flagsList.includes(v));
  if (hasDisallowedFlag) return false;
  return true;
}
