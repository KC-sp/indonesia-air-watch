import { deflateSync } from 'node:zlib';
import type { TrendPoint } from './air-service.js';

type Color = [number, number, number, number];

const FONT: Record<string, string[]> = {
  ' ': ['000', '000', '000', '000', '000'],
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
  'A': ['010', '101', '111', '101', '101'], 'D': ['110', '101', '101', '101', '110'],
  'E': ['111', '100', '110', '100', '111'], 'G': ['111', '100', '101', '101', '111'],
  'I': ['111', '010', '010', '010', '111'], 'M': ['101', '111', '111', '101', '101'],
  'Q': ['111', '101', '101', '111', '001'], 'R': ['110', '101', '110', '101', '101'],
  'S': ['111', '100', '111', '001', '111'], 'T': ['111', '010', '010', '010', '010'],
  'U': ['101', '101', '101', '101', '111'],
  '/': ['001', '001', '010', '100', '100'], ':': ['000', '010', '000', '010', '000'],
  '-': ['000', '000', '111', '000', '000'], '(': ['010', '100', '100', '100', '010'],
  ')': ['010', '001', '001', '001', '010'],
};

export function createTrendGraph(points: TrendPoint[]): Buffer {
  const width = 900;
  const height = 500;
  const pixels = Buffer.alloc(width * height * 4, 255);
  const left = 95;
  const right = 25;
  const top = 25;
  const bottom = 90;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maximum = Math.max(50, ...points.map((point) => point.value));
  const scaleMaximum = Math.min(500, Math.max(50, Math.ceil(maximum / 50) * 50));
  const y = (value: number) => top + plotHeight - Math.round(Math.min(value, scaleMaximum) / scaleMaximum * plotHeight);

  const setPixel = (x: number, yValue: number, color: Color) => {
    if (x < 0 || x >= width || yValue < 0 || yValue >= height) return;
    const offset = (yValue * width + x) * 4;
    pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = color[3];
  };
  const fill = (x1: number, y1: number, x2: number, y2: number, color: Color) => {
    for (let row = Math.max(0, y1); row <= Math.min(height - 1, y2); row += 1) for (let column = Math.max(0, x1); column <= Math.min(width - 1, x2); column += 1) setPixel(column, row, color);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, color: Color) => {
    const dx = Math.abs(x2 - x1); const sx = x1 < x2 ? 1 : -1;
    const dy = -Math.abs(y2 - y1); const sy = y1 < y2 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      setPixel(x1, y1, color); setPixel(x1, y1 + 1, color);
      if (x1 === x2 && y1 === y2) break;
      const twice = 2 * error;
      if (twice >= dy) { error += dy; x1 += sx; }
      if (twice <= dx) { error += dx; y1 += sy; }
    }
  };
  const textWidth = (text: string, scale = 2) => Math.max(0, text.length * 4 * scale - scale);
  const drawText = (text: string, x: number, yValue: number, color: Color, scale = 2, vertical = false) => {
    [...text.toUpperCase()].forEach((character, characterIndex) => {
      const glyph = FONT[character] ?? FONT[' '];
      glyph.forEach((row, rowIndex) => [...row].forEach((pixel, columnIndex) => {
        if (pixel !== '1') return;
        for (let rowScale = 0; rowScale < scale; rowScale += 1) for (let columnScale = 0; columnScale < scale; columnScale += 1) {
          if (vertical) setPixel(x + rowIndex * scale + rowScale, yValue - (characterIndex * 4 + columnIndex) * scale - columnScale, color);
          else setPixel(x + (characterIndex * 4 + columnIndex) * scale + columnScale, yValue + rowIndex * scale + rowScale, color);
        }
      }));
    });
  };

  const bands: Array<[number, number, Color]> = [
    [0, 50, [225, 245, 229, 255]], [50, 100, [255, 249, 196, 255]], [100, 150, [255, 235, 205, 255]],
    [150, 200, [255, 220, 220, 255]], [200, 300, [238, 224, 245, 255]], [300, 500, [230, 210, 215, 255]],
  ];
  for (const [low, high, color] of bands) {
    if (low >= scaleMaximum) continue;
    fill(left, y(Math.min(high, scaleMaximum)), left + plotWidth, y(low), color);
  }
  for (let value = 0; value <= scaleMaximum; value += 50) {
    line(left, y(value), left + plotWidth, y(value), [190, 195, 200, 255]);
    const label = String(value);
    drawText(label, left - textWidth(label) - 10, y(value) - 5, [55, 65, 75, 255]);
  }
  line(left, top, left, top + plotHeight, [55, 65, 75, 255]);
  line(left, top + plotHeight, left + plotWidth, top + plotHeight, [55, 65, 75, 255]);

  const coordinates = points.map((point, index) => ({ x: left + Math.round((points.length === 1 ? 0.5 : index / (points.length - 1)) * plotWidth), y: y(point.value) }));
  for (let index = 1; index < coordinates.length; index += 1) line(coordinates[index - 1].x, coordinates[index - 1].y, coordinates[index].x, coordinates[index].y, [20, 90, 180, 255]);
  for (const coordinate of coordinates) fill(coordinate.x - 3, coordinate.y - 3, coordinate.x + 3, coordinate.y + 3, [10, 65, 145, 255]);

  const tickIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  for (const index of tickIndexes) {
    const label = formatSgtTick(points[index].observedAt);
    const xPosition = coordinates[index].x;
    const labelX = index === 0 ? xPosition : index === points.length - 1 ? xPosition - textWidth(label) : xPosition - Math.round(textWidth(label) / 2);
    drawText(label, labelX, top + plotHeight + 12, [55, 65, 75, 255]);
  }
  const xAxisTitle = 'TIME / DATE (SGT)';
  drawText(xAxisTitle, left + Math.round((plotWidth - textWidth(xAxisTitle)) / 2), height - 20, [35, 45, 55, 255]);
  const yAxisTitle = 'US AQI IQAIR';
  drawText(yAxisTitle, 15, top + Math.round((plotHeight + textWidth(yAxisTitle)) / 2), [35, 45, 55, 255], 2, true);

  return encodePng(width, height, pixels);
}

function formatSgtTick(value: Date): string {
  const sgt = new Date(value.getTime() + 8 * 3_600_000);
  const two = (part: number) => String(part).padStart(2, '0');
  return `${two(sgt.getUTCDate())}/${two(sgt.getUTCMonth() + 1)} ${two(sgt.getUTCHours())}:${two(sgt.getUTCMinutes())}`;
}

function encodePng(width: number, height: number, pixels: Buffer): Buffer {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const outputOffset = row * (width * 4 + 1);
    scanlines[outputOffset] = 0;
    pixels.copy(scanlines, outputOffset + 1, row * width * 4, (row + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(scanlines, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0);
  return Buffer.concat([length, name, data, checksum]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
