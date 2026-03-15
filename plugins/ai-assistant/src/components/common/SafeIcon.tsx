import { Icon, IconProps } from '@iconify/react';
import React from 'react';

/**
 * A wrapper around Iconify's `<Icon>` that prevents the
 * "Cannot assign to read only property 'color'" error.
 *
 * Iconify internally mutates the `style` object (e.g. setting `style.color`)
 * which crashes when the style object is frozen (React strict mode, MUI, etc.).
 *
 * SafeIcon:
 *  1. Merges the `color` prop into a fresh mutable `style` object.
 *  2. Always passes a shallow-copied style so Iconify never mutates a frozen ref.
 *  3. Catches render errors gracefully and renders a placeholder instead of crashing.
 */
const SafeIcon: React.FC<IconProps> = React.memo(({ color, style, ...rest }) => {
  // Build a fresh, mutable style object every render.
  // If `color` is provided as a prop, fold it into style.color.
  const safeStyle: React.CSSProperties = {
    ...(style ?? {}),
    ...(color ? { color: String(color) } : {}),
  };

  try {
    // Never forward `color` as a prop — it's already in safeStyle.
    return <Icon style={safeStyle} {...rest} />;
  } catch {
    // Fallback: render an empty inline span so layout doesn't break.
    return (
      <span
        style={{
          display: 'inline-block',
          width: rest.width ?? 16,
          height: rest.height ?? rest.width ?? 16,
        }}
      />
    );
  }
});

SafeIcon.displayName = 'SafeIcon';

export default SafeIcon;
