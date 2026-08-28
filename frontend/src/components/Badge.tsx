import React from 'react';
import { title } from '../types';

interface BadgeProps {
  value: string;
  kind?: "status" | "policy" | "action";
}

export function Badge({ value, kind = "status" }: BadgeProps) {
  return <span className={`badge ${kind} ${value.replaceAll("_", "-")}`}>{title(value)}</span>;
}
