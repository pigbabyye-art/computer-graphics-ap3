import { linearColor, makeScene, mirrorPosition, pointPosition, sunDirection } from "./scene.js";
import { meshVertex, phongFragment, simpleVertex, depthFragment, pickFragment, skyVertex, skyFragment } from "./shaders.js";

const SHADOW_SIZE = 1024;
const POINT_SHADOW_SIZE = 512;
const POINT_SHADOW_CLIP = [0.15, 18];
const CUBE_SIZE = 256;
const captureSettings = {
  terms: [1, 1, 1], sun: true, point: true, shadow: true, pointShadow: true, bias: 0.003,
  extent: 8.5, near: 1, far: 28, pcf: 1, bump: true, reflection: false,
};

function program(gl, vertex, fragment) {
  const result = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(result, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(result);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result));
  const uniforms = {};
  const count = gl.getProgramParameter(result, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const { name } = gl.getActiveUniform(result, i);
    uniforms[name] = gl.getUniformLocation(result, name);
  }
  return { program: result, uniforms };
}

async function bitmap(gl, url, color) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, color ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  return texture;
}

function checkFramebuffer(gl, name) {
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(name + " FBO: 0x" + status.toString(16));
}

function depthFramebuffer(gl) {
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  return framebuffer;
}

function shadowTarget(gl) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const framebuffer = depthFramebuffer(gl);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0);
  checkFramebuffer(gl, "Shadow");
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer };
}

function cubeTexture(gl, size, format) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
  gl.texStorage2D(gl.TEXTURE_CUBE_MAP, 1, format, size, size);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) {
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, axis, gl.CLAMP_TO_EDGE);
  }
  return texture;
}

function environmentTarget(gl) {
  const texture = cubeTexture(gl, CUBE_SIZE, gl.RGBA8);
  const depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, CUBE_SIZE, CUBE_SIZE);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer, depth };
}

function pickTarget(gl) {
  const framebuffer = gl.createFramebuffer();
  const color = gl.createRenderbuffer();
  const depth = gl.createRenderbuffer();
  let width = 0;
  let height = 0;
  return {
    framebuffer,
    resize(w, h) {
      if (w === width && h === height) return;
      gl.bindRenderbuffer(gl.RENDERBUFFER, color);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      checkFramebuffer(gl, "Picking");
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      width = w;
      height = h;
    },
  };
}

function lightMatrix(settings) {
  const target = [0, 0.4, -0.5];
  const lightEye = add(target, scale(14, sunDirection));
  const view = lookAt(lightEye, target, [0, 1, 0]);
  const extent = settings.extent;
  return mult(ortho(-extent, extent, -extent, extent, settings.near, settings.far), view);
}

function cubeViewProjections(eye, near, far) {
  // WebGL cubemap order: +X, -X, +Y, -Y, +Z, -Z, with matching up vectors.
  const faces = [
    [[1, 0, 0], [0, -1, 0]], [[-1, 0, 0], [0, -1, 0]],
    [[0, 1, 0], [0, 0, 1]], [[0, -1, 0], [0, 0, -1]],
    [[0, 0, 1], [0, -1, 0]], [[0, 0, -1], [0, -1, 0]],
  ];
  const projection = perspective(90, 1, near, far);
  return faces.map(([direction, up]) => mult(projection, lookAt(eye, add(eye, direction), up)));
}

function viewMatrix(camera, width, height) {
  const { yaw, pitch, distance, target } = camera;
  const eye = add(target, [
    distance * Math.sin(yaw) * Math.cos(pitch),
    distance * Math.sin(pitch),
    distance * Math.cos(yaw) * Math.cos(pitch),
  ]);
  const aspect = width / height;
  const minHorizontalFov = 61;
  const fittedFov = 2 * Math.atan(Math.tan(minHorizontalFov * Math.PI / 360) / aspect) * 180 / Math.PI;
  return {
    eye,
    matrix: mult(perspective(Math.max(41, fittedFov), aspect, 0.15, 65), lookAt(eye, target, [0, 1, 0])),
  };
}

