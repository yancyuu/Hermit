const REPO_OWNER = 'lazy-agent';
const REPO_NAME = 'multi-agent-workbench';

export function buildReleaseAssetBase(version: string, repoName = REPO_NAME): string {
  return `https://github.com/${REPO_OWNER}/${repoName}/releases/download/v${version}`;
}

export function buildReleaseAssetBases(version: string): readonly string[] {
  return [buildReleaseAssetBase(version)];
}

export function getExpectedReleaseAssetUrl(
  version: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): string | null {
  const base = buildReleaseAssetBase(version);

  switch (platform) {
    case 'darwin':
      return arch === 'arm64'
        ? `${base}/Multi.Agent.Teams-${version}-arm64.dmg`
        : `${base}/Multi.Agent.Teams-${version}-x64.dmg`;
    case 'win32':
      return `${base}/Multi.Agent.Teams.Setup.${version}.exe`;
    case 'linux':
      return `${base}/Multi.Agent.Teams-${version}.AppImage`;
    default:
      return null;
  }
}

export function getExpectedReleaseAssetUrls(
  version: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): readonly string[] {
  const assetUrl = getExpectedReleaseAssetUrl(version, platform, arch);
  if (!assetUrl) {
    return [];
  }

  const primaryBase = buildReleaseAssetBase(version);
  return buildReleaseAssetBases(version).map((base) => assetUrl.replace(primaryBase, base));
}

export function getLatestMacMetadataUrl(version: string): string {
  return `${buildReleaseAssetBase(version)}/latest-mac.yml`;
}

export function getLatestMacMetadataUrls(version: string): readonly string[] {
  return buildReleaseAssetBases(version).map((base) => `${base}/latest-mac.yml`);
}

export function getExpectedLatestMacArtifacts(
  version: string,
  arch: Extract<NodeJS.Architecture, 'arm64' | 'x64'>
): readonly string[] {
  return arch === 'arm64'
    ? [`Multi.Agent.Teams-${version}-arm64-mac.zip`, `Multi.Agent.Teams-${version}-arm64.dmg`]
    : [`Multi.Agent.Teams-${version}-x64-mac.zip`, `Multi.Agent.Teams-${version}-x64.dmg`];
}

function stripYamlScalar(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseReleaseMetadataAssetNames(metadataText: string): Set<string> {
  const assets = new Set<string>();

  for (const rawLine of metadataText.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const match = /^(?:-\s+)?(url|path):\s+(.+)$/u.exec(line);
    if (!match) {
      continue;
    }

    assets.add(stripYamlScalar(match[2]));
  }

  return assets;
}

export function isLatestMacMetadataCompatible(
  metadataText: string,
  version: string,
  arch: Extract<NodeJS.Architecture, 'arm64' | 'x64'>
): boolean {
  const assets = parseReleaseMetadataAssetNames(metadataText);
  return getExpectedLatestMacArtifacts(version, arch).every((asset) => assets.has(asset));
}
