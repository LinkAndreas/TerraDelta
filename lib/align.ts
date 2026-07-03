// Client-side image co-registration using OpenCV.js (WASM).
// Detects ORB features in both images, matches them, estimates a homography
// with RANSAC, and warps the target image onto the reference image's frame.
// Falls back to a plain resize if not enough reliable matches are found.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  interface Window {
    cv: any;
  }
}

export interface AlignResult {
  refUrl: string; // reference image, scaled to working size (JPEG data URL)
  targetUrl: string; // target image, warped to the reference frame (JPEG data URL)
  width: number;
  height: number;
  aligned: boolean; // true if a homography was used, false if it fell back to resize
  matchCount: number;
}

let opencvPromise: Promise<any> | null = null;

// Loads OpenCV from the locally bundled @techstark/opencv-js package (a pure
// asm.js build — no CDN, no separate .wasm fetch). Resolves once the runtime
// has finished initializing.
export function loadOpenCv(): Promise<any> {
  if (opencvPromise) return opencvPromise;

  opencvPromise = (async () => {
    if (typeof window === "undefined") {
      throw new Error("OpenCV can only load in the browser");
    }

    const mod: any = await import("@techstark/opencv-js");
    const cv = mod.default ?? mod;

    if (!cv.Mat) {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };

        // Hook the init callback (preserving any existing one) AND poll for the
        // real API, since the callback can fire before we attach it.
        const prev = cv.onRuntimeInitialized;
        cv.onRuntimeInitialized = () => {
          try {
            prev?.();
          } catch {
            /* ignore */
          }
          finish();
        };

        const t0 = Date.now();
        const tick = () => {
          if (settled) return;
          if (cv.Mat) {
            finish();
            return;
          }
          if (Date.now() - t0 > 60000) {
            settled = true;
            reject(new Error("OpenCV finished downloading but never initialized (timed out)"));
            return;
          }
          setTimeout(tick, 50);
        };
        tick();
      });
    }

    (window as Window).cv = cv;
    return cv;
  })();

  opencvPromise.catch(() => {
    opencvPromise = null; // allow a later retry
  });

  return opencvPromise;
}

function imgFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

// Linear radiometric normalization: shift the target's per-channel color
// statistics (mean/std) to match the reference, so global brightness and
// white-balance differences between the two capture dates don't read as
// changes downstream. Pure-black pixels are excluded — the perspective warp
// fills off-image corners with exact black, which would skew the statistics.
function matchColors(refCanvas: HTMLCanvasElement, tgtCanvas: HTMLCanvasElement): void {
  const stats = (data: Uint8ClampedArray) => {
    const sum = [0, 0, 0];
    const sq = [0, 0, 0];
    let n = 0;
    // Sample every 4th pixel — plenty for global statistics.
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r === 0 && g === 0 && b === 0) continue;
      sum[0] += r;
      sq[0] += r * r;
      sum[1] += g;
      sq[1] += g * g;
      sum[2] += b;
      sq[2] += b * b;
      n++;
    }
    if (n < 1000) return null;
    const mean = sum.map((s) => s / n);
    const std = mean.map((m, ch) => Math.sqrt(Math.max(1, sq[ch] / n - m * m)));
    return { mean, std };
  };

  const rctx = refCanvas.getContext("2d")!;
  const tctx = tgtCanvas.getContext("2d")!;
  const refStats = stats(rctx.getImageData(0, 0, refCanvas.width, refCanvas.height).data);
  const tgtImage = tctx.getImageData(0, 0, tgtCanvas.width, tgtCanvas.height);
  const tgtStats = stats(tgtImage.data);
  if (!refStats || !tgtStats) return;

  // Clamp the contrast gain so a scene-content difference can't cause an
  // extreme stretch — we only want to remove capture-level tint/brightness.
  const gain = [0, 1, 2].map((ch) =>
    Math.min(1.6, Math.max(0.6, refStats.std[ch] / tgtStats.std[ch])),
  );
  const d = tgtImage.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) continue; // keep warp border black
    for (let ch = 0; ch < 3; ch++) {
      d[i + ch] = (d[i + ch] - tgtStats.mean[ch]) * gain[ch] + refStats.mean[ch];
    }
  }
  tctx.putImageData(tgtImage, 0, 0);
}

