// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Type definitions for @testing-library/jest-dom matchers
import '@testing-library/jest-dom';

declare global {
  namespace jest {
    interface Matchers<R> {
      toBeInTheDocument(): R;
      toHaveTextContent(text: string | RegExp): R;
      toHaveAttribute(attr: string, value?: string): R;
      toHaveStyle(css: string | { [property: string]: any }): R;
      toBeVisible(): R;
      toBeChecked(): R;
      toHaveClass(className: string): R;
      toHaveValue(value: string | number): R;
    }
  }
}
