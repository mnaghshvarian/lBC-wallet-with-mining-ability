/*
 * LBRY proof-of-work scanner compiled to WebAssembly (no libc).
 *
 *   doubled  = SHA256(SHA256(header112))
 *   expanded = SHA512(doubled)
 *   result   = SHA256(SHA256(RIPEMD160(expanded[0:32]) || RIPEMD160(expanded[32:64])))
 *
 * The first 64 header bytes never change while scanning nonces, so their
 * SHA-256 midstate is computed once per job. Every message hashed after that
 * fits in a single compression block with fixed padding, which is precomputed.
 *
 * Usage from JS: write the 112-byte header and 32-byte little-endian target
 * into the buffers returned by header_ptr()/target_ptr(), call prepare(), then
 * call scan(start, count) repeatedly. When it reports a hit, found_nonce() and
 * hash_ptr() describe the result.
 *
 * SPDX-License-Identifier: MIT
 */
#include <stdint.h>

#define EXPORT(name) __attribute__((export_name(#name)))

/* clang may lower struct copies to these; provide them since there is no libc. */
void *memcpy(void *dst, const void *src, unsigned long n) {
  uint8_t *d = (uint8_t *)dst;
  const uint8_t *s = (const uint8_t *)src;
  while (n--) *d++ = *s++;
  return dst;
}
void *memset(void *dst, int c, unsigned long n) {
  uint8_t *d = (uint8_t *)dst;
  while (n--) *d++ = (uint8_t)c;
  return dst;
}

static uint8_t g_header[112];
static uint8_t g_target[32];
static uint8_t g_hash[32];
static uint32_t g_found;
static uint32_t g_found_nonce;
static uint32_t g_target_top; /* most significant 32 bits of the target */

EXPORT(header_ptr) uint8_t *header_ptr(void) { return g_header; }
EXPORT(target_ptr) uint8_t *target_ptr(void) { return g_target; }
EXPORT(hash_ptr) uint8_t *hash_ptr(void) { return g_hash; }
EXPORT(found) uint32_t found(void) { return g_found; }
EXPORT(found_nonce) uint32_t found_nonce(void) { return g_found_nonce; }

static inline uint32_t rotr32(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }
static inline uint32_t rotl32(uint32_t x, int n) { return (x << n) | (x >> (32 - n)); }
static inline uint64_t rotr64(uint64_t x, int n) { return (x >> n) | (x << (64 - n)); }
static inline uint32_t bswap32(uint32_t x) {
  return (x >> 24) | ((x >> 8) & 0xff00u) | ((x << 8) & 0xff0000u) | (x << 24);
}
static inline uint32_t load_be32(const uint8_t *p) {
  return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}

/* ------------------------------------------------------------------ SHA-256 */

