/** Maximum number of bytes in a compact Search projection response. */
export const documentSearchProjectionResponseBytes = 1_048_576;

const encoder = new TextEncoder();

/** Counts the bytes of the compact JSON response before HTTP framing. */
export function compactJsonBytes(response: object): number {
  return encoder.encode(JSON.stringify(response)).byteLength;
}
