'use client';

import {
  useEffect,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
} from 'react';

// A secret field that browsers do not treat as a password field, so they do
// not offer to save it. It is a text input drawn as dots. Where the browser
// cannot draw it that way, it falls back to a normal password input.
type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'autoComplete'
>;

const DOTS = { WebkitTextSecurity: 'disc' } as CSSProperties;

export function SecretInput({ style, ...rest }: Props) {
  const [dots, setDots] = useState(true);

  useEffect(() => {
    setDots(
      typeof CSS !== 'undefined' &&
        CSS.supports('-webkit-text-security', 'disc'),
    );
  }, []);

  return (
    <input
      {...rest}
      type={dots ? 'text' : 'password'}
      style={dots ? { ...DOTS, ...style } : style}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      data-1p-ignore
      data-lpignore="true"
      data-form-type="other"
    />
  );
}
