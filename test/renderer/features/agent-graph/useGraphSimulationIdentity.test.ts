import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useGraphSimulation, type UseGraphSimulationResult } from '../../../../packages/agent-graph/src/hooks/useGraphSimulation';

let firstSimulation: UseGraphSimulationResult | null = null;
let secondSimulation: UseGraphSimulationResult | null = null;

function SimulationHarness({ pass }: { pass: number }): React.JSX.Element | null {
  const simulation = useGraphSimulation();
  if (pass === 1) {
    firstSimulation = simulation;
  } else {
    secondSimulation = simulation;
  }
  return null;
}

describe('useGraphSimulation', () => {
  afterEach(() => {
    firstSimulation = null;
    secondSimulation = null;
    document.body.innerHTML = '';
  });

  it('returns a referentially stable result across rerenders', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(SimulationHarness, { pass: 1 }));
      await Promise.resolve();
    });

    await act(async () => {
      root.render(React.createElement(SimulationHarness, { pass: 2 }));
      await Promise.resolve();
    });

    expect(firstSimulation).toBeTruthy();
    expect(secondSimulation).toBe(firstSimulation);

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });
});
