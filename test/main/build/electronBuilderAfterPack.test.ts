// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const afterPackModule = require('../../../scripts/electron-builder/afterPack.cjs');

const {
  detectBinaryMetadata,
  parseElf,
  parseMachO,
  parsePortableExecutable,
  pruneNodePtyArtifacts,
  pruneSsh2Artifacts,
  validateNativeBinaries,
} = afterPackModule._internal;

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-test-'));
}

function writeFile(filePath: string, content: Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createMachOBuffer(arch: 'arm64' | 'x64'): Buffer {
  const cpuType = arch === 'arm64' ? 0x0100000c : 0x01000007;
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32LE(0xfeedfacf, 0);
  buffer.writeUInt32LE(cpuType, 4);
  return buffer;
}

function createElfBuffer(arch: 'arm64' | 'x64'): Buffer {
  const machine = arch === 'arm64' ? 0x00b7 : 0x003e;
  const buffer = Buffer.alloc(64);
  buffer[0] = 0x7f;
  buffer[1] = 0x45;
  buffer[2] = 0x4c;
  buffer[3] = 0x46;
  buffer[5] = 1;
  buffer.writeUInt16LE(machine, 18);
  return buffer;
}

function createPortableExecutableBuffer(arch: 'arm64' | 'x64' | 'ia32'): Buffer {
  const machine = arch === 'arm64' ? 0xaa64 : arch === 'ia32' ? 0x014c : 0x8664;
  const buffer = Buffer.alloc(256);
  buffer[0] = 0x4d;
  buffer[1] = 0x5a;
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer[0x80] = 0x50;
  buffer[0x81] = 0x45;
  buffer[0x82] = 0x00;
  buffer[0x83] = 0x00;
  buffer.writeUInt16LE(machine, 0x84);
  return buffer;
}

describe('electron-builder afterPack', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('parses native binary headers for all supported bundle formats', async () => {
    const tempDir = createTempDir();
    tempDirs.push(tempDir);

    const machoPath = path.join(tempDir, 'arm64.node');
    const elfPath = path.join(tempDir, 'linux.node');
    const pePath = path.join(tempDir, 'win.node');
    writeFile(machoPath, createMachOBuffer('arm64'));
    writeFile(elfPath, createElfBuffer('x64'));
    writeFile(pePath, createPortableExecutableBuffer('arm64'));

    await expect(detectBinaryMetadata(machoPath)).resolves.toEqual({
      format: 'mach-o',
      archs: new Set(['arm64']),
    });
    await expect(detectBinaryMetadata(elfPath)).resolves.toEqual({
      format: 'elf',
      archs: new Set(['x64']),
    });
    await expect(detectBinaryMetadata(pePath)).resolves.toEqual({
      format: 'pe',
      archs: new Set(['arm64']),
    });
    expect(parseMachO(createMachOBuffer('x64'))).toEqual({
      format: 'mach-o',
      archs: new Set(['x64']),
    });
    expect(parseElf(createElfBuffer('arm64'))).toEqual({
      format: 'elf',
      archs: new Set(['arm64']),
    });
    expect(parsePortableExecutable(createPortableExecutableBuffer('x64'))).toEqual({
      format: 'pe',
      archs: new Set(['x64']),
    });
  });

  it('prunes node-pty prebuilds that do not match the target platform and arch', async () => {
    const tempDir = createTempDir();
    tempDirs.push(tempDir);
    const prebuildsDir = path.join(tempDir, 'node_modules', 'node-pty', 'prebuilds');
    const binDir = path.join(tempDir, 'node_modules', 'node-pty', 'bin');

    writeFile(path.join(prebuildsDir, 'darwin-arm64', 'pty.node'), createMachOBuffer('arm64'));
    writeFile(path.join(prebuildsDir, 'darwin-x64', 'pty.node'), createMachOBuffer('x64'));
    writeFile(path.join(prebuildsDir, 'win32-x64', 'pty.node'), createPortableExecutableBuffer('x64'));
    writeFile(path.join(binDir, 'darwin-arm64-143', 'node-pty.node'), createMachOBuffer('arm64'));
    writeFile(path.join(binDir, 'darwin-x64-143', 'node-pty.node'), createMachOBuffer('x64'));

    const removed = await pruneNodePtyArtifacts(tempDir, 'darwin', 'arm64');

    expect(removed).toEqual(
      expect.arrayContaining([
        path.join(prebuildsDir, 'darwin-x64'),
        path.join(prebuildsDir, 'win32-x64'),
        path.join(binDir, 'darwin-x64-143'),
      ])
    );
    expect(fs.existsSync(path.join(prebuildsDir, 'darwin-arm64'))).toBe(true);
    expect(fs.existsSync(path.join(binDir, 'darwin-arm64-143'))).toBe(true);
    expect(fs.existsSync(path.join(prebuildsDir, 'darwin-x64'))).toBe(false);
  });

  it('prunes Windows-only foreign native helper binaries', async () => {
    const tempDir = createTempDir();
    tempDirs.push(tempDir);
    const nodePtyConptyDir = path.join(
      tempDir,
      'resources',
      'app.asar.unpacked',
      'node_modules',
      'node-pty',
      'third_party',
      'conpty',
      '1.23.251008001'
    );
    const ssh2UtilDir = path.join(
      tempDir,
      'resources',
      'app.asar.unpacked',
      'node_modules',
      'ssh2',
      'util'
    );

    writeFile(
      path.join(nodePtyConptyDir, 'win10-x64', 'conpty.dll'),
      createPortableExecutableBuffer('x64')
    );
    writeFile(
      path.join(nodePtyConptyDir, 'win10-arm64', 'conpty.dll'),
      createPortableExecutableBuffer('arm64')
    );
    writeFile(path.join(ssh2UtilDir, 'pagent.exe'), createPortableExecutableBuffer('ia32'));

    const removedNodePty = await pruneNodePtyArtifacts(tempDir, 'win32', 'x64');
    const removedSsh2 = await pruneSsh2Artifacts(tempDir, 'win32', 'x64');

    expect(removedNodePty).toContain(path.join(nodePtyConptyDir, 'win10-arm64'));
    expect(removedSsh2).toContain(path.join(ssh2UtilDir, 'pagent.exe'));
    expect(fs.existsSync(path.join(nodePtyConptyDir, 'win10-x64'))).toBe(true);
    expect(fs.existsSync(path.join(nodePtyConptyDir, 'win10-arm64'))).toBe(false);
    expect(fs.existsSync(path.join(ssh2UtilDir, 'pagent.exe'))).toBe(false);
  });

  it('fails validation when a foreign-arch native binary remains in the bundle', async () => {
    const tempDir = createTempDir();
    tempDirs.push(tempDir);

    writeFile(
      path.join(tempDir, 'Contents', 'Resources', 'app.asar.unpacked', 'bad.node'),
      createMachOBuffer('x64')
    );

    await expect(validateNativeBinaries(tempDir, 'darwin', 'arm64')).resolves.toEqual([
      {
        path: path.join('Contents', 'Resources', 'app.asar.unpacked', 'bad.node'),
        format: 'mach-o',
        archs: ['x64'],
      },
    ]);
  });

  it('allows electron-builder Windows elevate helper without hiding app binaries', async () => {
    const tempDir = createTempDir();
    tempDirs.push(tempDir);

    writeFile(path.join(tempDir, 'resources', 'elevate.exe'), createPortableExecutableBuffer('ia32'));
    writeFile(
      path.join(tempDir, 'resources', 'app.asar.unpacked', 'node_modules', 'bad', 'bad.exe'),
      createPortableExecutableBuffer('ia32')
    );

    await expect(validateNativeBinaries(tempDir, 'win32', 'x64')).resolves.toEqual([
      {
        path: path.join('resources', 'app.asar.unpacked', 'node_modules', 'bad', 'bad.exe'),
        format: 'pe',
        archs: ['ia32'],
      },
    ]);
  });

  it('accepts a clean arm64 mac bundle after pruning', async () => {
    const tempDir = createTempDir();
    tempDirs.push(tempDir);

    writeFile(
      path.join(tempDir, 'Contents', 'MacOS', 'Hermit'),
      createMachOBuffer('arm64')
    );
    writeFile(
      path.join(
        tempDir,
        'Contents',
        'Resources',
        'app.asar.unpacked',
        'node_modules',
        'node-pty',
        'build',
        'Release',
        'pty.node'
      ),
      createMachOBuffer('arm64')
    );
    writeFile(
      path.join(
        tempDir,
        'Contents',
        'Resources',
        'app.asar.unpacked',
        'node_modules',
        'node-pty',
        'prebuilds',
        'darwin-arm64',
        'pty.node'
      ),
      createMachOBuffer('arm64')
    );
    writeFile(
      path.join(
        tempDir,
        'Contents',
        'Resources',
        'app.asar.unpacked',
        'node_modules',
        'node-pty',
        'prebuilds',
        'darwin-x64',
        'pty.node'
      ),
      createMachOBuffer('x64')
    );

    await afterPackModule({
      appOutDir: tempDir,
      electronPlatformName: 'darwin',
      arch: 3,
    });

    expect(
      fs.existsSync(
        path.join(
          tempDir,
          'Contents',
          'Resources',
          'app.asar.unpacked',
          'node_modules',
          'node-pty',
          'prebuilds',
          'darwin-x64'
        )
      )
    ).toBe(false);
  });
});
