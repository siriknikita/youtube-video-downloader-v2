'use client';

import React from 'react';

interface ProgressBarProps {
  progress: number;
  label?: string;
  stage?: string;
  className?: string;
}

export default function ProgressBar({ progress, label, stage, className = '' }: ProgressBarProps) {
  const clampedProgress = Math.min(100, Math.max(0, progress));

  return (
    <div className={`w-full ${className}`}>
      {(label || stage) && (
        <div className="flex justify-between items-center mb-2">
          {label && (
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {label}
            </span>
          )}
          {stage && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {stage}
            </span>
          )}
        </div>
      )}
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
        <div
          className="bg-blue-600 dark:bg-blue-500 h-2.5 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${clampedProgress}%` }}
        >
          <div className="h-full w-full bg-gradient-to-r from-blue-500 to-blue-600 dark:from-blue-400 dark:to-blue-500 animate-pulse" />
        </div>
      </div>
      <div className="mt-1 text-right">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {Math.round(clampedProgress)}%
        </span>
      </div>
    </div>
  );
}

