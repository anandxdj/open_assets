/**
 * Sample sheets for people without a sprite sheet to hand. Each one is drawn
 * on a 256×256 canvas in the browser, encoded as a PNG and uploaded like any
 * other file, so it runs the real detection pipeline.
 *
 * The colours below are pixels in the generated image, not interface colours,
 * which is why they are fixed values rather than theme tokens.
 */

export type SampleId = "invaders" | "icons" | "tiles";

export interface Sample {
  id: SampleId;
  label: string;
  fileName: string;
}

export const SAMPLES: Sample[] = [
  { id: "invaders", label: "Pixel invaders · 4×4", fileName: "invaders_pattern_bw.png" },
  { id: "icons", label: "Minimal icons · 3×3", fileName: "ui_icons_bw.png" },
  { id: "tiles", label: "Dungeon tiles · 4×4", fileName: "rpg_tileset_bw.png" },
];

const INK = "black";
const GUIDE_ICONS = "rgb(228 228 231)";
const GUIDE_TILES = "rgb(244 244 245)";

function drawPixelInvaders(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, 256, 256);
  const cellSize = 64;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x = c * cellSize + 8;
      const y = r * cellSize + 8;
      const size = 48;
      const pixels = 8;
      const pSize = size / pixels;

      const pattern: boolean[][] = [];
      const seed = (r * 4 + c) * 37 + 13;
      for (let py = 0; py < pixels; py++) {
        pattern[py] = [];
        for (let px = 0; px < pixels / 2; px++) {
          pattern[py][px] = ((seed + py * 9) ^ (px * 17)) % 2 === 0;
        }
      }

      ctx.fillStyle = INK;
      for (let py = 0; py < pixels; py++) {
        for (let px = 0; px < pixels; px++) {
          const mapX = px < 4 ? px : 7 - px;
          if (pattern[py][mapX]) ctx.fillRect(x + px * pSize, y + py * pSize, pSize, pSize);
        }
      }
    }
  }
}