export async function alignImages(
  referenceUrl: string,
  targetUrl: string,
  maxDim = 1536,
): Promise<AlignResult> {
  const cv = await loadOpenCv();
  const refImg = await imgFromUrl(referenceUrl);
  const targetImg = await imgFromUrl(targetUrl);

  // Working size derived from the reference image.
  const scale = Math.min(
    1,
    maxDim / Math.max(refImg.naturalWidth, refImg.naturalHeight),
  );
  const W = Math.round(refImg.naturalWidth * scale);
  const H = Math.round(refImg.naturalHeight * scale);

  // Reference, scaled to the working size.
  const refCanvas = document.createElement("canvas");
  refCanvas.width = W;
  refCanvas.height = H;
  refCanvas.getContext("2d")!.drawImage(refImg, 0, 0, W, H);
  const refUrl = refCanvas.toDataURL("image/jpeg", 0.9);

  const mats: any[] = [];
  const track = <T>(m: T): T => {
    mats.push(m);
    return m;
  };
  let orb: any, matcher: any;

  try {
    const refMat = track(cv.imread(refCanvas));

    const tCanvas = document.createElement("canvas");
    tCanvas.width = targetImg.naturalWidth;
    tCanvas.height = targetImg.naturalHeight;
    tCanvas.getContext("2d")!.drawImage(targetImg, 0, 0);
    const tgtMat = track(cv.imread(tCanvas));

    const refGray = track(new cv.Mat());
    const tgtGray = track(new cv.Mat());
    cv.cvtColor(refMat, refGray, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(tgtMat, tgtGray, cv.COLOR_RGBA2GRAY);

    try {
      orb = new cv.ORB(2000);
    } catch {
      orb = new cv.ORB();
    }

    const kpTarget = track(new cv.KeyPointVector());
    const kpRef = track(new cv.KeyPointVector());
    const desTarget = track(new cv.Mat());
    const desRef = track(new cv.Mat());
    const noMask = track(new cv.Mat());

    // target = source (we map target -> reference)
    orb.detectAndCompute(tgtGray, noMask, kpTarget, desTarget);
    orb.detectAndCompute(refGray, noMask, kpRef, desRef);

    if (desTarget.rows < 8 || desRef.rows < 8) {
      throw new Error("Too few features for alignment");
    }

    matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
    const knn = track(new cv.DMatchVectorVector());
    matcher.knnMatch(desTarget, desRef, knn, 2);

    // Lowe's ratio test.
    const srcPts: number[] = [];
    const dstPts: number[] = [];
    for (let i = 0; i < knn.size(); i++) {
      const m = knn.get(i);
      if (m.size() < 2) continue;
      const a = m.get(0);
      const b = m.get(1);
      if (a.distance < 0.75 * b.distance) {
        const p1 = kpTarget.get(a.queryIdx).pt;
        const p2 = kpRef.get(a.trainIdx).pt;
        srcPts.push(p1.x, p1.y);
        dstPts.push(p2.x, p2.y);
      }
    }

    const matchCount = srcPts.length / 2;
    if (matchCount < 12) {
      throw new Error("Too few good matches for a reliable homography");
    }

    const srcMat = track(cv.matFromArray(matchCount, 1, cv.CV_32FC2, srcPts));
    const dstMat = track(cv.matFromArray(matchCount, 1, cv.CV_32FC2, dstPts));
    const homography = track(cv.findHomography(srcMat, dstMat, cv.RANSAC, 5));
    if (homography.empty()) {
      throw new Error("Homography estimation failed");
    }

    const warped = track(new cv.Mat());
    cv.warpPerspective(
      tgtMat,
      warped,
      homography,
      new cv.Size(W, H),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(),
    );

    const outCanvas = document.createElement("canvas");
    cv.imshow(outCanvas, warped);
    matchColors(refCanvas, outCanvas);
    const targetUrlOut = outCanvas.toDataURL("image/jpeg", 0.9);
    return { refUrl, targetUrl: targetUrlOut, width: W, height: H, aligned: true, matchCount };
  } catch {
    // Fallback: no homography — just resize the target to the working frame.
    const tCanvas = document.createElement("canvas");
    tCanvas.width = W;
    tCanvas.height = H;
    tCanvas.getContext("2d")!.drawImage(targetImg, 0, 0, W, H);
    matchColors(refCanvas, tCanvas);
    return {
      refUrl,
      targetUrl: tCanvas.toDataURL("image/jpeg", 0.9),
      width: W,
      height: H,
      aligned: false,
      matchCount: 0,
    };
  } finally {
    for (const m of mats) {
      try {
        m.delete?.();
      } catch {
        /* ignore */
      }
    }
    try {
      orb?.delete?.();
    } catch {
      /* ignore */
    }
    try {
      matcher?.delete?.();
    } catch {
      /* ignore */
    }
  }
}
