// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The progress line for a running create or delete. It shows no stage, output, elapsed time or
// cancel action. `role="status"` announces the text politely to screen readers.
//
// Under `prefers-reduced-motion: reduce`, Headlamp ends every CSS animation after one cycle
// (frontend `AppContainer.tsx` GlobalStyles), which leaves a still arc that looks hung. The
// indicator keeps rotating, and under reduced motion its arc does not grow or shrink.

import { CircularProgress, Stack, Typography, useMediaQuery } from '@mui/material';

// `&&` outranks Headlamp's `:root *` rule; both are `!important`.
const KEEP_ROTATING = {
  '&&': { animationDuration: '1.4s !important', animationIterationCount: 'infinite !important' },
};

/**
 * The progress line: a spinning indicator and the text, announced as a status.
 *
 * @param props - `text`, the progress text.
 * @returns The progress line.
 */
export function ProgressNotice({ text }: { readonly text: string }) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true });
  return (
    <Stack direction="row" spacing={2} alignItems="center" role="status">
      <CircularProgress aria-hidden size={24} disableShrink={reduceMotion} sx={KEEP_ROTATING} />
      <Typography>{text}</Typography>
    </Stack>
  );
}
