'use client';

import React, { useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type { VideoInfo, VideoFormat, DownloadProgress } from '@/types/video';
import ProgressBar from './ProgressBar';
import QualitySelector from './QualitySelector';

interface DownloaderProps {
  className?: string;
}

export default function Downloader({ className = '' }: DownloaderProps) {
  const [url, setUrl] = useState('');
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<VideoFormat | null>(null);
  const [progress, setProgress] = useState<DownloadProgress>({
    stage: 'idle',
    progress: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const ffmpegRef = useRef<FFmpeg | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch video information
  const fetchVideoInfo = useCallback(async () => {
    if (!url.trim()) {
      setError('Please enter a YouTube URL');
      return;
    }

    setIsLoading(true);
    setError(null);
    setVideoInfo(null);
    setSelectedFormat(null);
    setProgress({ stage: 'fetching', progress: 0, message: 'Fetching video information...' });

    try {
      const response = await axios.get<{ success: boolean; data?: VideoInfo; error?: string; message?: string }>(
        `/api/info?url=${encodeURIComponent(url)}`
      );

      if (!response.data.success || !response.data.data) {
        throw new Error(response.data.message || 'Failed to fetch video information');
      }

      setVideoInfo(response.data.data);
      setProgress({ stage: 'idle', progress: 0 });
    } catch (err: any) {
      const errorMessage =
        err.response?.data?.message ||
        err.message ||
        'Failed to fetch video information. Please check the URL and try again.';
      setError(errorMessage);
      setProgress({ stage: 'idle', progress: 0 });
    } finally {
      setIsLoading(false);
    }
  }, [url]);

  // Download blob with progress tracking using XMLHttpRequest (better CORS handling)
  const downloadBlob = async (
    url: string,
    filename: string,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
    videoId?: string,
    itag?: number
  ): Promise<Blob> => {
    // Try XMLHttpRequest first (better CORS handling than fetch)
    // The URL from /api/info is bound to the client's IP, so it should work
    return new Promise<Blob>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      
      // Set headers that YouTube expects
      xhr.setRequestHeader('Referer', 'https://www.youtube.com/');
      xhr.setRequestHeader('Origin', 'https://www.youtube.com');
      
      // Handle progress
      if (onProgress) {
        xhr.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) {
            onProgress((event.loaded / event.total) * 100);
          }
        };
      }
      
      // Handle completion
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response);
        } else if (xhr.status === 0) {
          // CORS error or network issue - try server proxy
          if (!videoId || !itag) {
            reject(new Error('CORS error: Video ID and itag are required for server proxy fallback.'));
            return;
          }
          
          // Fallback to server proxy
          const proxyUrl = `/api/download?videoId=${encodeURIComponent(videoId)}&itag=${itag}`;
          fetch(proxyUrl, { signal })
            .then((response) => {
              if (!response.ok) {
                throw new Error(`Server proxy failed: ${response.statusText} (${response.status})`);
              }
              return response.blob();
            })
            .then(resolve)
            .catch(reject);
        } else {
          reject(new Error(`Failed to download: ${xhr.statusText} (${xhr.status})`));
        }
      };
      
      // Handle errors
      xhr.onerror = () => {
        if (!videoId || !itag) {
          reject(new Error('Network error: Video ID and itag are required for server proxy fallback.'));
          return;
        }
        
        // Fallback to server proxy
        const proxyUrl = `/api/download?videoId=${encodeURIComponent(videoId)}&itag=${itag}`;
        fetch(proxyUrl, { signal })
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Server proxy failed: ${response.statusText} (${response.status})`);
            }
            return response.blob();
          })
          .then(resolve)
          .catch(reject);
      };
      
      // Handle abort
      if (signal) {
        signal.addEventListener('abort', () => {
          xhr.abort();
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }
      
      // Send request
      xhr.send();
    });
  };

  // Initialize FFmpeg
  const initFFmpeg = async (): Promise<FFmpeg> => {
    if (ffmpegRef.current) {
      return ffmpegRef.current;
    }

    setProgress({ stage: 'merging', progress: 0, message: 'Loading FFmpeg...' });

    const ffmpeg = new FFmpeg();
    ffmpegRef.current = ffmpeg;

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    return ffmpeg;
  };

  // Merge video and audio using FFmpeg
  const mergeWithFFmpeg = async (videoBlob: Blob, audioBlob: Blob, outputFilename: string): Promise<void> => {
    const ffmpeg = await initFFmpeg();

    setProgress({ stage: 'merging', progress: 10, message: 'Preparing files...' });

    // Write files to FFmpeg virtual filesystem
    await ffmpeg.writeFile('video.mp4', await fetchFile(videoBlob));
    setProgress({ stage: 'merging', progress: 30, message: 'Processing video...' });

    await ffmpeg.writeFile('audio.mp4', await fetchFile(audioBlob));
    setProgress({ stage: 'merging', progress: 50, message: 'Merging streams...' });

    // Merge video and audio
    await ffmpeg.exec([
      '-i', 'video.mp4',
      '-i', 'audio.mp4',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-strict', 'experimental',
      '-shortest',
      'output.mp4',
    ]);

    setProgress({ stage: 'merging', progress: 90, message: 'Finalizing...' });

    // Read output file
    const data = await ffmpeg.readFile('output.mp4');
    // Convert FileData to Uint8Array for Blob constructor
    const uint8Array = data instanceof Uint8Array ? data : new Uint8Array(data);
    const blob = new Blob([uint8Array], { type: 'video/mp4' });

    // Clean up
    await ffmpeg.deleteFile('video.mp4');
    await ffmpeg.deleteFile('audio.mp4');
    await ffmpeg.deleteFile('output.mp4');

    // Trigger download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = outputFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setProgress({ stage: 'complete', progress: 100, message: 'Download complete!' });
  };

  // Download video
  const downloadVideo = useCallback(async () => {
    if (!selectedFormat || !videoInfo) {
      setError('Please select a quality/format');
      return;
    }

    setError(null);
    setProgress({ stage: 'downloading', progress: 0, message: 'Starting download...' });

    abortControllerRef.current = new AbortController();

    try {
      const format = selectedFormat;
      const filename = `${videoInfo.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${format.container}`;

      // If format has both video and audio, use native browser download (bypasses CORS)
      if (format.hasVideo && format.hasAudio) {
        setProgress({ stage: 'downloading', progress: 0, message: 'Starting download...' });
        
        // Use native browser download which bypasses CORS restrictions
        // The URL is bound to the client's IP, so it should work when triggered from the browser
        const a = document.createElement('a');
        a.href = format.url;
        a.download = filename;
        a.target = '_blank'; // Open in new tab as fallback if download attribute doesn't work
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        setProgress({ stage: 'complete', progress: 100, message: 'Download started! Check your downloads folder.' });
      } else if (format.hasVideo && !format.hasAudio) {
        // Need to merge with audio
        setProgress({ stage: 'downloading', progress: 0, message: 'Downloading video stream...' });

        // Find best audio format
        const audioFormats = videoInfo.formats.filter((f) => f.hasAudio && !f.hasVideo);
        if (audioFormats.length === 0) {
          throw new Error('No audio stream available for merging');
        }

        const bestAudio = audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

        // Download video
        const videoBlob = await downloadBlob(format.url, 'video', (progress) => {
          setProgress({
            stage: 'downloading',
            progress: progress * 0.5,
            message: 'Downloading video stream...',
          });
        }, abortControllerRef.current?.signal, videoInfo.videoId, format.itag);

        // Download audio
        setProgress({ stage: 'downloading', progress: 50, message: 'Downloading audio stream...' });
        const audioBlob = await downloadBlob(bestAudio.url, 'audio', (progress) => {
          setProgress({
            stage: 'downloading',
            progress: 50 + progress * 0.5,
            message: 'Downloading audio stream...',
          });
        }, abortControllerRef.current?.signal, videoInfo.videoId, bestAudio.itag);

        // Merge with FFmpeg
        await mergeWithFFmpeg(videoBlob, audioBlob, filename);
      } else if (format.hasAudio && !format.hasVideo) {
        // Audio-only download - use native browser download
        setProgress({ stage: 'downloading', progress: 0, message: 'Starting download...' });
        
        // Use native browser download which bypasses CORS restrictions
        const a = document.createElement('a');
        a.href = format.url;
        a.download = filename;
        a.target = '_blank'; // Open in new tab as fallback if download attribute doesn't work
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        setProgress({ stage: 'complete', progress: 100, message: 'Download started! Check your downloads folder.' });
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError('Download cancelled');
      } else {
        const errorMsg = err.message || 'Failed to download video. Please try again.';
        // Provide helpful guidance based on error type
        if (errorMsg.includes('403') || errorMsg.includes('ACCESS_DENIED') || errorMsg.includes('forbidden')) {
          if (selectedFormat && !selectedFormat.hasAudio) {
            setError(`${errorMsg}\n\n💡 Tip: YouTube is blocking server-side downloads for formats requiring merging. Please select a combined format (video+audio) which uses native browser download and works reliably.`);
          } else {
            setError(`${errorMsg}\n\n💡 Tip: YouTube may be blocking this request. Try selecting a different format or wait a few minutes.`);
          }
        } else if (errorMsg.includes('SIGNATURE_ERROR') || errorMsg.includes('n transform') || errorMsg.includes('decipher')) {
          setError(`${errorMsg}\n\n💡 Tip: YouTube has updated their security. The ytdl-core library may need an update. Try selecting a combined format (video+audio) which works more reliably.`);
        } else if (errorMsg.includes('NO_URL') || errorMsg.includes('FORMAT_NOT_FOUND')) {
          setError(`${errorMsg}\n\n💡 Tip: This format is not available. Please select a different format. Combined formats (video+audio) are usually more reliable.`);
        } else {
          setError(errorMsg);
        }
      }
      setProgress({ stage: 'idle', progress: 0 });
    }
  }, [selectedFormat, videoInfo]);

  // Cancel download
  const cancelDownload = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setProgress({ stage: 'idle', progress: 0 });
  }, []);

  return (
    <div className={className}>
      {/* URL Input */}
      <div className="mb-6">
        <label htmlFor="youtube-url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          YouTube URL
        </label>
        <div className="flex gap-2">
          <input
            id="youtube-url"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isLoading) {
                fetchVideoInfo();
              }
            }}
            placeholder="https://www.youtube.com/watch?v=..."
            className="flex-1 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
            disabled={isLoading || progress.stage !== 'idle'}
          />
          <button
            onClick={fetchVideoInfo}
            disabled={isLoading || progress.stage !== 'idle'}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed"
          >
            {isLoading ? 'Loading...' : 'Fetch Info'}
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Video Info */}
      {videoInfo && (
        <div className="mb-6">
          <div className="flex gap-4 mb-4">
            <img
              src={videoInfo.thumbnail}
              alt={videoInfo.title}
              className="w-48 h-36 object-cover rounded-lg"
            />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                {videoInfo.title}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                By: {videoInfo.author}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Duration: {videoInfo.durationFormatted}
              </p>
            </div>
          </div>

          {/* Quality Selector */}
          <QualitySelector
            formats={videoInfo.formats}
            selectedFormat={selectedFormat}
            onSelectFormat={setSelectedFormat}
            className="mb-4"
          />
          
          {/* Helpful tip about format selection */}
          {videoInfo.formats.some(f => f.hasVideo && f.hasAudio) && (
            <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                💡 <strong>Tip:</strong> Formats marked "(Video + Audio)" use native browser downloads and work most reliably. 
                Formats requiring merging may encounter YouTube restrictions.
              </p>
            </div>
          )}

          {/* Download Button */}
          <div className="flex gap-2">
            <button
              onClick={downloadVideo}
              disabled={!selectedFormat || progress.stage !== 'idle'}
              className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed"
            >
              Download
            </button>
            {progress.stage !== 'idle' && progress.stage !== 'complete' && (
              <button
                onClick={cancelDownload}
                className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {/* Progress Bar */}
      {progress.stage !== 'idle' && (
        <div className="mt-6">
          <ProgressBar
            progress={progress.progress}
            label={progress.message}
            stage={progress.stage}
          />
        </div>
      )}
    </div>
  );
}

