'use client';

import React from 'react';
import type { VideoFormat, QualityOption } from '@/types/video';

interface QualitySelectorProps {
  formats: VideoFormat[];
  selectedFormat: VideoFormat | null;
  onSelectFormat: (format: VideoFormat) => void;
  className?: string;
}

export default function QualitySelector({
  formats,
  selectedFormat,
  onSelectFormat,
  className = '',
}: QualitySelectorProps) {
  // Group formats into quality options
  const qualityOptions: QualityOption[] = React.useMemo(() => {
    const options: QualityOption[] = [];
    const seen = new Set<string>();

    // Audio-only formats
    const audioFormats = formats
      .filter((f) => f.hasAudio && !f.hasVideo)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    if (audioFormats.length > 0) {
      const bestAudio = audioFormats[0];
      options.push({
        value: `audio-${bestAudio.itag}`,
        label: 'MP3 Audio (Best Quality)',
        format: bestAudio,
        requiresMerge: false,
        group: 'audio',
      });
    }

    // Video formats (with or without audio)
    const videoFormats = formats
      .filter((f) => f.hasVideo)
      .sort((a, b) => {
        // Sort by quality label if available, otherwise by height
        const aHeight = a.height || 0;
        const bHeight = b.height || 0;
        if (aHeight !== bHeight) return bHeight - aHeight;
        return (b.bitrate || 0) - (a.bitrate || 0);
      });

    for (const format of videoFormats) {
      const key = `${format.height || 0}-${format.hasAudio}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const qualityLabel = format.qualityLabel || `${format.height || '?'}p`;
      const hasAudio = format.hasAudio;
      const requiresMerge = !hasAudio;

      let label = `${qualityLabel} ${format.container.toUpperCase()}`;
      if (hasAudio) {
        label += ' (Video + Audio)';
      } else {
        label += ' (Video Only - will merge with audio)';
      }

      options.push({
        value: `video-${format.itag}`,
        label,
        format,
        requiresMerge,
        group: 'video',
      });
    }

    return options;
  }, [formats]);

  if (qualityOptions.length === 0) {
    return (
      <div className={`text-sm text-gray-500 dark:text-gray-400 ${className}`}>
        No formats available
      </div>
    );
  }

  // Find the current selected value
  const selectedValue = React.useMemo(() => {
    if (!selectedFormat) return '';
    const option = qualityOptions.find((opt) => opt.format.itag === selectedFormat.itag);
    return option?.value || '';
  }, [selectedFormat, qualityOptions]);

  return (
    <div className={className}>
      <label
        htmlFor="quality-select"
        className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
      >
        Select Quality/Format
      </label>
      <select
        id="quality-select"
        value={selectedValue}
        onChange={(e) => {
          const option = qualityOptions.find((opt) => opt.value === e.target.value);
          if (option) {
            onSelectFormat(option.format);
          }
        }}
        className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
      >
        <option value="">Choose a quality...</option>
        {qualityOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