static const uint32_t K256[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

static const uint32_t IV256[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                                  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};

/* out = compress(in_state, w[0..15]) ; w are big-endian message words. */
static void sha256_compress(uint32_t out[8], const uint32_t in[8], const uint32_t block[16]) {
  uint32_t w[64];
  for (int i = 0; i < 16; i++) w[i] = block[i];
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >> 3);
    uint32_t s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint32_t a = in[0], b = in[1], c = in[2], d = in[3], e = in[4], f = in[5], g = in[6], h = in[7];
  for (int i = 0; i < 64; i++) {
    uint32_t S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
    uint32_t ch = (e & f) ^ (~e & g);
    uint32_t t1 = h + S1 + ch + K256[i] + w[i];
    uint32_t S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
    uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
    uint32_t t2 = S0 + maj;
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  out[0] = in[0] + a;
  out[1] = in[1] + b;
  out[2] = in[2] + c;
  out[3] = in[3] + d;
  out[4] = in[4] + e;
  out[5] = in[5] + f;
  out[6] = in[6] + g;
  out[7] = in[7] + h;
}

/* ------------------------------------------------------------------ SHA-512 */

static const uint64_t K512[80] = {
    0x428a2f98d728ae22ULL, 0x7137449123ef65cdULL, 0xb5c0fbcfec4d3b2fULL, 0xe9b5dba58189dbbcULL,
    0x3956c25bf348b538ULL, 0x59f111f1b605d019ULL, 0x923f82a4af194f9bULL, 0xab1c5ed5da6d8118ULL,
    0xd807aa98a3030242ULL, 0x12835b0145706fbeULL, 0x243185be4ee4b28cULL, 0x550c7dc3d5ffb4e2ULL,
    0x72be5d74f27b896fULL, 0x80deb1fe3b1696b1ULL, 0x9bdc06a725c71235ULL, 0xc19bf174cf692694ULL,
    0xe49b69c19ef14ad2ULL, 0xefbe4786384f25e3ULL, 0x0fc19dc68b8cd5b5ULL, 0x240ca1cc77ac9c65ULL,
    0x2de92c6f592b0275ULL, 0x4a7484aa6ea6e483ULL, 0x5cb0a9dcbd41fbd4ULL, 0x76f988da831153b5ULL,
    0x983e5152ee66dfabULL, 0xa831c66d2db43210ULL, 0xb00327c898fb213fULL, 0xbf597fc7beef0ee4ULL,
    0xc6e00bf33da88fc2ULL, 0xd5a79147930aa725ULL, 0x06ca6351e003826fULL, 0x142929670a0e6e70ULL,
    0x27b70a8546d22ffcULL, 0x2e1b21385c26c926ULL, 0x4d2c6dfc5ac42aedULL, 0x53380d139d95b3dfULL,
    0x650a73548baf63deULL, 0x766a0abb3c77b2a8ULL, 0x81c2c92e47edaee6ULL, 0x92722c851482353bULL,
    0xa2bfe8a14cf10364ULL, 0xa81a664bbc423001ULL, 0xc24b8b70d0f89791ULL, 0xc76c51a30654be30ULL,
    0xd192e819d6ef5218ULL, 0xd69906245565a910ULL, 0xf40e35855771202aULL, 0x106aa07032bbd1b8ULL,
    0x19a4c116b8d2d0c8ULL, 0x1e376c085141ab53ULL, 0x2748774cdf8eeb99ULL, 0x34b0bcb5e19b48a8ULL,
    0x391c0cb3c5c95a63ULL, 0x4ed8aa4ae3418acbULL, 0x5b9cca4f7763e373ULL, 0x682e6ff3d6b2b8a3ULL,
    0x748f82ee5defb2fcULL, 0x78a5636f43172f60ULL, 0x84c87814a1f0ab72ULL, 0x8cc702081a6439ecULL,
    0x90befffa23631e28ULL, 0xa4506cebde82bde9ULL, 0xbef9a3f7b2c67915ULL, 0xc67178f2e372532bULL,
    0xca273eceea26619cULL, 0xd186b8c721c0c207ULL, 0xeada7dd6cde0eb1eULL, 0xf57d4f7fee6ed178ULL,
    0x06f067aa72176fbaULL, 0x0a637dc5a2c898a6ULL, 0x113f9804bef90daeULL, 0x1b710b35131c471bULL,
    0x28db77f523047d84ULL, 0x32caab7b40c72493ULL, 0x3c9ebe0a15c9bebcULL, 0x431d67c49c100d4cULL,
    0x4cc5d4becb3e42b6ULL, 0x597f299cfc657e2aULL, 0x5fcb6fab3ad6faecULL, 0x6c44198c4a475817ULL};

static const uint64_t IV512[8] = {0x6a09e667f3bcc908ULL, 0xbb67ae8584caa73bULL, 0x3c6ef372fe94f82bULL,
                                  0xa54ff53a5f1d36f1ULL, 0x510e527fade682d1ULL, 0x9b05688c2b3e6c1fULL,
                                  0x1f83d9abfb41bd6bULL, 0x5be0cd19137e2179ULL};

/* SHA-512 of a 32-byte message given as 4 big-endian 64-bit words. */
static void sha512_32(uint64_t out[8], const uint64_t m[4]) {
  uint64_t w[80];
  w[0] = m[0];
  w[1] = m[1];
  w[2] = m[2];
  w[3] = m[3];
  w[4] = 0x8000000000000000ULL;
  for (int i = 5; i < 15; i++) w[i] = 0;
  w[15] = 256;
  for (int i = 16; i < 80; i++) {
    uint64_t s0 = rotr64(w[i - 15], 1) ^ rotr64(w[i - 15], 8) ^ (w[i - 15] >> 7);
    uint64_t s1 = rotr64(w[i - 2], 19) ^ rotr64(w[i - 2], 61) ^ (w[i - 2] >> 6);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint64_t a = IV512[0], b = IV512[1], c = IV512[2], d = IV512[3], e = IV512[4], f = IV512[5], g = IV512[6],
           h = IV512[7];
  for (int i = 0; i < 80; i++) {
    uint64_t S1 = rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41);
    uint64_t ch = (e & f) ^ (~e & g);
    uint64_t t1 = h + S1 + ch + K512[i] + w[i];
    uint64_t S0 = rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39);
    uint64_t maj = (a & b) ^ (a & c) ^ (b & c);
    uint64_t t2 = S0 + maj;
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  out[0] = IV512[0] + a;
  out[1] = IV512[1] + b;
  out[2] = IV512[2] + c;
  out[3] = IV512[3] + d;
  out[4] = IV512[4] + e;
  out[5] = IV512[5] + f;
  out[6] = IV512[6] + g;
  out[7] = IV512[7] + h;
}

/* --------------------------------------------------------------- RIPEMD-160 */

#define RF1(x, y, z) ((x) ^ (y) ^ (z))
#define RF2(x, y, z) (((x) & (y)) | (~(x) & (z)))
#define RF3(x, y, z) (((x) | ~(y)) ^ (z))
#define RF4(x, y, z) (((x) & (z)) | ((y) & ~(z)))
#define RF5(x, y, z) ((x) ^ ((y) | ~(z)))

static const uint8_t RL[80] = {0, 1, 2,  3,  4,  5,  6,  7,  8,  9,  10, 11, 12, 13, 14, 15, 7,  4,  13, 1,
                               10, 6, 15, 3, 12, 0, 9,  5,  2,  14, 11, 8,  3,  10, 14, 4,  9,  15, 8,  1,
                               2,  7, 0,  6, 13, 11, 5, 12, 1,  9,  11, 10, 0,  8,  12, 4,  13, 3,  7,  15,
                               14, 5, 6,  2, 4,  0,  5, 9,  7,  12, 2,  10, 14, 1,  3,  8,  11, 6,  15, 13};
static const uint8_t RR[80] = {5,  14, 7,  0, 9, 2,  11, 4,  13, 6,  15, 8,  1,  10, 3,  12, 6,  11, 3,  7,
                               0,  13, 5,  10, 14, 15, 8, 12, 4,  9,  1,  2,  15, 5,  1,  3,  7,  14, 6,  9,
                               11, 8,  12, 2, 10, 0,  4,  13, 8,  6,  4,  1,  3,  11, 15, 0,  5,  12, 2,  13,
                               9,  7,  10, 14, 12, 15, 10, 4,  1,  5,  8,  7,  6,  2,  13, 14, 0,  3,  9,  11};
static const uint8_t SL[80] = {11, 14, 15, 12, 5,  8,  7,  9,  11, 13, 14, 15, 6,  7,  9,  8,  7,  6,  8,  13,
                               11, 9,  7,  15, 7,  12, 15, 9,  11, 7,  13, 12, 11, 13, 6,  7,  14, 9,  13, 15,
                               14, 8,  13, 6,  5,  12, 7,  5,  11, 12, 14, 15, 14, 15, 9,  8,  9,  14, 5,  6,
                               8,  6,  5,  12, 9,  15, 5,  11, 6,  8,  13, 12, 5,  12, 13, 14, 11, 8,  5,  6};
static const uint8_t SR[80] = {8,  9,  9,  11, 13, 15, 15, 5,  7,  7,  8,  11, 14, 14, 12, 6,  9,  13, 15, 7,
                               12, 8,  9,  11, 7,  7,  12, 7,  6,  15, 13, 11, 9,  7,  15, 11, 8,  6,  6,  14,
                               12, 13, 5,  14, 13, 13, 7,  5,  15, 5,  8,  11, 14, 14, 6,  14, 6,  9,  12, 9,
                               12, 5,  15, 8,  8,  5,  12, 9,  12, 5,  14, 6,  8,  13, 6,  5,  15, 13, 11, 11};
static const uint32_t KL[5] = {0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e};
static const uint32_t KR[5] = {0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000};

static inline uint32_t rf(int j, uint32_t x, uint32_t y, uint32_t z) {
  switch (j) {
    case 0: return RF1(x, y, z);
    case 1: return RF2(x, y, z);
    case 2: return RF3(x, y, z);
    case 3: return RF4(x, y, z);
    default: return RF5(x, y, z);
  }
}

/* RIPEMD-160 of a 32-byte message given as 8 little-endian 32-bit words. */
static void ripemd160_32(uint32_t out[5], const uint32_t m[8]) {
  uint32_t X[16];
  for (int i = 0; i < 8; i++) X[i] = m[i];
  X[8] = 0x80;
  for (int i = 9; i < 14; i++) X[i] = 0;
  X[14] = 256;
  X[15] = 0;
  uint32_t al = 0x67452301, bl = 0xefcdab89, cl = 0x98badcfe, dl = 0x10325476, el = 0xc3d2e1f0;
  uint32_t ar = al, br = bl, cr = cl, dr = dl, er = el;
  for (int i = 0; i < 80; i++) {
    int j = i >> 4;
    uint32_t t = rotl32(al + rf(j, bl, cl, dl) + X[RL[i]] + KL[j], SL[i]) + el;
    al = el;
    el = dl;
    dl = rotl32(cl, 10);
    cl = bl;
    bl = t;
    t = rotl32(ar + rf(4 - j, br, cr, dr) + X[RR[i]] + KR[j], SR[i]) + er;
    ar = er;
    er = dr;
    dr = rotl32(cr, 10);
    cr = br;
    br = t;
  }
  uint32_t t = 0xefcdab89 + cl + dr;
  out[1] = 0x98badcfe + dl + er;
  out[2] = 0x10325476 + el + ar;
  out[3] = 0xc3d2e1f0 + al + br;
  out[4] = 0x67452301 + bl + cr;
  out[0] = t;
}

/* ------------------------------------------------------------- LBRY hashing */

static uint32_t g_midstate[8];
static uint32_t g_tail[16];

/* Computes the full LBRY PoW hash; returns the 8 big-endian state words of the final SHA-256. */
static void lbry_hash_words(uint32_t nonce, uint32_t h4[8]) {
  uint32_t h1[8], h2[8], blk[16];
  g_tail[11] = bswap32(nonce);
  sha256_compress(h1, g_midstate, g_tail); /* SHA256(header) */

  for (int i = 0; i < 8; i++) blk[i] = h1[i];
  blk[8] = 0x80000000u;
  for (int i = 9; i < 15; i++) blk[i] = 0;
  blk[15] = 256;
  sha256_compress(h2, IV256, blk); /* SHA256d(header) */

  uint64_t m[4], e[8];
  for (int i = 0; i < 4; i++) m[i] = ((uint64_t)h2[2 * i] << 32) | h2[2 * i + 1];
  sha512_32(e, m);

  uint32_t lw[8], rw[8], left[5], right[5];
  for (int i = 0; i < 4; i++) {
    lw[2 * i] = bswap32((uint32_t)(e[i] >> 32));
    lw[2 * i + 1] = bswap32((uint32_t)e[i]);
    rw[2 * i] = bswap32((uint32_t)(e[i + 4] >> 32));
    rw[2 * i + 1] = bswap32((uint32_t)e[i + 4]);
  }
  ripemd160_32(left, lw);
  ripemd160_32(right, rw);

  uint32_t h3[8];
  for (int i = 0; i < 5; i++) blk[i] = bswap32(left[i]);
  for (int i = 0; i < 5; i++) blk[5 + i] = bswap32(right[i]);
  blk[10] = 0x80000000u;
  for (int i = 11; i < 15; i++) blk[i] = 0;
  blk[15] = 320;
  sha256_compress(h3, IV256, blk);

  for (int i = 0; i < 8; i++) blk[i] = h3[i];
  blk[8] = 0x80000000u;
  for (int i = 9; i < 15; i++) blk[i] = 0;
  blk[15] = 256;
  sha256_compress(h4, IV256, blk);
}

static void store_hash(const uint32_t h4[8]) {
  for (int i = 0; i < 8; i++) {
    g_hash[4 * i] = (uint8_t)(h4[i] >> 24);
    g_hash[4 * i + 1] = (uint8_t)(h4[i] >> 16);
    g_hash[4 * i + 2] = (uint8_t)(h4[i] >> 8);
    g_hash[4 * i + 3] = (uint8_t)h4[i];
  }
}

/* Full little-endian 256-bit comparison of g_hash against g_target. */
static int hash_le_target(void) {
  for (int i = 31; i >= 0; i--) {
    if (g_hash[i] < g_target[i]) return 1;
    if (g_hash[i] > g_target[i]) return 0;
  }
  return 1;
}

/* Call after writing a new header and/or target. */
EXPORT(prepare) void prepare(void) {
  uint32_t first[16];
  for (int i = 0; i < 16; i++) first[i] = load_be32(g_header + 4 * i);
  sha256_compress(g_midstate, IV256, first);
  for (int i = 0; i < 12; i++) g_tail[i] = load_be32(g_header + 64 + 4 * i);
  g_tail[12] = 0x80000000u;
  g_tail[13] = 0;
  g_tail[14] = 0;
  g_tail[15] = 112 * 8;
  g_target_top = ((uint32_t)g_target[31] << 24) | ((uint32_t)g_target[30] << 16) | ((uint32_t)g_target[29] << 8) |
                 (uint32_t)g_target[28];
  g_found = 0;
}

/*
 * Scans `count` nonces starting at `start` (wrapping is the caller's concern).
 * Stops at the first hash <= target. Returns the number of hashes computed.
 */
EXPORT(scan) uint32_t scan(uint32_t start, uint32_t count) {
  uint32_t h4[8];
  g_found = 0;
  for (uint32_t i = 0; i < count; i++) {
    uint32_t nonce = start + i;
    lbry_hash_words(nonce, h4);
    /* Most significant 32 bits of the little-endian hash value are bytes 31..28. */
    uint32_t top = bswap32(h4[7]);
    if (top > g_target_top) continue;
    store_hash(h4);
    if (top < g_target_top || hash_le_target()) {
      g_found = 1;
      g_found_nonce = nonce;
      return i + 1;
    }
  }
  return count;
}

/* Computes the hash of the current header with a given nonce into hash_ptr() (for verification). */
EXPORT(hash_nonce) void hash_nonce(uint32_t nonce) {
  uint32_t h4[8];
  lbry_hash_words(nonce, h4);
  store_hash(h4);
}
