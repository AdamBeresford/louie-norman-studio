import { Injectable } from '@angular/core';

/**
 * Keeps background images ready to paint the instant they are shown.
 *
 * Fetching alone is not enough: an image the browser holds only as bytes still
 * has to be decoded when it becomes a background, and decoding a full-screen
 * photo costs a frame — the flicker on the first pass through a carousel. So
 * each image is decoded up front, and the element is retained, because a
 * dropped element takes its decoded bitmap with it.
 */
@Injectable({
  providedIn: 'root'
})
export class ImagePreloader {

  private decoded = new Map<string, HTMLImageElement>();

  /** Fetch and decode these images, in order, skipping any already done. */
  preload(urls: string[]): void {
    for (const url of urls) {
      if (this.decoded.has(url)) {
        continue;
      }
      const image = new Image();
      image.src = url;
      this.decoded.set(url, image);
      // Nothing to do if it fails: the browser still paints it on display.
      image.decode?.().catch(() => undefined);
    }
  }

  /** Preload once the browser is idle, for images not needed yet. */
  preloadWhenIdle(urls: string[]): void {
    const idle = (window as any).requestIdleCallback as
      | ((callback: () => void, options?: { timeout: number }) => void)
      | undefined;
    if (idle) {
      idle(() => this.preload(urls), { timeout: 2000 });
    } else {
      setTimeout(() => this.preload(urls), 500);
    }
  }
}
