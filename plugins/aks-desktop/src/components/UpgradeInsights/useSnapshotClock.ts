// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useEffect, useState } from 'react';

/**
 * Re-render the owning component every minute so expiring snapshots are reassessed while idle.
 * @returns No value; the interval is released when the owning component unmounts.
 */
export function useSnapshotClock() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick(tick => tick + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
}
