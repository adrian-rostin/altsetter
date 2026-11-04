import * as THREE from 'three';

/**
 * A crude stand-in figure built from primitives, used only while the real
 * anatomy .glb is missing. Muscle meshes use the same naming style a real
 * model would ("Biceps_Brachii_L"), so the click → exercise flow can be tested.
 */
export function buildPlaceholderBody(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'PlaceholderBody';

  const skin = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.8 });
  const muscle = new THREE.MeshStandardMaterial({ color: 0x9c4a42, roughness: 0.55 });

  const add = (
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    pos: [number, number, number],
    scale: [number, number, number] = [1, 1, 1],
    rotZ = 0,
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...pos);
    mesh.scale.set(...scale);
    mesh.rotation.z = rotZ;
    root.add(mesh);
  };

  const sphere = (r: number) => new THREE.SphereGeometry(r, 32, 24);
  const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 8, 24);

  // Non-muscle body parts
  add('Skin_Head', sphere(0.11), skin, [0, 1.63, 0], [0.9, 1.1, 1]);
  add('Skin_Neck', capsule(0.055, 0.08), skin, [0, 1.48, 0]);
  add('Skin_Torso', capsule(0.16, 0.36), skin, [0, 1.2, 0], [1.25, 1, 0.68]);
  add('Skin_Pelvis', sphere(0.17), skin, [0, 0.93, 0], [1.05, 0.6, 0.7]);

  for (const [side, x] of [
    ['left', 1],
    ['right', -1],
  ] as const) {
    add(`Skin_Forearm_${side}`, capsule(0.04, 0.22), skin, [x * 0.29, 0.93, 0.01]);
    add(`Skin_Hand_${side}`, sphere(0.045), skin, [x * 0.3, 0.75, 0.01], [0.8, 1.2, 0.5]);
    add(`Skin_Shin_${side}`, capsule(0.055, 0.34), skin, [x * 0.1, 0.33, 0]);

    // Muscles (same names as the real model, so they map to the same groups)
    add(
      `Sternocostal_head_of_pectoralis_major_muscle_${side}`,
      sphere(0.1),
      muscle,
      [x * 0.085, 1.33, 0.09],
      [1, 0.72, 0.5],
    );
    add(
      `Acromial_part_of_deltoid_muscle_${side}`,
      sphere(0.072),
      muscle,
      [x * 0.245, 1.4, 0],
      [1, 1.15, 1],
    );
    add(`Long_head_of_biceps_brachii_${side}`, capsule(0.042, 0.16), muscle, [
      x * 0.27,
      1.2,
      0.025,
    ]);
    add(`Lateral_head_of_triceps_brachii_${side}`, capsule(0.045, 0.17), muscle, [
      x * 0.27,
      1.2,
      -0.03,
    ]);
    add(
      `Latissimus_dorsi_muscle_${side}`,
      sphere(0.12),
      muscle,
      [x * 0.11, 1.2, -0.065],
      [0.9, 1.5, 0.45],
      x * 0.15,
    );
    add(`Rectus_femoris_muscle_${side}`, capsule(0.075, 0.28), muscle, [x * 0.1, 0.68, 0.015]);
  }

  add('Rectus_abdominis_muscle', capsule(0.075, 0.16), muscle, [0, 1.09, 0.08], [1, 1, 0.5]);

  return root;
}