function drawMinimalIcons(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, 256, 256);
  const cellSize = 85;
  ctx.fillStyle = INK;

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const cx = c * cellSize + cellSize / 2;
      const cy = r * cellSize + cellSize / 2;
      const idx = r * 3 + c;

      ctx.strokeStyle = GUIDE_ICONS;
      ctx.lineWidth = 1;
      ctx.strokeRect(c * cellSize + 8, r * cellSize + 8, cellSize - 16, cellSize - 16);

      ctx.strokeStyle = INK;
      ctx.lineWidth = 3.5;

      if (idx === 0) {
        // Star
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
          const sx = cx + Math.cos(angle) * 16;
          const sy = cy + Math.sin(angle) * 16;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.stroke();
      } else if (idx === 1) {
        // Heart
        ctx.beginPath();
        ctx.moveTo(cx, cy - 7);
        ctx.bezierCurveTo(cx - 12, cy - 18, cx - 22, cy - 7, cx, cy + 12);
        ctx.bezierCurveTo(cx + 22, cy - 7, cx + 12, cy - 18, cx, cy - 7);
        ctx.stroke();
      } else if (idx === 2) {
        // Gear
        ctx.beginPath();
        ctx.arc(cx, cy, 10, 0, Math.PI * 2);
        ctx.stroke();
        for (let a = 0; a < 8; a++) {
          const angle = (a * Math.PI) / 4;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * 10, cy + Math.sin(angle) * 10);
          ctx.lineTo(cx + Math.cos(angle) * 14, cy + Math.sin(angle) * 14);
          ctx.stroke();
        }
      } else if (idx === 3) {
        // Home
        ctx.beginPath();
        ctx.moveTo(cx, cy - 16);
        ctx.lineTo(cx - 14, cy);
        ctx.lineTo(cx - 9, cy);
        ctx.lineTo(cx - 9, cy + 14);
        ctx.lineTo(cx + 9, cy + 14);
        ctx.lineTo(cx + 9, cy);
        ctx.lineTo(cx + 14, cy);
        ctx.closePath();
        ctx.stroke();
      } else if (idx === 4) {
        // Shield
        ctx.beginPath();
        ctx.moveTo(cx - 12, cy - 14);
        ctx.lineTo(cx + 12, cy - 14);
        ctx.quadraticCurveTo(cx + 12, cy + 2, cx, cy + 14);
        ctx.quadraticCurveTo(cx - 12, cy + 2, cx - 12, cy - 14);
        ctx.closePath();
        ctx.stroke();
      } else if (idx === 5) {
        // Warning triangle
        ctx.beginPath();
        ctx.moveTo(cx, cy - 16);
        ctx.lineTo(cx - 16, cy + 12);
        ctx.lineTo(cx + 16, cy + 12);
        ctx.closePath();
        ctx.stroke();
        ctx.fillRect(cx - 1, cy - 5, 2, 6);
        ctx.fillRect(cx - 1, cy + 3, 2, 2);
      } else if (idx === 6) {
        // Envelope
        ctx.strokeRect(cx - 16, cy - 10, 32, 20);
        ctx.beginPath();
        ctx.moveTo(cx - 16, cy - 10);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + 16, cy - 10);
        ctx.stroke();
      } else if (idx === 7) {
        // Cloud
        ctx.beginPath();
        ctx.arc(cx - 5, cy + 3, 7, 0.5 * Math.PI, 1.5 * Math.PI);
        ctx.arc(cx, cy - 4, 9, 1.0 * Math.PI, 2.0 * Math.PI);
        ctx.arc(cx + 7, cy + 3, 7, 1.5 * Math.PI, 2.5 * Math.PI);
        ctx.closePath();
        ctx.stroke();
      } else if (idx === 8) {
        // Folder
        ctx.beginPath();
        ctx.moveTo(cx - 16, cy + 10);
        ctx.lineTo(cx - 16, cy - 10);
        ctx.lineTo(cx - 8, cy - 10);
        ctx.lineTo(cx - 4, cy - 6);
        ctx.lineTo(cx + 16, cy - 6);
        ctx.lineTo(cx + 16, cy + 10);
        ctx.closePath();
        ctx.stroke();
      }
    }
  }
}

