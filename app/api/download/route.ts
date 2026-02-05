import { NextRequest, NextResponse } from 'next/server';
import ytdl from '@oreohq/ytdl-core';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const videoId = searchParams.get('videoId');
    const itag = searchParams.get('itag');

    if (!videoId || !itag) {
      return NextResponse.json(
        {
          success: false,
          error: 'MISSING_PARAMS',
          message: 'Video ID and itag are required',
        },
        { status: 400 }
      );
    }

    // Get range header if present (for resumable downloads)
    const range = request.headers.get('range');

    // Get video info using ytdl-core with requestOptions (this generates URLs for the server's IP)
    let info: ytdl.videoInfo;
    try {
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
      // Handle signature parsing errors
      if (error.message?.includes('n transform') || error.message?.includes('signature') || error.message?.includes('decipher')) {
        return NextResponse.json(
          {
            success: false,
            error: 'SIGNATURE_ERROR',
            message: 'YouTube signature parsing failed. Please try fetching the video info again or select a different format.',
          },
          { status: 500 }
        );
      }
      
      return NextResponse.json(
        {
          success: false,
          error: 'FETCH_ERROR',
          message: 'Failed to fetch video information',
        },
        { status: 500 }
      );
    }

    // Find the requested format
    const format = info.formats.find((f) => f.itag === parseInt(itag, 10));
    if (!format) {
      return NextResponse.json(
        {
          success: false,
          error: 'FORMAT_NOT_FOUND',
          message: 'Requested format not found. It may have been filtered out (e.g., WebP formats are excluded).',
        },
        { status: 404 }
      );
    }

    if (!format.url) {
      // Format exists but URL is missing - likely signature decryption failed
      return NextResponse.json(
        {
          success: false,
          error: 'NO_URL',
          message: 'Format URL not available. This format may require signature decryption which failed. Please try a different format or fetch the video info again.',
        },
        { status: 404 }
      );
    }
    
    // Filter out WebP formats
    if (format.mimeType?.includes('webp') || format.container === 'webp') {
      return NextResponse.json(
        {
          success: false,
          error: 'WEBP_NOT_SUPPORTED',
          message: 'WebP formats are not supported. Please select an MP4 format.',
        },
        { status: 400 }
      );
    }

    // Use ytdl-core's downloadFromInfo which handles signature decryption and proper request handling
    // This is more reliable than fetching the URL directly
    try {
      const videoStream = ytdl.downloadFromInfo(info, { 
        format,
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Referer': 'https://www.youtube.com/',
            'Origin': 'https://www.youtube.com',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        },
      });

      // Get content type from format
      const contentType = format.mimeType || 'video/mp4';
      const contentLength = format.contentLength;

      // Prepare response headers
      const responseHeaders: HeadersInit = {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      };

      // Forward content length if available
      if (contentLength) {
        responseHeaders['Content-Length'] = contentLength;
      }

      // Handle range requests
      if (range) {
        responseHeaders['Content-Range'] = range;
        return new NextResponse(videoStream as any, {
          status: 206,
          headers: responseHeaders,
        });
      }

      // Stream the response back to the client using ytdl-core's stream
      return new NextResponse(videoStream as any, {
        status: 200,
        headers: responseHeaders,
      });
    } catch (streamError: any) {
      // Check if it's a 403 error (YouTube blocking)
      if (streamError?.statusCode === 403 || streamError?.cause?.statusCode === 403 || streamError?.message?.includes('403')) {
        return NextResponse.json(
          {
            success: false,
            error: 'ACCESS_DENIED',
            message: 'YouTube is blocking this request (403 Forbidden). This may be due to YouTube\'s anti-bot measures. Please try: 1) Selecting a combined format (video+audio) which uses native browser download, 2) Waiting a few minutes and trying again, or 3) The ytdl-core library may need an update to handle YouTube\'s latest changes.',
          },
          { status: 403 }
        );
      }
      
      // Fallback to direct URL fetch if downloadFromInfo fails (but format.url exists)
      if (format.url) {
        const headers: HeadersInit = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Referer': 'https://www.youtube.com/',
          'Origin': 'https://www.youtube.com',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'identity',
        };

        if (range) {
          headers['Range'] = range;
        }

        const response = await fetch(format.url, { headers });

        if (!response.ok) {
          return NextResponse.json(
            {
              success: false,
              error: 'FETCH_ERROR',
              message: `Failed to fetch video: ${response.statusText} (${response.status}). YouTube may be blocking server-side requests. Try selecting a combined format (video+audio) which uses native browser download.`,
            },
            { status: response.status }
          );
        }

        const contentType = response.headers.get('content-type') || format.mimeType || 'video/mp4';
        const contentLength = response.headers.get('content-length') || format.contentLength;
        const acceptRanges = response.headers.get('accept-ranges') || 'bytes';
        const contentRange = response.headers.get('content-range');

        const responseHeaders: HeadersInit = {
          'Content-Type': contentType,
          'Accept-Ranges': acceptRanges,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
        };

        if (contentLength) responseHeaders['Content-Length'] = contentLength;
        if (contentRange) responseHeaders['Content-Range'] = contentRange;

        const status = response.status === 206 ? 206 : 200;
        return new NextResponse(response.body, {
          status,
          headers: responseHeaders,
        });
      }
      
      // If we get here, both methods failed
      return NextResponse.json(
        {
          success: false,
          error: 'DOWNLOAD_FAILED',
          message: `Download failed: ${streamError?.message || 'Unknown error'}. This format may not be available. Please try selecting a combined format (video+audio) or a different quality.`,
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Error in /api/download:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message || 'An unexpected error occurred while downloading the video',
      },
      { status: 500 }
    );
  }
}

// Handle OPTIONS request for CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
