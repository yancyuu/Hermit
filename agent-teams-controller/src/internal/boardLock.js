const path = require('path');

const { withFileLockSync } = require('./fileLock.js');

const reentrantLockDepthByScope = new Map();

function getTeamBoardLockScope(paths) {
  return path.join(paths.teamDir, 'board-state');
}

function withTeamBoardLock(paths, fn) {
  const scope = getTeamBoardLockScope(paths);
  const currentDepth = reentrantLockDepthByScope.get(scope) || 0;

  if (currentDepth > 0) {
    reentrantLockDepthByScope.set(scope, currentDepth + 1);
    try {
      return fn();
    } finally {
      const nextDepth = (reentrantLockDepthByScope.get(scope) || 1) - 1;
      if (nextDepth <= 0) {
        reentrantLockDepthByScope.delete(scope);
      } else {
        reentrantLockDepthByScope.set(scope, nextDepth);
      }
    }
  }

  return withFileLockSync(scope, () => {
    reentrantLockDepthByScope.set(scope, 1);
    try {
      return fn();
    } finally {
      reentrantLockDepthByScope.delete(scope);
    }
  });
}

module.exports = {
  getTeamBoardLockScope,
  withTeamBoardLock,
};
