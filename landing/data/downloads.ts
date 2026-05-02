export type DownloadOs = 'macos' | 'windows' | 'linux';
export type DownloadArch = 'arm64' | 'x64' | 'universal';

export interface DownloadAsset {
  id: string;
  os: DownloadOs;
  arch: DownloadArch;
  label: string;
  archLabel: string;
  fileName: string;
  fileNameByArch?: Partial<Record<DownloadArch, string>>;
}

export const downloadAssets = [
  {
    id: 'macos',
    os: 'macos',
    arch: 'universal',
    label: 'macOS',
    archLabel: 'Apple Silicon / Intel',
    fileName: 'Hermit-arm64.dmg',
    fileNameByArch: {
      arm64: 'Hermit-arm64.dmg',
      x64: 'Hermit-x64.dmg',
    },
  },
  {
    id: 'windows-x64',
    os: 'windows',
    arch: 'x64',
    label: 'Windows',
    archLabel: '64-bit',
    fileName: 'Hermit-Setup.exe',
  },
  {
    id: 'linux-appimage',
    os: 'linux',
    arch: 'x64',
    label: 'Linux',
    archLabel: '64-bit',
    fileName: 'Hermit.AppImage',
  },
] as const satisfies readonly DownloadAsset[];