function drawRpgTiles(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, 256, 256);
  const cellSize = 64;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;

  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const tx = c * cellSize;
      const ty = r * cellSize;
      const idx = r * 4 + c;

      ctx.strokeStyle = GUIDE_TILES;
      ctx.strokeRect(tx + 2, ty + 2, cellSize - 4, cellSize - 4);
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;

      if (idx === 0) {
        // Brick wall
        ctx.strokeRect(tx + 4, ty + 4, cellSize - 8, cellSize - 8);
        ctx.beginPath();
        ctx.moveTo(tx + 4, ty + 18); ctx.lineTo(tx + cellSize - 4, ty + 18);
        ctx.moveTo(tx + 4, ty + 32); ctx.lineTo(tx + cellSize - 4, ty + 32);
        ctx.moveTo(tx + 4, ty + 46); ctx.lineTo(tx + cellSize - 4, ty + 46);
        ctx.moveTo(tx + 18, ty + 4); ctx.lineTo(tx + 18, ty + 18);
        ctx.moveTo(tx + 42, ty + 4); ctx.lineTo(tx + 42, ty + 18);
        ctx.moveTo(tx + 12, ty + 18); ctx.lineTo(tx + 12, ty + 32);
        ctx.moveTo(tx + 36, ty + 18); ctx.lineTo(tx + 36, ty + 32);
        ctx.moveTo(tx + 22, ty + 32); ctx.lineTo(tx + 22, ty + 46);
        ctx.moveTo(tx + 48, ty + 32); ctx.lineTo(tx + 48, ty + 46);
        ctx.stroke();
      } else if (idx === 1) {
        // Grass
        for (let i = 0; i < 3; i++) {
          const gx = tx + 14 + i * 16;
          const gy = ty + 18 + (i % 2) * 14;
          ctx.beginPath();
          ctx.moveTo(gx, gy + 8); ctx.lineTo(gx - 3, gy);
          ctx.moveTo(gx, gy + 8); ctx.lineTo(gx, gy - 2);
          ctx.moveTo(gx, gy + 8); ctx.lineTo(gx + 3, gy + 1);
          ctx.stroke();
        }
      } else if (idx === 2) {
        // Treasure chest
        ctx.strokeRect(tx + 14, ty + 18, 36, 28);
        ctx.beginPath();
        ctx.moveTo(tx + 14, ty + 27); ctx.lineTo(tx + 50, ty + 27);
        ctx.rect(tx + 28, ty + 24, 8, 7);
        ctx.stroke();
        ctx.fillRect(tx + 31, ty + 27, 2, 3);
      } else if (idx === 3) {
        // Key
        const kx = tx + 32;
        const ky = ty + 32;
        ctx.beginPath();
        ctx.arc(kx - 10, ky, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(kx - 4, ky); ctx.lineTo(kx + 16, ky);
        ctx.lineTo(kx + 16, ky + 6);
        ctx.moveTo(kx + 11, ky); ctx.lineTo(kx + 11, ky + 5);
        ctx.stroke();
      } else if (idx === 4) {
        // Sword
        ctx.save();
        ctx.translate(tx + 32, ty + 32);
        ctx.rotate(-Math.PI / 4);
        ctx.strokeRect(-3, -18, 6, 22);
        ctx.beginPath();
        ctx.moveTo(-3, -18); ctx.lineTo(0, -22); ctx.lineTo(3, -18);
        ctx.moveTo(-9, 4); ctx.lineTo(9, 4);
        ctx.moveTo(0, 4); ctx.lineTo(0, 13);
        ctx.stroke();
        ctx.restore();
      } else if (idx === 5) {
        // Waves
        ctx.beginPath();
        for (let i = 0; i < 2; i++) {
          const wx = tx + 10;
          const wy = ty + 20 + i * 16;
          ctx.moveTo(wx, wy);
          ctx.bezierCurveTo(wx + 11, wy - 5, wx + 11, wy + 5, wx + 22, wy);
          ctx.bezierCurveTo(wx + 33, wy - 5, wx + 33, wy + 5, wx + 44, wy);
        }
        ctx.stroke();
      } else if (idx === 6) {
        // Stone block
        ctx.strokeRect(tx + 6, ty + 6, cellSize - 12, cellSize - 12);
        ctx.beginPath();
        ctx.moveTo(tx + 6, ty + 22); ctx.lineTo(tx + cellSize - 6, ty + 34);
        ctx.stroke();
      } else if (idx === 7) {
        // Ladder
        ctx.beginPath();
        ctx.moveTo(tx + 20, ty + 4); ctx.lineTo(tx + 20, ty + cellSize - 4);
        ctx.moveTo(tx + 44, ty + 4); ctx.lineTo(tx + 44, ty + cellSize - 4);
        for (let i = 0; i < 4; i++) {
          const ly = ty + 12 + i * 12;
          ctx.moveTo(tx + 20, ly); ctx.lineTo(tx + 44, ly);
        }
        ctx.stroke();
      }
    }
  }
}

const DRAW: Record<SampleId, (ctx: CanvasRenderingContext2D) => void> = {
  invaders: drawPixelInvaders,
  icons: drawMinimalIcons,
  tiles: drawRpgTiles,
};

/** Draws the sample and returns it as a PNG file ready to upload. */
export function createSampleFile(sample: Sample): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("This browser cannot draw the sample image."));
  DRAW[sample.id](ctx);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(new File([blob], sample.fileName, { type: "image/png" }));
      else reject(new Error("Could not create the sample image."));
    }, "image/png");
  });
}
