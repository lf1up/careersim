import React from 'react';
import clsx from 'clsx';

export interface RetroInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export const RetroInput: React.FC<RetroInputProps> = ({ label, hint, error, containerClassName, className, id, ...props }) => {
  const inputId = id || props.name || undefined;
  const describedById = hint && !error ? `${inputId}-hint` : error ? `${inputId}-error` : undefined;
  return (
    <div className={clsx('w-full', containerClassName)}>
      {label && (
        <label htmlFor={inputId} className="block text-sm font-semibold mb-1">
          {label}
        </label>
      )}
      <input id={inputId} aria-invalid={!!error} aria-describedby={describedById} className={clsx('retro-input w-full', className)} {...props} />
      {hint && !error && <p id={`${inputId}-hint`} className="text-xs mt-1 font-monoRetro">{hint}</p>}
      {error && <p id={`${inputId}-error`} className="text-xs mt-1 text-red-600">{error}</p>}
    </div>
  );
};

export interface RetroSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export const RetroSelect: React.FC<RetroSelectProps> = ({ label, hint, error, containerClassName, className, id, children, ...props }) => {
  const selectId = id || props.name || undefined;
  return (
    <div className={clsx('w-full', containerClassName)}>
      {label && (
        <label htmlFor={selectId} className="block text-sm font-semibold mb-1">
          {label}
        </label>
      )}
      <select id={selectId} className={clsx('retro-input w-full', className)} {...props}>
        {children}
      </select>
      {hint && !error && <p className="text-xs mt-1 font-monoRetro">{hint}</p>}
      {error && <p className="text-xs mt-1 text-red-600">{error}</p>}
    </div>
  );
};

export interface RetroTextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export const RetroTextArea: React.FC<RetroTextAreaProps> = ({ label, hint, error, containerClassName, className, id, ...props }) => {
  const textAreaId = id || props.name || undefined;
  return (
    <div className={clsx('w-full', containerClassName)}>
      {label && (
        <label htmlFor={textAreaId} className="block text-sm font-semibold mb-1">
          {label}
        </label>
      )}
      <textarea id={textAreaId} className={clsx('retro-input w-full', className)} {...props} />
      {hint && !error && <p className="text-xs mt-1 font-monoRetro">{hint}</p>}
      {error && <p className="text-xs mt-1 text-red-600">{error}</p>}
    </div>
  );
};

export interface RetroCheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  containerClassName?: string;
}

export const RetroCheckbox: React.FC<RetroCheckboxProps> = ({ label, containerClassName, className, ...props }) => {
  return (
    <label className={clsx('inline-flex items-center gap-2 select-none', containerClassName)}>
      <input type="checkbox" className={clsx('appearance-none w-4 h-4 border-2 border-black shadow-retro-2 checked:bg-black', className)} {...props} />
      {label && <span className="text-sm">{label}</span>}
    </label>
  );
};

export interface RetroToggleProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  containerClassName?: string;
}

export const RetroToggle: React.FC<RetroToggleProps> = ({ label, containerClassName, className, ...props }) => {
  return (
    <label className={clsx('inline-flex items-center gap-3 select-none', containerClassName, className)}>
      <span className="relative inline-block w-10 h-6 border-2 border-black shadow-retro-2">
        <input type="checkbox" className="sr-only peer" {...props} />
        <span className="absolute top-0 left-0 h-full w-1/2 bg-black transition-all peer-checked:translate-x-full" />
      </span>
      {label && <span className="text-sm">{label}</span>}
    </label>
  );
};
