import { box, floor, lathe, sphere, torus, uploadMesh } from "./mesh.js";

export const mirrorPosition = [-1.74, 1.70, 0.12];
export const sunDirection = normalize(vec3(0.53, 0.96, 0.76));
export const pointPosition = [1.25, 3.85, 0.35];

export function material(color, ambient = 0.30, specular = 0.28, gloss = 42) {
  return { color, ambient, specular, gloss };
}

export function linearColor(hex) {
  return [1, 3, 5].map((offset) => {
    const srgb = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return srgb < 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
}

export function makeScene(gl) {
  const geometry = {
    box: box(), floor: floor(), sphere: sphere(), torus: torus(),
    vase: lathe([
      [0, 0], [0.28, 0], [0.33, 0.04], [0.40, 0.18], [0.49, 0.43], [0.50, 0.64],
      [0.47, 0.83], [0.37, 1.00], [0.26, 1.12], [0.20, 1.25], [0.19, 1.40],
      [0.23, 1.45], [0.23, 1.50], [0.20, 1.52], [0.16, 1.50], [0.16, 1.43],
      [0.14, 1.30], [0.17, 1.16], [0.21, 1.06], [0, 1.06],
    ]),
    planter: lathe([
      [0, 0], [0.40, 0], [0.44, 0.05], [0.50, 0.26], [0.55, 0.58], [0.56, 0.71],
      [0.58, 0.73], [0.58, 0.79], [0.55, 0.81], [0.50, 0.79], [0.49, 0.70], [0, 0.70],
    ]),
  };
  const meshes = Object.fromEntries(Object.entries(geometry).map(([key, value]) => [key, uploadMesh(gl, value)]));
  const objects = [];
  const parts = [];

  function addObject(name, values) {
    const object = { id: objects.length + 1, name, material: values, initial: { ...values } };
    objects.push(object);
    return object;
  }

  function part(object, mesh, at, scale, options = {}) {
    const { yaw = 0, tilt = 0, pitch = 0, surface, reflection = 0, tiled = false, casts = true } = options;
    const rotation = mult(rotateY(yaw), mult(rotateZ(tilt), rotateX(pitch)));
    const model = mult(translate(...at), mult(rotation, scalem(...scale)));
    parts.push({
      object, id: object?.id ?? 0, mesh: meshes[mesh], model: flatten(model),
      normal: flatten(normalMatrix(model, true)), surface, reflection, tiled, casts,
    });
  }

  const ground = addObject("石板地面", material("#ffffff", 0.31, 0.12, 22));
  part(null, "box", [0, -0.16, 0.18], [11.7, 0.30, 9.5], { surface: material("#b8a389"), casts: false });
  part(ground, "floor", [0, 0, 0.18], [11.7, 1, 9.5], { tiled: true, casts: false });

  const plaster = material("#cfbba2", 0.37, 0.04, 24);
  const limestone = material("#edddc5", 0.37, 0.06, 24);
  const sage = material("#718c77", 0.35, 0.10, 30);
  const sageTrim = material("#8ca28b", 0.34, 0.08, 30);
  // The open side of the courtyard leaves the objects visible while orbiting.
  part(null, "box", [0, 1.67, -4.40], [11.70, 3.34, 0.28], { surface: plaster });
  part(null, "box", [-5.70, 1.50, -3.05], [0.30, 3.0, 2.70], { surface: limestone });
  part(null, "box", [-3.16, 1.83, -4.20], [4.08, 3.65, 0.28], { surface: sage });
  part(null, "box", [-3.16, 3.68, -4.20], [4.24, 0.09, 0.42], { surface: sageTrim });
  for (let i = 0; i < 18; i++) {
    part(null, "box", [-5.05 + i * 0.223, 1.84, -4.018], [0.045, 3.57, 0.075], { surface: sageTrim });
  }
  for (const x of [-0.40, 2.45, 5.53]) {
    part(null, "box", [x, 1.75, -4.17], [0.11, 3.50, 0.22], { surface: limestone });
  }
  part(null, "box", [2.51, 3.39, -4.22], [6.24, 0.10, 0.41], { surface: limestone });
  part(null, "box", [2.39, 1.18, -4.18], [5.50, 0.055, 0.28], { surface: limestone });

  const wood = addObject("胡桃木长凳", material("#845738", 0.34, 0.24, 37));
  const brass = material("#68482f", 0.30, 0.19, 36);
  for (const z of [-2.58, -2.37, -2.16, -1.95]) {
    part(wood, "box", [2.45, 0.72, z], [4.55, 0.16, 0.19]);
  }
  for (const x of [0.56, 4.31]) {
    part(wood, "box", [x, 0.32, -2.26], [0.15, 0.64, 0.78], { surface: brass });
  }

  const plinth = material("#b88d76", 0.34, 0.12, 26);
  part(null, "box", [-1.74, 0.38, 0.12], [1.72, 0.76, 1.65], { surface: plinth, yaw: -8 });
  part(null, "box", [-1.74, 0.77, 0.12], [1.78, 0.10, 1.70], { surface: limestone, yaw: -8 });

  const mirror = addObject("镜面球", material("#b4c3b8", 0.30, 0.89, 110));
  part(mirror, "sphere", mirrorPosition, [0.88, 0.88, 0.88], { reflection: 0.82 });

  const ceramic = addObject("青釉花瓶", material("#358f83", 0.35, 0.78, 74));
  part(ceramic, "vase", [0.8, 0, 1.78], [1.07, 1.10, 1.07]);

  const ring = addObject("琥珀圆环", material("#dd8e38", 0.32, 0.70, 56));
  part(null, "box", [2.26, 0.14, 0.11], [1.70, 0.28, 1.46], { surface: limestone, yaw: 18 });
  part(ring, "torus", [2.26, 1.31, 0.11], [1.06, 1.06, 1.06], { yaw: 13, tilt: 18 });

  const pot = addObject("龙舌兰花盆", material("#bd6b55", 0.34, 0.23, 40));
  part(pot, "planter", [-3.82, 0, -1.46], [1.03, 1.12, 1.03]);
  const leaves = ["#5d7551", "#799359", "#4c6c55", "#9eaa66"].map((color) => material(color, 0.35, 0.20, 25));
  for (let i = 0; i < 13; i++) {
    const angle = i * 2.399963;
    const radius = i < 8 ? 0.46 : 0.24;
    const height = i < 8 ? 0.61 : 0.78;
    part(pot, "sphere", [
      -3.82 + radius * Math.sin(angle), 0.84 + height * 0.53, -1.46 + radius * Math.cos(angle),
    ], [0.09, height, 0.062], {
      yaw: angle * 180 / Math.PI, pitch: i < 8 ? 44 : 23, surface: leaves[i % leaves.length],
    });
  }

  const clay = addObject("叠置陶砖", material("#ac5240", 0.34, 0.25, 37));
  part(clay, "box", [3.63, 0.90, -2.17], [1.00, 0.20, 0.55], { yaw: 8 });
  part(clay, "box", [3.64, 1.08, -2.23], [0.78, 0.16, 0.54], { yaw: -8 });
  part(clay, "box", [3.69, 1.29, -2.22], [0.42, 0.26, 0.50], { yaw: 12 });

  return { objects, parts };
}
