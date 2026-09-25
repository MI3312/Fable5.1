// Shared engine constants
export const CHUNK = 16;          // chunk width/depth in blocks
export const HEIGHT = 128;        // world height in blocks
export const PW = CHUNK + 2;      // padded chunk width (1 block border for meshing)
export const MARGIN = 4;          // generation margin so features can cross chunk borders
export const GW = CHUNK + MARGIN * 2; // generation area width

export const ATMOSPHERE_EXIT = 300;    // ship altitude that leaves the atmosphere
export const SURFACE_ENTRY_ALT = 230;  // altitude the ship appears at when entering

export const CURVATURE = 0.00028;      // fake planetary curvature (world bends away with distance)

export function chunkKey(cx, cz) { return cx + ',' + cz; }

export function padIndex(px, y, pz) { return px + PW * (pz + PW * y); }
