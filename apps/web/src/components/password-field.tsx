'use client';

import { useId, useState } from 'react';
import { IconEye, IconEyeOff } from './icons';

/**
 * A password `<input>` with a show/hide toggle — the one behavior every
 * password field on the web now carries, and the one this product's own
 * fields didn't. Drop-in for a bare `<input type="password">`: it renders
 * only the input and its toggle, so it still sits inside whatever
 * `<label className="field">` wrapper the surrounding form already uses for
 * its own hint or error text.
 *
 * Toggling visibility never submits the form and never claims keyboard
 * focus away from the field itself — `tabIndex={-1}` keeps Tab moving
 * through the form's actual fields, not stopping on a button that only
 * changes how the one before it is drawn.
 */
export function PasswordField({
  name,
  autoComplete,
  required,
  autoFocus,
  defaultValue,
  value,
  onChange,
  ariaInvalid,
  ariaDescribedBy,
}: {
  name: string;
  autoComplete?: string;
  required?: boolean;
  autoFocus?: boolean;
  defaultValue?: string;
  value?: string;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <div className="password-field">
      <input
        id={id}
        name={name}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        required={required}
        autoFocus={autoFocus}
        defaultValue={defaultValue}
        value={value}
        onChange={onChange}
        aria-invalid={ariaInvalid ? true : undefined}
        aria-describedby={ariaDescribedBy}
      />
      <button
        type="button"
        className="password-toggle"
        tabIndex={-1}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-controls={id}
        title={visible ? 'Hide password' : 'Show password'}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <IconEyeOff size={18} /> : <IconEye size={18} />}
      </button>
    </div>
  );
}
