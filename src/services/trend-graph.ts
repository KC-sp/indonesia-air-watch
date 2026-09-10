import { deflateSync } from 'node:zlib';
import type { TrendPoint } from './air-service.js';

type Color = [number, number, number, number];

export function createTrendGraph(points: TrendPoint[]): Buffer {
  const width = 900;
  const height = 500;
  const pixels = Buffer.alloc(width * height * 4, 255);
  const left = 55;
  const right = 25;
  const top = 25;
  const bottom = 50;
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

  const bands: Array<[number, number, Color]> = [
    [0, 50, [225, 245, 229, 255]], [50, 100, [255, 249, 196, 255]], [100, 150, [255, 235, 205, 255]],
    [150, 200, [255, 220, 220, 255]], [200, 300, [238, 224, 245, 255]], [300, 500, [230, 210, 215, 255]],
  ];
  for (const [low, high, color] of bands) {
    if (low >= scaleMaximum) continue;
    fill(left, y(Math.min(high, scaleMaximum)), left + plotWidth, y(low), color);
  }
  for (let value = 0; value <= scaleMaximum; value += 50) line(left, y(value), left + plotWidth, y(value), [190, 195, 200, 255]);
  line(left, top, left, top + plotHeight, [55, 65, 75, 255]);
  line(left, top + plotHeight, left + plotWidth, top + plotHeight, [55, 65, 75, 255]);

  const coordinates = points.map((point, index) => ({ x: left + Math.round((points.length === 1 ? 0.5 : index / (points.length - 1)) * plotWidth), y: y(point.value) }));
  for (let index = 1; index < coordinates.length; index += 1) line(coordinates[index - 1].x, coordinates[index - 1].y, coordinates[index].x, coordinates[index].y, [20, 90, 180, 255]);
  for (const coordinate of coordinates) fill(coordinate.x - 3, coordinate.y - 3, coordinate.x + 3, coordinate.y + 3, [10, 65, 145, 255]);

  return encodePng(width, height, pixels);
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
