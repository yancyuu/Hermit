import { describe, expect, it } from 'vitest';

import {
  getExpectedLatestMacArtifacts,
  getExpectedReleaseAssetUrl,
  getExpectedReleaseAssetUrls,
  getLatestMacMetadataUrl,
  getLatestMacMetadataUrls,
  isLatestMacMetadataCompatible,
  parseReleaseMetadataAssetNames,
} from '../../../../src/main/services/infrastructure/updaterReleaseMetadata';

describe('updaterReleaseMetadata', () => {
  it('builds platform-specific asset URLs', () => {
    expect(getExpectedReleaseAssetUrl('1.2.3', 'darwin', 'arm64')).toBe(
      'https://github.com/lazy-agent/multi-agent-workbench/releases/download/v1.2.3/Multi.Agent.Teams-1.2.3-arm64.dmg'
    );
    expect(getExpectedReleaseAssetUrl('1.2.3', 'darwin', 'x64')).toBe(
      'https://github.com/lazy-agent/multi-agent-workbench/releases/download/v1.2.3/Multi.Agent.Teams-1.2.3-x64.dmg'
    );
    expect(getExpectedReleaseAssetUrl('1.2.3', 'win32', 'x64')).toBe(
      'https://github.com/lazy-agent/multi-agent-workbench/releases/download/v1.2.3/Multi.Agent.Teams.Setup.1.2.3.exe'
    );
    expect(getExpectedReleaseAssetUrl('1.2.3', 'linux', 'x64')).toBe(
      'https://github.com/lazy-agent/multi-agent-workbench/releases/download/v1.2.3/Multi.Agent.Teams-1.2.3.AppImage'
    );
  });

  it('builds release asset URLs for the configured GitHub repo', () => {
    expect(getExpectedReleaseAssetUrls('1.2.3', 'darwin', 'arm64')).toEqual([
      'https://github.com/lazy-agent/multi-agent-workbench/releases/download/v1.2.3/Multi.Agent.Teams-1.2.3-arm64.dmg',
    ]);
  });

  it('extracts updater asset names from latest-mac.yml text', () => {
    const metadata = `
version: 1.2.3
files:
  - url: "Multi.Agent.Teams-1.2.3-arm64-mac.zip"
    sha512: abc
    size: 123
  - url: 'Multi.Agent.Teams-1.2.3-arm64.dmg'
    sha512: def
    size: 456
path: Multi.Agent.Teams-1.2.3-arm64-mac.zip
`;

    expect(parseReleaseMetadataAssetNames(metadata)).toEqual(
      new Set([
        'Multi.Agent.Teams-1.2.3-arm64-mac.zip',
        'Multi.Agent.Teams-1.2.3-arm64.dmg',
      ])
    );
  });

  it('validates arch compatibility for latest-mac.yml', () => {
    const version = '1.2.3';
    const arm64Metadata = `
version: ${version}
files:
  - url: Multi.Agent.Teams-${version}-arm64-mac.zip
    sha512: abc
    size: 123
  - url: Multi.Agent.Teams-${version}-arm64.dmg
    sha512: def
    size: 456
path: Multi.Agent.Teams-${version}-arm64-mac.zip
`;

    expect(getExpectedLatestMacArtifacts(version, 'arm64')).toEqual([
      `Multi.Agent.Teams-${version}-arm64-mac.zip`,
      `Multi.Agent.Teams-${version}-arm64.dmg`,
    ]);
    expect(getExpectedLatestMacArtifacts(version, 'x64')).toEqual([
      `Multi.Agent.Teams-${version}-x64-mac.zip`,
      `Multi.Agent.Teams-${version}-x64.dmg`,
    ]);
    expect(getLatestMacMetadataUrl(version)).toBe(
      `https://github.com/lazy-agent/multi-agent-workbench/releases/download/v${version}/latest-mac.yml`
    );
    expect(getLatestMacMetadataUrls(version)).toEqual([
      `https://github.com/lazy-agent/multi-agent-workbench/releases/download/v${version}/latest-mac.yml`,
    ]);
    expect(isLatestMacMetadataCompatible(arm64Metadata, version, 'arm64')).toBe(true);
    expect(isLatestMacMetadataCompatible(arm64Metadata, version, 'x64')).toBe(false);
  });
});
