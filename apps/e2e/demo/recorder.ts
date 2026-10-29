import { spawn, type ChildProcess } from 'node:child_process';
import type { Page } from '@playwright/test';

/**
 * Records one page to an H.264 file: Chromium's screencast frames (JPEG, sent only when something repaints)
 * are written to ffmpeg at a constant frame rate, repeating the latest frame between paints. Sharper than
 * Playwright's built-in VP8 video, and the clock it returns lets captions be timed against the video.
 */
export interface Recording {
  /** Seconds of video so far (pauses excluded): the clock captions are timed with. */
  elapsed(): number;
  /** Stops adding frames (e.g. while a page loads off camera); `resume` continues without a jump. */
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
}

export async function startRecording(page: Page, outFile: string, fps = 30): Promise<Recording> {
  const cdp = await page.context().newCDPSession(page);
  const viewport = page.viewportSize() ?? { width: 1920, height: 1080 };
  const ffmpeg: ChildProcess = spawn(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-framerate',
      String(fps),
      '-c:v',
      'mjpeg',
      '-i',
      '-',
      '-vf',
      `scale=${viewport.width}:${viewport.height}:flags=lanczos,format=yuv420p`,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '16',
      '-movflags',
      '+faststart',
      outFile,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const done = new Promise<void>((resolve, reject) => {
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });

  let latest: Buffer | null = null;
  cdp.on('Page.screencastFrame', (frame: { data: string; sessionId: number }) => {
    latest = Buffer.from(frame.data, 'base64');
    cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 95,
    maxWidth: viewport.width,
    maxHeight: viewport.height,
    everyNthFrame: 1,
  });
  // Wait for the first frame so the video never starts black.
  const firstBy = Date.now() + 10_000;
  while (!latest && Date.now() < firstBy) await new Promise((r) => setTimeout(r, 20));

  // A drift-free frame clock: write as many frames as the wall clock says are due.
  let start = Date.now();
  let written = 0;
  let paused = false;
  const timer = setInterval(
    () => {
      if (paused) return;
      const due = Math.floor(((Date.now() - start) * fps) / 1000);
      while (written < due && latest) {
        ffmpeg.stdin?.write(latest);
        written += 1;
      }
    },
    1000 / fps / 2,
  );

  return {
    elapsed: () => written / fps,
    pause() {
      paused = true;
    },
    resume() {
      start = Date.now() - (written * 1000) / fps;
      paused = false;
    },
    async stop() {
      clearInterval(timer);
      await cdp.send('Page.stopScreencast').catch(() => undefined);
      await cdp.detach().catch(() => undefined);
      ffmpeg.stdin?.end();
      await done;
    },
  };
}