function views(camera, width, height, compare) {
  const split = Math.floor(width / 2);
  const regions = compare ? [[0, split, false], [split, width - split, true]] : [[0, width, false]];
  return regions.map(([x, w, blinn]) => ({ x, width: w, blinn, ...viewMatrix(camera, w, height) }));
}

export async function createRenderer(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
  if (!gl) throw new Error("此浏览器未提供 WebGL 2.0");
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.DITHER);
  const sky = program(gl, skyVertex, skyFragment);
  const phong = program(gl, meshVertex, phongFragment);
  const depth = program(gl, simpleVertex, depthFragment);
  const picking = program(gl, simpleVertex, pickFragment);
  const stone = await bitmap(gl, "./textures/limestone.png", true);
  const normalMap = await bitmap(gl, "./textures/limestone-normal.png", false);
  const { objects, parts } = makeScene(gl);
  const shadow = shadowTarget(gl);
  const environment = environmentTarget(gl);
  const pick = pickTarget(gl);
  let previousLightCamera = "";

  function draw(part) {
    gl.bindVertexArray(part.mesh.vao);
    gl.drawElements(gl.TRIANGLES, part.mesh.count, gl.UNSIGNED_SHORT, 0);
  }

  function drawDepth(lightVP) {
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.65, 3);
    gl.useProgram(depth.program);
    const u = depth.uniforms;
    gl.uniformMatrix4fv(u.uViewProjection, false, flatten(lightVP));
    for (const part of parts) {
      if (!part.casts) continue;
      gl.uniformMatrix4fv(u.uModel, false, part.model);
      draw(part);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }

  function drawSunDepth(lightVP) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadow.framebuffer);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    drawDepth(lightVP);
  }

  function capturePointDepth() {
    const texture = cubeTexture(gl, POINT_SHADOW_SIZE, gl.DEPTH_COMPONENT24);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const framebuffer = depthFramebuffer(gl);
    gl.viewport(0, 0, POINT_SHADOW_SIZE, POINT_SHADOW_SIZE);
    const matrices = cubeViewProjections(pointPosition, ...POINT_SHADOW_CLIP);
    for (const [face, matrix] of matrices.entries()) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, texture, 0);
      checkFramebuffer(gl, "Point shadow");
      drawDepth(matrix);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    return texture;
  }

  function drawSky(view, capture) {
    const u = sky.uniforms;
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(sky.program);
    gl.uniformMatrix4fv(u.uInverseVP, false, flatten(inverse(view.matrix)));
    gl.uniform3fv(u.uEye, view.eye);
    gl.uniform3fv(u.uSunDir, sunDirection);
    gl.uniform1i(u.uCapture, capture);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
  }

  function drawLit(view, lightVP, settings, capture = false) {
    drawSky(view, capture);
    gl.useProgram(phong.program);
    const u = phong.uniforms;
    gl.uniformMatrix4fv(u.uViewProjection, false, flatten(view.matrix));
    gl.uniformMatrix4fv(u.uLightVP, false, flatten(lightVP));
    gl.uniform3fv(u.uEye, view.eye);
    gl.uniform3fv(u.uSunDir, sunDirection);
    gl.uniform3fv(u.uPointPosition, pointPosition);
    gl.uniform2fv(u.uPointClip, POINT_SHADOW_CLIP);
    gl.uniform3fv(u.uTerms, settings.terms);
    gl.uniform1i(u.uSun, settings.sun);
    gl.uniform1i(u.uPoint, settings.point);
    gl.uniform1i(u.uPointShadow, settings.pointShadow);
    gl.uniform1i(u.uShadow, settings.shadow);
    gl.uniform1i(u.uPcfRadius, settings.pcf);
    gl.uniform1i(u.uBlinn, view.blinn ?? false);
    gl.uniform1i(u.uBump, settings.bump);
    gl.uniform1i(u.uCapture, capture);
    gl.uniform1f(u.uBias, settings.bias);

    const textures = [
      [u.uStone, gl.TEXTURE_2D, stone],
      [u.uNormalMap, gl.TEXTURE_2D, normalMap],
      [u.uDepth, gl.TEXTURE_2D, shadow.texture],
      [u.uEnvironment, gl.TEXTURE_CUBE_MAP, capture ? null : environment.texture],
      [u.uPointDepth, gl.TEXTURE_CUBE_MAP, pointDepth],
    ];
    for (const [unit, [uniform, target, texture]] of textures.entries()) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(target, texture);
      gl.uniform1i(uniform, unit);
    }
    for (const part of parts) {
      if (capture && part.reflection > 0) continue;
      const params = part.object?.material ?? part.surface;
      gl.uniformMatrix4fv(u.uModel, false, part.model);
      gl.uniformMatrix3fv(u.uNormal, false, part.normal);
      gl.uniform3fv(u.uColor, linearColor(part.surface?.color ?? params.color));
      gl.uniform1f(u.uAmbient, params.ambient);
      gl.uniform1f(u.uSpecular, params.specular);
      gl.uniform1f(u.uGloss, params.gloss);
      gl.uniform1f(u.uReflection, settings.reflection ? part.reflection : 0);
      gl.uniform1i(u.uTiled, part.tiled);
      gl.uniform1i(u.uSelected, part.id > 0 && part.id === settings.selected);
      draw(part);
    }
  }

  // Light position and caster geometry are fixed, so all camera views share this depth map.
  const pointDepth = capturePointDepth();
  const captureVP = lightMatrix(captureSettings);
  drawSunDepth(captureVP);
  gl.bindFramebuffer(gl.FRAMEBUFFER, environment.framebuffer);
  gl.viewport(0, 0, CUBE_SIZE, CUBE_SIZE);
  const mirrorViews = cubeViewProjections(mirrorPosition, 0.10, 40);
  for (const [i, matrix] of mirrorViews.entries()) {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, environment.texture, 0);
    checkFramebuffer(gl, "Environment");
    gl.clear(gl.DEPTH_BUFFER_BIT);
    drawLit({ eye: mirrorPosition, matrix }, captureVP, captureSettings, true);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(environment.framebuffer);
  gl.deleteRenderbuffer(environment.depth);

  return {
    objects,
    render(camera, settings) {
      const ratio = Math.min(devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      const w = Math.max(2, Math.round(width * ratio));
      const h = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const lightVP = lightMatrix(settings);
      const lightCamera = [settings.extent, settings.near, settings.far].join("/");
      if (settings.shadow && settings.sun && previousLightCamera !== lightCamera) {
        drawSunDepth(lightVP);
        previousLightCamera = lightCamera;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      for (const view of views(camera, w, h, settings.compare)) {
        gl.viewport(view.x, 0, view.width, h);
        drawLit(view, lightVP, settings);
      }
    },

    pick(clientX, clientY, camera, compare) {
      const rect = canvas.getBoundingClientRect();
      const w = canvas.width;
      const h = canvas.height;
      const x = Math.floor((clientX - rect.left) * w / rect.width);
      const y = h - 1 - Math.floor((clientY - rect.top) * h / rect.height);
      if (x < 0 || x >= w || y < 0 || y >= h) return 0;
      const view = views(camera, w, h, compare).find((region) => x < region.x + region.width);
      pick.resize(w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pick.framebuffer);
      gl.viewport(view.x, 0, view.width, h);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x, y, 1, 1);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(picking.program);
      const u = picking.uniforms;
      gl.uniformMatrix4fv(u.uViewProjection, false, flatten(view.matrix));
      for (const part of parts) {
        gl.uniformMatrix4fv(u.uModel, false, part.model);
        gl.uniform1i(u.uId, part.id);
        draw(part);
      }
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return pixel[0];
    },
  };
}
