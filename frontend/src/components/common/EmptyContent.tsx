/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Box from '@mui/material/Box';
import Typography, { TypographyProps } from '@mui/material/Typography';
import React from 'react';

type EmptyProps = React.PropsWithChildren<{
  color?: TypographyProps['color'];
}>;

export default function Empty({ color = 'textSecondary', children }: EmptyProps) {
  // Render the live region container empty first, then inject children on the next frame.
  // Screen readers only announce content that changes inside a live region, not content present on mount.
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const id = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(id);
  }, []);

  return (
    <Box padding={2} role="status" aria-live="polite" aria-atomic="true">
      {ready &&
        React.Children.map(children, child => {
          if (typeof child === 'string') {
            return (
              <Typography color={color} align="center">
                {child}
              </Typography>
            );
          }
          return child;
        })}
    </Box>
  );
}
