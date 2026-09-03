import React from 'react';
import { title } from '../types';

interface BadgeProps {
  value: string;
  kind?: "status" | "policy" | "action";
}

export function Badge({ value, kind = "status" }: BadgeProps) {
  const displayVal = value.includes(" ") ? value : title(value);
  return <span className={`badge ${kind} ${value.replaceAll(" ", "-").replaceAll("_", "-").toLowerCase()}`}>{displayVal}</span>;
}
