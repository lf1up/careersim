import React from 'react';

type ValueKind = 'percent' | 'time' | 'number';

function detectValueKind(value: string | number): ValueKind {
  const stringValue = String(value).trim().toLowerCase();
  if (stringValue.endsWith('%')) return 'percent';
  if (stringValue.includes(':')) return 'time';
  if (stringValue.endsWith('ms') || stringValue.endsWith('s') || stringValue.endsWith('m') || stringValue.endsWith('h')) return 'time';
  if (!Number.isNaN(Number(stringValue))) return 'number';
  return 'number';
}

export const ValueText: React.FC<{ value: string | number; className?: string }> = ({ value, className }) => {
  const kind = detectValueKind(value);
  const colorClass = kind === 'percent' 
    ? 'text-green-700 dark:text-green-400' 
    : kind === 'time' 
      ? 'text-amber-700 dark:text-amber-400' 
      : 'text-primary-700 dark:text-primary-400';
  return <span className={`font-monoRetro ${colorClass}${className ? ` ${className}` : ''}`}>{value}</span>;
};
