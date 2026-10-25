/** Terrarium エンコード: height = (R * 256 + G + B / 256) - 32768 */

export type HeightGrid = {
	size: number;
	data: Float32Array;
};

export function terrariumToHeight(r: number, g: number, b: number): number {
	return r * 256 + g + b / 256 - 32768;
}

/** 1/256 m 単位に丸めた [R, G, B] */
export function heightToTerrarium(height: number): [number, number, number] {
	const v = Math.round((height + 32768) * 256);
	return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

export async function decodeTerrarium(blob: Blob): Promise<HeightGrid> {
	const bitmap = await createImageBitmap(blob, {
		colorSpaceConversion: 'none',
		premultiplyAlpha: 'none'
	});
	const size = bitmap.width;
	const canvas = new OffscreenCanvas(size, bitmap.height);
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('2D コンテキストを取得できません');
	ctx.drawImage(bitmap, 0, 0);
	bitmap.close();
	const rgba = ctx.getImageData(0, 0, size, size).data;
	const data = new Float32Array(size * size);
	for (let i = 0; i < data.length; i++) {
		const p = i * 4;
		data[i] = terrariumToHeight(rgba[p], rgba[p + 1], rgba[p + 2]);
	}
	return { size, data };
}

export async function encodeTerrarium(grid: HeightGrid): Promise<Blob> {
	const { size, data } = grid;
	const image = new ImageData(size, size);
	const rgba = image.data;
	for (let i = 0; i < data.length; i++) {
		const p = i * 4;
		[rgba[p], rgba[p + 1], rgba[p + 2]] = heightToTerrarium(data[i]);
		rgba[p + 3] = 255;
	}
	const canvas = new OffscreenCanvas(size, size);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2D コンテキストを取得できません');
	ctx.putImageData(image, 0, 0);
	return canvas.convertToBlob({ type: 'image/png' });
}

/** Terrarium を高さ (m) × exaggeration に戻す deck.gl TerrainLayer 用のデコーダ */
export function terrariumDecoder(exaggeration: number) {
	return {
		rScaler: 256 * exaggeration,
		gScaler: exaggeration,
		bScaler: exaggeration / 256,
		offset: -32768 * exaggeration
	};
}
