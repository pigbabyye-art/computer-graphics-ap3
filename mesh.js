// Each vertex stores local position, normal and UV in one interleaved buffer.
function grid(columns, rows, vertex) {
  const vertices = [];
  const indices = [];
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= columns; col++) {
      const u = col / columns;
      const v = row / rows;
      vertices.push(...vertex(u, v), u, v);
      if (col === columns || row === rows) continue;
      const i = row * (columns + 1) + col;
      const next = i + columns + 1;
      indices.push(i, i + 1, next, next, i + 1, next + 1);
    }
  }
  return { vertices, indices };
}

export function floor() {
  return grid(1, 1, (u, v) => [u - 0.5, 0, 0.5 - v, 0, 1, 0]);
}

export function box() {
  const faces = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  const vertices = [];
  const indices = [];
  for (const [normal, tangent, bitangent] of faces) {
    const face = grid(1, 1, (u, v) => [
      ...normal.map((n, i) => n * 0.5 + tangent[i] * (u - 0.5) + bitangent[i] * (v - 0.5)),
      ...normal,
    ]);
    const offset = vertices.length / 8;
    vertices.push(...face.vertices);
    indices.push(...face.indices.map((i) => i + offset));
  }
  return { vertices, indices };
}

export function sphere() {
  return grid(64, 36, (u, v) => {
    const longitude = u * 2 * Math.PI;
    const latitude = (v - 0.5) * Math.PI;
    const x = Math.cos(latitude) * Math.cos(longitude);
    const y = Math.sin(latitude);
    const z = -Math.cos(latitude) * Math.sin(longitude);
    return [x, y, z, x, y, z];
  });
}

export function torus() {
  return grid(80, 24, (u, v) => {
    const a = u * 2 * Math.PI;
    const b = v * 2 * Math.PI;
    const radial = 0.78 + 0.20 * Math.cos(b);
    return [
      radial * Math.cos(a), radial * Math.sin(a), 0.20 * Math.sin(b),
      Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b),
    ];
  });
}

// Revolve a cross-section. The profile runs from the underside to the inner lip.
export function lathe(profile) {
  return grid(64, profile.length - 1, (u, v) => {
    const row = Math.round(v * (profile.length - 1));
    const [radius, y] = profile[row];
    const previous = profile[Math.max(0, row - 1)];
    const next = profile[Math.min(profile.length - 1, row + 1)];
    const dr = next[0] - previous[0];
    const dy = next[1] - previous[1];
    const length = Math.hypot(dr, dy);
    const angle = u * 2 * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [radius * cos, y, -radius * sin, dy * cos / length, -dr / length, -dy * sin / length];
  });
}

export function uploadMesh(gl, { vertices, indices }) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const attributes = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, attributes);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
  for (const [location, size, offset] of [[0, 3, 0], [1, 3, 12], [2, 2, 24]]) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 32, offset);
  }
  gl.bindVertexArray(null);
  return { vao, count: indices.length };
}
