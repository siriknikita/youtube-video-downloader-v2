export interface VideoFormat {
  itag: number;
  url: string;
  mimeType: string;
  quality: string;
  qualityLabel?: string;
  container: string;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  contentLength?: string;
}

export interface VideoInfo {
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
  duration: number;
  durationFormatted: string;
  formats: VideoFormat[];
}

export interface VideoInfoResponse {
  success: boolean;
  data?: VideoInfo;
  error?: string;
  message?: string;
}

export interface DownloadProgress {
  stage: 'idle' | 'fetching' | 'downloading' | 'merging' | 'complete';
  progress: number;
  message?: string;
}

export type QualityOption = {
  value: string;
  label: string;
  format: VideoFormat;
  requiresMerge: boolean;
  group: 'video' | 'audio';
};

