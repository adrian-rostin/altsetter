"""
Builds altsetter's anatomy model from Z-Anatomy (CC BY-SA 4.0).

1. Candidates: all meshes in the "Muscles" collection (+ a few visible tendons) and the skeleton.
2. Visibility test: orthographic ray grids from many directions; keep objects that are seen.
3. Clean names, assign muscle / tendon / bone materials, tag kind via custom property (-> glTF extras).
4. Decimate to a face budget and export a Draco-compressed GLB.

Run (Blender 4.2 LTS; keep Blender in a short path on Windows, the glTF add-on breaks past 260 chars):
  blender --background --disable-autoexec Z-Anatomy/Startup.blend --python tools/export-anatomy.py -- public/models/male-anatomy.glb 220000
"""
import bpy
import bmesh
import math
import re
import sys
import time
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'male-anatomy.glb'
FACE_BUDGET = int(argv[1]) if len(argv) > 1 else 220_000
GRID_STEP = 0.006   # metres between rays
MIN_HITS = 25       # rays an object must receive to count as visible

t0 = time.time()
def log(*a):
    print(f"[{time.time() - t0:6.1f}s]", *a, flush=True)

EXCLUDE = re.compile(r'fascia|bursa|sheath|retinacul|septum|ligament|aponeurosis|insertion|capsule|membrane', re.I)
EXTRA_TENDONS = {'Calcaneal tendon.l', 'Calcaneal tendon.r', 'Iliotibial tract.l', 'Iliotibial tract.r'}

def faces(o):
    return len(o.data.polygons) if o.type == 'MESH' else 0

muscles = {o for o in bpy.data.collections['Muscles'].all_objects
           if o.type == 'MESH' and faces(o) > 0 and not EXCLUDE.search(o.name)}
muscles |= {bpy.data.objects[n] for n in EXTRA_TENDONS if n in bpy.data.objects}
bones = {o for o in bpy.data.collections['1: Skeletal system'].all_objects
         if o.type == 'MESH' and faces(o) > 0 and not EXCLUDE.search(o.name)}
bones -= muscles
candidates = list(muscles | bones)
log("candidates", len(muscles), "muscles,", len(bones), "bones,", sum(map(faces, candidates)), "faces")

# Skeleton bounds = body bounds (drops stray objects placed away from the body).
def world_bbox(objs):
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi

def obj_center(o):
    return sum((o.matrix_world @ Vector(b) for b in o.bound_box), Vector()) / 8

# The body is centred on x=0 and ~0.7 m wide; anything with |x| > 0.5 m is a stray object.
strays = [o for o in bones | muscles if abs(obj_center(o).x) > 0.5]
for o in strays:
    log("stray (dropped):", o.name, tuple(round(v, 2) for v in obj_center(o)))
blo, bhi = world_bbox([o for o in bones if o not in strays])
margin = 0.05
def inside_body(o):
    c = obj_center(o)
    return o not in strays and all(blo[i] - margin <= c[i] <= bhi[i] + margin for i in range(3))
candidates = [o for o in candidates if inside_body(o)]
log("body bbox", tuple(round(v, 3) for v in blo), tuple(round(v, 3) for v in bhi), "kept", len(candidates))

# ---- Expose rectus abdominis ----
# The aponeuroses of the flat abdominal muscles form the rectus sheath and cover the rectus
# abdominis completely. Remove every face of those muscles that lies directly in front of the
# rectus (the model faces -Y, so "behind" is +Y), as in a classic écorché.
FLAT_ABDOMINAL = re.compile(r'^(External abdominal oblique|Internal abdominal oblique|Transversus abdominis) muscle\.[lr]$')
rectus = [bpy.data.objects[n] for n in ('Rectus abdominis muscle.l', 'Rectus abdominis muscle.r') if n in bpy.data.objects]
r_verts, r_polys = [], []
for o in rectus:
    base = len(r_verts)
    r_verts.extend(o.matrix_world @ v.co for v in o.data.vertices)
    r_polys.extend([base + i for i in p.vertices] for p in o.data.polygons)
rectus_bvh = BVHTree.FromPolygons(r_verts, r_polys)
BACK = Vector((0, 1, 0))
for o in candidates:
    if not FLAT_ABDOMINAL.match(o.name):
        continue
    o.data = o.data.copy()
    mw = o.matrix_world
    bm = bmesh.new()
    bm.from_mesh(o.data)
    doomed = []
    for f in bm.faces:
        c = mw @ f.calc_center_median()
        hit = rectus_bvh.ray_cast(c, BACK, 0.06)[0]
        if hit is not None:
            doomed.append(f)
    bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bm.to_mesh(o.data)
    bm.free()
    log("removed rectus sheath part:", o.name, len(doomed), "faces")

# ---- One BVH over all candidates (evaluated, world space) ----
depsgraph = bpy.context.evaluated_depsgraph_get()
verts, polys, owner = [], [], []
for idx, o in enumerate(candidates):
    me = o.evaluated_get(depsgraph).to_mesh()
    mw = o.matrix_world
    base = len(verts)
    verts.extend(mw @ v.co for v in me.vertices)
    for p in me.polygons:
        polys.append([base + i for i in p.vertices])
        owner.append(idx)
    o.evaluated_get(depsgraph).to_mesh_clear()
