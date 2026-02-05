import { NextRequest, NextResponse } from 'next/server';
import ytdl from '@oreohq/ytdl-core';
import type { VideoInfoResponse, VideoFormat } from '@/types/video';

// Extract video ID from various YouTube URL formats
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

// Format duration from seconds to HH:MM:SS or MM:SS
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Parse format from ytdl-core format object
function parseFormat(format: ytdl.videoFormat): VideoFormat {
  return {
    itag: format.itag,
    url: format.url,
    mimeType: format.mimeType || '',
    quality: format.quality || 'unknown',
    qualityLabel: format.qualityLabel,
    container: format.container || 'mp4',
    hasVideo: format.hasVideo || false,
    hasAudio: format.hasAudio || false,
    videoCodec: format.videoCodec,
    audioCodec: format.audioCodec,
    width: format.width,
    height: format.height,
    fps: format.fps,
    bitrate: format.bitrate,
    contentLength: format.contentLength,
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const url = searchParams.get('url');

    if (!url) {
      return NextResponse.json<VideoInfoResponse>(
        {
          success: false,
          error: 'MISSING_URL',
          message: 'YouTube URL is required',
        },
        { status: 400 }
      );
    }

    // Extract video ID
    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json<VideoInfoResponse>(
        {
          success: false,
          error: 'INVALID_URL',
          message: 'Invalid YouTube URL format',
        },
        { status: 400 }
      );
    }

    // Validate video ID format
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return NextResponse.json<VideoInfoResponse>(
        {
          success: false,
          error: 'INVALID_VIDEO_ID',
          message: 'Invalid video ID format',
        },
        { status: 400 }
      );
    }

    // Get video info using ytdl-core with requestOptions to avoid signature parsing errors
    let info: ytdl.videoInfo;
    try {
      // Use requestOptions to configure headers and avoid signature parsing issues
      info = await ytdl.getInfo(videoId, {
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        },
      });
    } catch (error: any) {
      // Handle signature parsing errors (n transform function)
      if (error.message?.includes('n transform') || error.message?.includes('signature') || error.message?.includes('decipher')) {
        console.error('Signature parsing error (this may be due to YouTube updates):', error.message);
        return NextResponse.json<VideoInfoResponse>(
          {
            success: false,
            error: 'SIGNATURE_ERROR',
            message: 'YouTube signature parsing failed. This may be due to a YouTube update. Please try again later or update the ytdl-core library.',
          },
          { status: 500 }
        );
      }
      
      // Handle specific ytdl-core errors
      if (error.message?.includes('Private video') || error.message?.includes('unavailable')) {
        return NextResponse.json<VideoInfoResponse>(
          {
            success: false,
            error: 'VIDEO_UNAVAILABLE',
            message: 'This video is private or unavailable',
          },
          { status: 403 }
        );
      }

      if (error.message?.includes('Sign in to confirm your age')) {
        return NextResponse.json<VideoInfoResponse>(
          {
            success: false,
            error: 'AGE_RESTRICTED',
            message: 'This video is age-restricted and cannot be downloaded',
          },
          { status: 403 }
        );
      }

      if (error.message?.includes('Video unavailable')) {
        return NextResponse.json<VideoInfoResponse>(
          {
            success: false,
            error: 'VIDEO_NOT_FOUND',
            message: 'Video not found. Please check the URL and try again',
          },
          { status: 404 }
        );
      }

      // Rate limiting or network errors
      if (error.statusCode === 429 || error.message?.includes('rate limit')) {
        return NextResponse.json<VideoInfoResponse>(
          {
            success: false,
            error: 'RATE_LIMITED',
            message: 'Too many requests. Please try again in a few moments',
          },
          { status: 429 }
        );
      }

      // Generic error
      console.error('Error fetching video info:', error);
      return NextResponse.json<VideoInfoResponse>(
        {
          success: false,
          error: 'FETCH_ERROR',
          message: 'Failed to fetch video information. Please try again',
        },
        { status: 500 }
      );
    }

    // Parse formats and filter out WebP and formats without URLs
    // Formats without URLs can't be downloaded (signature decryption failed)
    const formats: VideoFormat[] = info.formats
      .map(parseFormat)
      .filter((format) => {
        // Filter out WebP formats - user wants MP4 only
        const isWebP = format.mimeType?.includes('webp') || format.container === 'webp';
        // CRITICAL: Filter out formats without URLs - these can't be downloaded
        // This happens when ytdl-core can't parse YouTube's signature functions
        const hasValidUrl = format.url && format.url.length > 0 && format.url.startsWith('http');
        return !isWebP && hasValidUrl;
      });
    
    // Log warning if many formats were filtered out
    if (formats.length === 0) {
      console.warn('WARNING: No valid formats found after filtering. This may indicate YouTube signature parsing issues.');
    } else if (formats.length < info.formats.length / 2) {
      console.warn(`WARNING: ${info.formats.length - formats.length} formats were filtered out (missing URLs or WebP). Only ${formats.length} valid formats available.`);
    }

    // Get best thumbnail
    const thumbnail =
      info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1]?.url ||
      `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

    // Calculate duration
    const duration = parseInt(info.videoDetails.lengthSeconds || '0', 10);

    // Return video info
    return NextResponse.json<VideoInfoResponse>({
      success: true,
      data: {
        videoId: info.videoDetails.videoId,
        title: info.videoDetails.title,
        author: info.videoDetails.author?.name || 'Unknown',
        thumbnail,
        duration,
        durationFormatted: formatDuration(duration),
        formats,
      },
    });
  } catch (error: any) {
    console.error('Unexpected error in /api/info:', error);
    return NextResponse.json<VideoInfoResponse>(
      {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred. Please try again later',
      },
      { status: 500 }
    );
  }
}

