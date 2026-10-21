import * as THREE from 'three';

export type SpeechAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Project the rendered avatar, and reject labels whose speaker is hidden by terrain. */
export function projectSpeechAnchor(
  camera: THREE.PerspectiveCamera,
  position: THREE.Vector3,
  width: number,
  height: number,
  obstacles: THREE.Object3D[],
): SpeechAnchor | null {
  if (width <= 0 || height <= 0) return null;
  const head = position.clone().add(new THREE.Vector3(0, 1.8, 0));
  const projectedHead = head.clone().project(camera);
  const projected = position
    .clone()
    .add(new THREE.Vector3(0, 2.4, 0))
    .project(camera);
  if (
    [projectedHead, projected].some(
      (p) =>
        !Number.isFinite(p.x + p.y + p.z) ||
        p.z < -1 ||
        p.z > 1 ||
        Math.abs(p.x) > 1 ||
        Math.abs(p.y) > 1,
    )
  )
    return null;
  const direction = head.clone().sub(camera.position);
  const ray = new THREE.Raycaster(
    camera.position,
    direction.clone().normalize(),
    0,
    direction.length() - 0.1,
  );
  if (ray.intersectObjects(obstacles, false).length) return null;
  return {
    x: ((projected.x + 1) * width) / 2,
    y: ((1 - projected.y) * height) / 2,
    width,
    height,
  };
}