log("bvh input", len(verts), "verts", len(polys), "polys")
bvh = BVHTree.FromPolygons(verts, polys, all_triangles=False)
del verts, polys
log("bvh built")

# ---- Visibility rays ----
center = (blo + bhi) / 2
radius = (bhi - blo).length / 2 + 0.2
hits = [0] * len(candidates)

def cast_view(direction):
    d = direction.normalized()
    # Orthonormal basis for the ray plane
    up = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((0, 1, 0))
    u = d.cross(up).normalized()
    v = u.cross(d).normalized()
    origin0 = center - d * radius
    n = int(radius * 2 / GRID_STEP)
    for i in range(n):
        a = -radius + i * GRID_STEP
        for j in range(n):
            b = -radius + j * GRID_STEP
            loc, _, fi, _ = bvh.ray_cast(origin0 + u * a + v * b, d, radius * 2)
            if fi is not None:
                hits[owner[fi]] += 1

views = []
for az in range(0, 360, 15):
    r = math.radians(az)
    views.append(Vector((math.cos(r), math.sin(r), 0)))
for el in (-50, 45):
    for az in range(0, 360, 45):
        r = math.radians(az); e = math.radians(el)
        views.append(Vector((math.cos(r) * math.cos(e), math.sin(r) * math.cos(e), math.sin(e))))
for k, d in enumerate(views):
    cast_view(-d)  # ray travels from outside towards the body
    if k % 8 == 0:
        log(f"view {k + 1}/{len(views)}")

visible = [o for o, h in zip(candidates, hits) if h >= MIN_HITS]
vis_m = [o for o in visible if o in muscles]
vis_b = [o for o in visible if o in bones]
log("visible", len(vis_m), "muscles,", len(vis_b), "bones,", sum(map(faces, visible)), "faces")

# ---- Materials ----
def make_mat(name, rgb, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*rgb, 1)
    p.inputs['Roughness'].default_value = rough
    return m

def srgb(h):
    return tuple(((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4))

MAT_MUSCLE = make_mat('Muscle', srgb('9e3b32'), 0.5)
MAT_TENDON = make_mat('Tendon', srgb('d9cdb8'), 0.4)
MAT_BONE = make_mat('Bone', srgb('cfc6b2'), 0.7)

# ---- Prepare export collection ----
export_col = bpy.data.collections.new('AltsetterExport')
bpy.context.scene.collection.children.link(export_col)

def clean_name(n):
    n = n.replace('(', '').replace(')', '')
    n = re.sub(r'\.l$', ' left', n)
    n = re.sub(r'\.r$', ' right', n)
    n = re.sub(r'\.\d+$', '', n)
    return n.strip()

total_vis = sum(map(faces, visible))
ratio = min(1.0, FACE_BUDGET / max(total_vis, 1))
log("decimate ratio", round(ratio, 3))

exported = []
for o in visible:
    is_bone = o in bones
    # Own copy of object + mesh so shared data / parents don't interfere.
    c = o.copy()
    c.data = o.data.copy()
    c.parent = None
    c.matrix_world = o.matrix_world.copy()
    c.animation_data_clear()
    for k in list(c.keys()):
        del c[k]
    c.name = clean_name(o.name)
    c['kind'] = 'bone' if is_bone else 'muscle'
    # Material mapping
    if is_bone:
        c.data.materials.clear()
        c.data.materials.append(MAT_BONE)
    else:
        mats = [s.material.name if s.material else '' for s in o.material_slots]
        c.data.materials.clear()
        for mname in mats or ['']:
            c.data.materials.append(MAT_TENDON if mname in ('Tendon', 'Ligament') else MAT_MUSCLE)
        if o.name in EXTRA_TENDONS:
            c.data.materials.clear(); c.data.materials.append(MAT_TENDON)
    export_col.objects.link(c)
    # Decimate (keep a sensible minimum per object)
    f = faces(c)
    r = max(ratio, min(1.0, 250 / max(f, 1)))
    if r < 0.999:
        mod = c.modifiers.new('Decimate', 'DECIMATE')
        mod.ratio = r
    exported.append(c)

# Drop scene-level custom properties (Z-Anatomy/BIM metadata) so only our "kind" extras are exported.
for k in list(bpy.context.scene.keys()):
    del bpy.context.scene[k]

# Make only the export objects selectable/visible
for o in bpy.context.view_layer.objects:
    o.select_set(False)
for c in exported:
    c.hide_set(False)
    c.hide_viewport = False
    c.hide_render = False
    c.select_set(True)
log("exporting", len(exported), "objects ->", OUT)

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_extras=True,
    export_yup=True,
    export_texcoords=False,
    export_normals=True,
    export_materials='EXPORT',
    export_animations=False,
    export_skins=False,
    export_morph=False,
    export_cameras=False,
    export_lights=False,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=7,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
)

dg = bpy.context.evaluated_depsgraph_get()
final_faces = sum(len(c.evaluated_get(dg).data.polygons) for c in exported)
log("done. exported faces ~", final_faces)
for c in sorted(exported, key=lambda c: c.name):
    if c['kind'] == 'muscle':
        print("EXPORTED_MUSCLE", c.name)
