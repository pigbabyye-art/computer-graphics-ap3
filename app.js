import { createRenderer } from "./renderer.js";

const byId = (id) => document.getElementById(id);
const canvas = byId("scene");
const picker = byId("object");
const termInputs = ["ambient", "diffuse", "specular"].map(byId);
const presetButtons = [...document.querySelectorAll("[data-terms]")];
const toggles = ["sun", "point", "pointShadow", "shadow", "reflection", "bump", "compare"];
const shadowFields = { extent: 1, near: 1, far: 1, bias: 4, pcf: null };
const materialFields = [
  ["ka", "ambient", 2], ["ks", "specular", 2], ["gloss", "gloss", 0],
];
const initialCamera = { yaw: 0.28, pitch: 0.40, distance: 15.7, target: [0, 0.72, -0.05] };
const initialShadow = { extent: 8.5, near: 1, far: 28, bias: 0.003, pcf: 1 };

const camera = { ...initialCamera };
const settings = { ...initialShadow, terms: [1, 1, 1], selected: 0 };
let renderer;
let selected;
let frame = 0;
let pointer;

function requestRender() {
  if (!renderer || frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    renderer.render(camera, settings);
  });
}

function updateLighting() {
  settings.terms = termInputs.map((input) => Number(input.checked));
  const key = settings.terms.join("");
  const mode = { 100: "仅环境", "010": "仅漫反射", "001": "仅镜面", 111: "全开", "000": "全关" }[key] ?? "自定义";
  byId("mode").textContent = settings.compare ? mode : "Phong · " + mode;
  for (const button of presetButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.terms === key));
  }
  requestRender();
}

function updateOptions() {
  for (const id of toggles) settings[id] = byId(id).checked;
  byId("pointShadow").disabled = !settings.point;
  for (const [id, precision] of Object.entries(shadowFields)) {
    settings[id] = Number(byId(id).value);
    if (precision !== null) byId(id + "-value").value = settings[id].toFixed(precision);
  }
  byId("comparison").hidden = !settings.compare;
  updateLighting();
}

function selectObject(id) {
  selected = renderer?.objects.find((object) => object.id === id);
  settings.selected = selected?.id ?? 0;
  picker.value = String(settings.selected);
  byId("material").disabled = !selected;
  byId("selection-badge").hidden = !selected;
  byId("selection-badge").textContent = selected?.name ?? "";
  if (selected) byId("color").value = selected.material.color;
  for (const [id, key, precision] of materialFields) {
    if (selected) byId(id).value = selected.material[key];
    byId(id + "-value").value = selected ? selected.material[key].toFixed(precision) : "—";
  }
  requestRender();
}

function reset() {
  Object.assign(camera, initialCamera);
  for (const object of renderer?.objects ?? []) Object.assign(object.material, object.initial);
  for (const input of termInputs) input.checked = true;
  for (const id of toggles) byId(id).checked = id !== "compare";
  for (const [id, value] of Object.entries(initialShadow)) byId(id).value = value;
  selectObject(0);
  updateOptions();
}

function rotate(dx, dy) {
  camera.yaw -= dx * 0.008;
  camera.pitch = Math.max(0.14, Math.min(1.23, camera.pitch + dy * 0.006));
  requestRender();
}

function zoom(amount) {
  camera.distance = Math.max(7, Math.min(27, camera.distance * Math.exp(amount)));
  requestRender();
}

picker.addEventListener("change", () => selectObject(Number(picker.value)));
byId("reset").addEventListener("click", reset);
for (const input of termInputs) input.addEventListener("change", updateLighting);
for (const button of presetButtons) {
  button.addEventListener("click", () => {
    termInputs.forEach((input, i) => { input.checked = button.dataset.terms[i] === "1"; });
    updateLighting();
  });
}
for (const id of [...toggles, ...Object.keys(shadowFields)]) byId(id).addEventListener("input", updateOptions);
byId("color").addEventListener("input", (event) => {
  if (!selected) return;
  selected.material.color = event.target.value;
  requestRender();
});
for (const [id, key, precision] of materialFields) {
  byId(id).addEventListener("input", (event) => {
    if (!selected) return;
    const value = Number(event.target.value);
    selected.material[key] = value;
    byId(id + "-value").value = value.toFixed(precision);
    requestRender();
  });
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || pointer) return;
  pointer = {
    id: event.pointerId, startX: event.clientX, startY: event.clientY,
    x: event.clientX, y: event.clientY, dragged: false,
  };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (pointer?.id !== event.pointerId) return;
  const { clientX: x, clientY: y } = event;
  if (!pointer.dragged && Math.hypot(x - pointer.startX, y - pointer.startY) < 5) return;
  pointer.dragged = true;
  canvas.classList.add("dragging");
  rotate(x - pointer.x, y - pointer.y);
  Object.assign(pointer, { x, y });
});
canvas.addEventListener("pointerup", (event) => {
  if (pointer?.id !== event.pointerId) return;
  if (!pointer.dragged && renderer) {
    selectObject(renderer.pick(event.clientX, event.clientY, camera, settings.compare));
  }
  pointer = undefined;
  canvas.classList.remove("dragging");
});
canvas.addEventListener("lostpointercapture", (event) => {
  if (pointer?.id !== event.pointerId) return;
  pointer = undefined;
  canvas.classList.remove("dragging");
});
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
  zoom(event.deltaY * unit * 0.001);
}, { passive: false });
canvas.addEventListener("keydown", (event) => {
  const directions = { ArrowLeft: [-18, 0], ArrowRight: [18, 0], ArrowUp: [0, -15], ArrowDown: [0, 15] };
  if (Object.hasOwn(directions, event.key)) rotate(...directions[event.key]);
  else if (event.key === "+" || event.key === "=") zoom(-0.10);
  else if (event.key === "-") zoom(0.10);
  else if (event.key === "Escape") selectObject(0);
  else return;
  event.preventDefault();
});

function showError(message) {
  byId("loading").hidden = true;
  byId("error").textContent = message;
  byId("error").hidden = false;
}

canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  renderer = undefined;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  showError("WebGL 绘图上下文中断，等待浏览器恢复。");
});
canvas.addEventListener("webglcontextrestored", () => location.reload());

new ResizeObserver(requestRender).observe(canvas);
updateOptions();

try {
  renderer = await createRenderer(canvas);
  for (const object of renderer.objects) picker.add(new Option(object.name, object.id));
  byId("loading").hidden = true;
  requestRender();
} catch (error) {
  showError(error.message);
  console.error(error);
}
