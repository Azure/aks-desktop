// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useEffect, useState } from 'react';

/** Reassess expiring snapshots even when the user has not interacted with the page. */
export function useSnapshotClock() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick(tick => tick + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
}
