/**
 * Removes muscles that aren't trained in a gym (face, hands, feet, pelvic floor, …) from the
 * full anatomy export and writes the model the app loads.
 *
 *   node tools/prune-anatomy.mjs
 *
 * Input:  tools/male-anatomy.full.glb   (output of tools/export-anatomy.py)
 * Output: public/models/male-anatomy.glb
 *
 * Names are compared without the " left" / " right" suffix, so both sides are always handled together.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const INPUT = 'tools/male-anatomy.full.glb';
const OUTPUT = 'public/models/male-anatomy.glb';

const REMOVE = new Set([
  // Face & head
  'Deep part of masseter',
  'Superficial part of masseter',
  'Temporalis muscle',
  'Temporoparietalis muscle',
  'Frontalis muscle',
  'Occipitalis muscle',
  'Orbicularis oris muscle',
  'Orbital part of orbicularis oculi',
  'Palpebral part of orbicularis oculi',
  'Zygomaticus major muscle',
  'Zygomaticus minor muscle',
  'Levator anguli oris',
  'Levator labii superioris',
  'Levator nasolabialis',
  'Nasalis muscle',
  'Procerus muscle',
  'Depressor anguli oris',
  'Depressor labii inferioris',
  'Risorius muscle',
  'Platysma',
  'Posterior belly of digastric muscle',
  // Hand
  'Abductor digiti minimi of hand',
  'Abductor pollicis brevis',
  'Deep head of flexor pollicis brevis',
  'Superficial head of flexor pollicis brevis',
  'Dorsal interossei muscles of hand',
  'Flexor digiti minimi of hand',
  'Lumbrical muscles of hand',
  'Oblique head of adductor pollicis',
  'Transverse head of adductor pollicis',
  'Opponens digiti minimi muscle of hand',
  // Foot
  'Abductor digiti minimi of foot',
  'Abductor hallucis',
  'Dorsal interossei muscles of foot',
  'Extensor digitorum brevis',
  'Extensor hallucis brevis',
  'Flexor digiti minimi of foot',
  'Flexor digitorum brevis',
  'Lateral head of flexor hallucis brevis',
  'Medial head of flexor hallucis brevis',
  'Lumbrical muscles of foot',
  'Quadratus plantae muscle',
  'Transverse head of adductor hallucis',
  // Pelvic floor & deep / tiny
  'Coccygeus muscle',
  'External anal sphincter',
  'Pubo-analis muscle',
  'Obturator internus',
  'External intercostal muscles',
  'Pyramidalis muscle',
  'Coracobrachialis muscle',
  'Popliteus muscle',
]);

/** Kept for looks, but not clickable (tendinous structures). */
const NON_CLICKABLE = new Set(['Linea alba']);

const baseName = (name) => name.replace(/\.\d+$/, '').replace(/ (left|right)$/, '');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});

const doc = await io.read(INPUT);
let removed = 0;
let kept = 0;
for (const node of doc.getRoot().listNodes()) {
  const extras = node.getExtras();
  if (extras?.kind !== 'muscle') continue;
  const base = baseName(node.getName());
  if (REMOVE.has(base)) {
    node.dispose();
    removed++;
  } else if (NON_CLICKABLE.has(base)) {
    node.setExtras({ ...extras, kind: 'tendon' });
  } else {
    kept++;
  }
}
await doc.transform(prune());
await io.write(OUTPUT, doc);
console.log(`removed ${removed} muscle meshes, kept ${kept} -> ${OUTPUT}`);
