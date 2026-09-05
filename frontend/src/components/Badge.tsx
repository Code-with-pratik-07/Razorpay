import React from 'react';
import { title } from '../types';

interface BadgeProps {
  value: string;
  label?: string;
  kind?: "status" | "policy" | "action";
}

export function Badge({ value, label, kind = "status" }: BadgeProps) {
  const displayVal = label || (value.includes(" ") ? value : title(value));
  return <span className={`badge ${kind} ${value.replaceAll(" ", "-").replaceAll("_", "-").toLowerCase()}`}>{displayVal}</span>;
}
