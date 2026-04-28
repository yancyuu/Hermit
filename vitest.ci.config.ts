import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    testTimeout: 15000,
    setupFiles: ['./test/setup.ts'],
    include: [
      'test/main/ipc/guards.test.ts',
      'test/main/ipc/window.test.ts',
      'test/main/utils/**/*.test.ts',
      'test/main/services/team/TaskBoundaryParser.test.ts',
      'test/main/services/team/TeamInboxReader.test.ts',
      'test/main/services/team/TeamInboxWriter.test.ts',
      'test/main/services/team/TeamRuntimeLivenessResolver.test.ts',
      'test/main/services/team/TeamProvisioningServiceIdempotency.test.ts',
      'test/main/services/team/RuntimeRunTombstoneStore.test.ts',
      'test/main/services/team/VersionedJsonStore.test.ts',
      'test/main/services/team/stallMonitor/**/*.test.ts',
      'test/shared/utils/rateLimitDetector.test.ts',
      'test/shared/utils/reviewState.test.ts',
    ],
    exclude: ['**/*.live.test.ts', '**/*.safe-e2e.test.ts'],
  },
  resolve: {
    alias: {
      '@features': resolve(__dirname, 'src/features'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@preload': resolve(__dirname, 'src/preload'),
      '@claude-teams/agent-graph': resolve(__dirname, 'packages/agent-graph/src/index.ts'),
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
    },
  },
});
