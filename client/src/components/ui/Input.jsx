import { forwardRef } from 'react';

export const Field = ({ label, htmlFor, hint, error, required, children }) => (
  <div>
    <label htmlFor={htmlFor} className="rg-label">
      {label}
      {required && <span className="ml-0.5 text-danger-500" aria-hidden="true">*</span>}
    </label>
    {children}
    {hint && !error && <p className="rg-hint">{hint}</p>}
    {error && (
      <p className="mt-1 text-xs font-medium text-danger-600" role="alert">
        {error}
      </p>
    )}
  </div>
);

export const Input = forwardRef(function Input(
  { id, name, type = 'text', className = '', ...rest },
  ref
) {
  return <input ref={ref} id={id || name} name={name} type={type} className={`rg-input ${className}`} {...rest} />;
});

export const Select = forwardRef(function Select(
  { id, name, options = [], placeholder, className = '', ...rest },
  ref
) {
  return (
    <select ref={ref} id={id || name} name={name} className={`rg-input ${className}`} {...rest}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea(
  { id, name, rows = 4, className = '', ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      id={id || name}
      name={name}
      rows={rows}
      className={`rg-input resize-y ${className}`}
      {...rest}
    />
  );
});

export default Input;
