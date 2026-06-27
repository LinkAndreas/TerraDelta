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

function matToUrl(cv: any, mat: any): string {
  const canvas = document.createElement("canvas");
  cv.imshow(canvas, mat);
  return canvas.toDataURL("image/jpeg", 0.9);
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

    const targetUrlOut = matToUrl(cv, warped);
    return { refUrl, targetUrl: targetUrlOut, width: W, height: H, aligned: true, matchCount };
  } catch {
    // Fallback: no homography — just resize the target to the working frame.
    const tCanvas = document.createElement("canvas");
    tCanvas.width = W;
    tCanvas.height = H;
    tCanvas.getContext("2d")!.drawImage(targetImg, 0, 0, W, H);
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
